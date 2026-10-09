import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createBlobStore, isHash, isUploadId } from './blobs.js';
import {
    snapshot, hashIndex, planSync, applySync, diffSnapshots, expandRoots, sha256Of,
} from './files.js';

// The runner side of `RUNNER=REMOTE`: it runs inside a crossbind toolchain image and executes the
// toolchain steps a client would otherwise `docker run`, against folders it keeps in sync with the client.

// 2: a blob too large for one request arrives in parts.
export const PROTOCOL_VERSION = 2;
export const MIN_TOKEN_LENGTH = 16;
const MAX_JSON_BYTES = 16 * 1024 * 1024;
const INLINE_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_MOUNTS = 8;
const DEFAULT_PORT = 8787;
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;
// A proxy in front of a hosted runner (fly, cloudflare) closes a response that stays quiet, and a compile
// step can print nothing for minutes.
const HEARTBEAT_MS = 15_000;
// Where crossbind mounts things into its images: the project base, and the cargo and conan caches.
const DEFAULT_MOUNT_PREFIXES = ['/tmp/crossbind/live', '/var/cache/crossbind'];
// cargo runs from a directory outside every mount so its upward config search finds nothing.
const DEFAULT_SCRATCH_DIRS = ['/tmp/crossbind-cargo'];

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isSafeRel = (rel) => typeof rel === 'string' && rel.length > 0 && !path.posix.isAbsolute(rel)
    && path.posix.normalize(rel) === rel && !rel.split('/').includes('..');
const isCleanAbsolute = (value) => typeof value === 'string' && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value && (value === '/' || !value.endsWith('/'));
const isWithin = (child, parent) => child === parent || child.startsWith(`${parent}/`);
const isUnderRoot = (rel, root) => root === '.' || isWithin(rel, root);
const isPlainName = (value) => typeof value === 'string' && /^[\w.-]+$/.test(value) && value !== '.' && value !== '..';
const isNamePattern = (value) => isPlainName(typeof value === 'string' && value.endsWith('*') ? value.slice(0, -1) : value);
// A build and a runner name one toolchain by digest even when they pull it from different registries (a mirror).
const digestOf = (ref) => (typeof ref === 'string' && ref.includes('@') ? ref.slice(ref.indexOf('@') + 1) : ref);

class RequestError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        this.extra = extra;
    }
}

function send(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
}

async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_JSON_BYTES) throw new RequestError(413, 'request body too large');
        chunks.push(chunk);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
        throw new RequestError(400, 'request body is not JSON');
    }
}

function tokenMatches(header, token) {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(header ?? '');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function validateRules(rules) {
    if (!rules || !isStringArray(rules.dirs) || !isStringArray(rules.extensions)) throw new RequestError(400, 'rules must list dirs and extensions');
    if (rules.files !== undefined && !(isStringArray(rules.files) && rules.files.every(isNamePattern))) {
        throw new RequestError(400, 'rules.files must list file names, each optionally ending in *');
    }
    const { serverOnly } = rules;
    if (serverOnly === undefined) return;
    if (!isStringArray(serverOnly.names) || !serverOnly.names.every(isPlainName) || !isPlainName(serverOnly.marker) || !isStringArray(serverOnly.keep)) {
        throw new RequestError(400, 'rules.serverOnly must name folders, a marker file and keep patterns');
    }
}

function validateMount(mount, mountPrefixes) {
    if (!mount || !isCleanAbsolute(mount.path) || !mountPrefixes.some((prefix) => isWithin(mount.path, prefix))) {
        throw new RequestError(400, `mount ${mount?.path} is not one this runner allows`);
    }
    const { roots, outputRoots, manifest, dirs } = mount;
    if (!isStringArray(roots) || !roots.every(isSafeRel)) throw new RequestError(400, 'roots must be relative paths inside the mount');
    if (!isStringArray(outputRoots) || !outputRoots.every(isSafeRel)) throw new RequestError(400, 'outputRoots must be relative paths inside the mount');
    if (!manifest || typeof manifest !== 'object') throw new RequestError(400, 'manifest must be an object');
    for (const [rel, entry] of Object.entries(manifest)) {
        if (!isSafeRel(rel) || !roots.some((root) => isUnderRoot(rel, root))) throw new RequestError(400, `manifest path ${rel} is outside the roots`);
        if (!isHash(entry?.sha256)) throw new RequestError(400, `manifest entry ${rel} has no sha256`);
    }
    if (!isStringArray(dirs) || !dirs.every((rel) => isSafeRel(rel) && roots.some((root) => isUnderRoot(rel, root)))) {
        throw new RequestError(400, 'dirs must be folders inside the roots');
    }
    if (mount.present !== undefined && !(isStringArray(mount.present) && mount.present.every(isSafeRel))) {
        throw new RequestError(400, 'present must list relative folders');
    }
}

function validateExec(body, { mountPrefixes, scratchDirs, image, role }) {
    if (body.role !== role) throw new RequestError(409, `this runner serves the ${role} toolchain, not ${body.role}`);
    if (image && digestOf(body.image) !== digestOf(image)) throw new RequestError(409, `toolchain mismatch: runner has ${image}, build pins ${body.image}`);
    validateRules(body.rules);
    const { mounts, cwd, argv, env } = body;
    if (!Array.isArray(mounts) || mounts.length === 0 || mounts.length > MAX_MOUNTS) throw new RequestError(400, `mounts must list 1 to ${MAX_MOUNTS} folders`);
    mounts.forEach((mount) => validateMount(mount, mountPrefixes));
    if (mounts.some((a, i) => mounts.some((b, j) => i !== j && isWithin(a.path, b.path)))) throw new RequestError(400, 'mounts must not overlap');
    const allowedCwd = isCleanAbsolute(cwd) && [...mounts.map((mount) => mount.path), ...scratchDirs].some((dir) => isWithin(cwd, dir));
    if (!allowedCwd) throw new RequestError(400, 'cwd must be inside a mount or a scratch folder');
    if (!isStringArray(argv) || argv.length === 0) throw new RequestError(400, 'argv must be a non-empty string array');
    if (!env || typeof env !== 'object' || !Object.values(env).every((value) => typeof value === 'string')) throw new RequestError(400, 'env must map names to strings');
}

// A command never sees the runner's own settings, its token above all.
const commandEnv = (env) => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('CROSSBIND_RUNNER_'))),
    ...env,
});

// The job count a client wrote for its own machine means nothing here: a step runs as many jobs as this
// runner has cores.
const withJobs = (argv, jobs) => argv.map((arg, i) => {
    if (/^-j\d+$/.test(arg)) return `-j${jobs}`;
    return /^\d+$/.test(arg) && argv[i - 1] === '-j' ? String(jobs) : arg;
});

function runCommand({ argv: given, cwd, env }, line, jobs) {
    const argv = withJobs(given, jobs);
    return new Promise((resolve) => {
        const child = spawn(argv[0], argv.slice(1), { cwd, env: commandEnv(env) });
        child.stdout.on('data', (data) => line({ stdout: data.toString() }));
        child.stderr.on('data', (data) => line({ stderr: data.toString() }));
        child.on('error', (error) => {
            line({ stderr: `crossbind runner: ${error.message}\n` });
            resolve(127);
        });
        child.on('close', (code) => resolve(code ?? 1));
    });
}

export function createRunnerServer({
    mountPrefixes = DEFAULT_MOUNT_PREFIXES, scratchDirs = DEFAULT_SCRATCH_DIRS, blobDir, token, image, role, heartbeatMs = HEARTBEAT_MS,
    jobs = os.availableParallelism(),
}) {
    if (!token) throw new Error('crossbind runner: a token is required - the runner runs build commands for whoever holds it.');
    if (token.length < MIN_TOKEN_LENGTH) throw new Error(`crossbind runner: the token needs at least ${MIN_TOKEN_LENGTH} characters.`);
    const blobs = createBlobStore(blobDir);
    const indexes = new Map();
    const indexFor = (mountPath) => {
        if (!indexes.has(mountPath)) indexes.set(mountPath, new Map());
        return indexes.get(mountPath);
    };
    let queue = Promise.resolve();

    function syncMount(mount, rules) {
        fs.mkdirSync(mount.path, { recursive: true });
        const current = hashIndex(mount.path, snapshot(mount.path, mount.roots, rules), indexFor(mount.path));
        applySync(mount.path, planSync(current, mount.manifest), mount.manifest, blobs.pathOf);
        // The host creates folders before a step writes into them (`-o build/bridge/x.cpp`), so even empty ones travel.
        mount.dirs.forEach((rel) => fs.mkdirSync(path.join(mount.path, rel), { recursive: true }));
    }

    // One command at a time: each mount is a single tree, as with a local docker run.
    async function execute(body, line) {
        body.mounts.forEach((mount) => syncMount(mount, body.rules));
        // Outputs come back whatever their type: the glue JavaScript a link writes is the build's product.
        const outputRules = { ...body.rules, extensions: [] };
        const isStore = (root) => root.includes('*');
        const outputsOf = (mount) => snapshot(mount.path, mount.outputRoots.filter((root) => !isStore(root)), outputRules, { outputs: true });
        // A store unit (a crate version, a conan package folder) never changes once written, so every unit the
        // client does not report travels whole, touched by this command or not, and the rest are not walked.
        const storeFilesOf = (mount) => {
            const present = new Set(mount.present ?? []);
            const missing = expandRoots(mount.path, mount.outputRoots.filter(isStore)).filter((unit) => !present.has(unit));
            return snapshot(mount.path, missing, outputRules, { outputs: true });
        };
        const before = body.mounts.map(outputsOf);
        fs.mkdirSync(body.cwd, { recursive: true });
        const exit = await runCommand(body, line, jobs);

        const outputs = {};
        const removed = [];
        body.mounts.forEach((mount, i) => {
            const diffed = outputsOf(mount);
            const store = storeFilesOf(mount);
            const after = new Map([...diffed, ...store]);
            const diff = diffSnapshots(before[i], diffed);
            new Set([...diff.changed, ...store.keys()]).forEach((rel) => {
                const file = `${mount.path}/${rel}`;
                const data = fs.readFileSync(file);
                const entry = { sha256: blobs.putBuffer(data), mode: after.get(rel).mode, size: data.length };
                outputs[file] = entry;
                // Small outputs ride along in the stream; a larger one is fetched by its hash afterwards.
                if (data.length <= INLINE_OUTPUT_BYTES) line({ file, ...entry, data: data.toString('base64') });
            });
            removed.push(...diff.removed.map((rel) => `${mount.path}/${rel}`));
        });
        return { exit, outputs, removed };
    }

    async function handleExec(req, res) {
        const body = await readJson(req);
        validateExec(body, {
            mountPrefixes, scratchDirs, image, role,
        });
        const hashes = body.mounts.flatMap((mount) => Object.values(mount.manifest).map((entry) => entry.sha256));
        const missing = [...new Set(hashes)].filter((hash) => !blobs.has(hash));
        if (missing.length > 0) throw new RequestError(409, 'missing blobs', { missing });
        // The answer starts at once and heartbeats until the end: a step can wait behind another one longer than
        // a proxy, or the client's fetch, waits for a response.
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.flushHeaders();
        const line = (record) => res.write(`${JSON.stringify(record)}\n`);
        const heartbeat = setInterval(() => line({ heartbeat: true }), heartbeatMs);
        try {
            const run = queue.then(() => execute(body, line));
            queue = run.catch(() => {});
            res.end(`${JSON.stringify(await run)}\n`);
        } finally {
            clearInterval(heartbeat);
        }
    }

    // One JSON line per blob ({sha256, data: base64}), so a cold start uploads its inputs in a few requests.
    async function handleBatchUpload(req, res) {
        let stored = 0;
        for await (const text of readline.createInterface({ input: req, crlfDelay: Infinity })) {
            if (!text) continue;
            const { sha256, data } = JSON.parse(text);
            const bytes = Buffer.from(data ?? '', 'base64');
            if (!isHash(sha256) || sha256Of(bytes) !== sha256) throw new RequestError(400, `content does not match ${sha256}`);
            blobs.putBuffer(bytes);
            stored += 1;
        }
        send(res, 201, { stored });
    }

    async function route(req, res) {
        const url = new URL(req.url, 'http://runner');
        if (req.method === 'GET' && url.pathname === '/v1/health') return send(res, 200, { ok: true, protocol: PROTOCOL_VERSION, role, image });
        if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: 'invalid token' });

        if (req.method === 'POST' && url.pathname === '/v1/blobs') return handleBatchUpload(req, res);
        const blobMatch = url.pathname.match(/^\/v1\/blobs\/([^/]+)$/);
        if (blobMatch) {
            const hash = decodeURIComponent(blobMatch[1]);
            if (!isHash(hash)) return send(res, 400, { error: 'blob names are sha256 digests' });
            if (req.method === 'PUT' && req.headers['content-range'] !== undefined) {
                const range = CONTENT_RANGE.exec(req.headers['content-range']);
                const [start, end, total] = range ? range.slice(1).map(Number) : [];
                const upload = req.headers['x-crossbind-upload'];
                if (!range || start > end || end >= total || !isUploadId(upload)) {
                    return send(res, 400, { error: 'a part needs a content-range of bytes start-end/total and an x-crossbind-upload id' });
                }
                const result = await blobs.putPart(hash, upload, { start, end, total }, req);
                if (result.status === 'stored') return send(res, 201, { stored: hash });
                if (result.status === 'partial') return send(res, 202, { received: result.received });
                if (result.status === 'gap') return send(res, 409, { error: `the upload holds ${result.received} bytes, so its next part starts there`, received: result.received });
                return send(res, 400, { error: result.status === 'short' ? 'the part is not as long as its content-range says' : 'content does not match the hash' });
            }
            if (req.method === 'PUT') {
                return (await blobs.putStream(hash, req)) ? send(res, 201, { stored: hash }) : send(res, 400, { error: 'content does not match the hash' });
            }
            if (req.method === 'GET') {
                if (!blobs.has(hash)) return send(res, 404, { error: 'unknown blob' });
                res.writeHead(200, { 'content-type': 'application/octet-stream' });
                return fs.createReadStream(blobs.pathOf(hash)).pipe(res);
            }
        }
        if (req.method === 'POST' && url.pathname === '/v1/missing') {
            const { hashes } = await readJson(req);
            if (!isStringArray(hashes) || !hashes.every(isHash)) return send(res, 400, { error: 'hashes must be sha256 digests' });
            return send(res, 200, { missing: hashes.filter((hash) => !blobs.has(hash)) });
        }
        if (req.method === 'POST' && url.pathname === '/v1/exec') return handleExec(req, res);
        return send(res, 404, { error: 'not found' });
    }

    return http.createServer((req, res) => {
        route(req, res).catch((error) => {
            if (res.headersSent) {
                res.end(`${JSON.stringify({ exit: 1, error: error.message })}\n`);
                return;
            }
            send(res, error.status ?? 500, { error: error.message, ...error.extra });
        });
    });
}

const listFromEnv = (value, fallback) => (value ? value.split(',').map((item) => item.trim()).filter(Boolean) : fallback);

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
    const token = process.env.CROSSBIND_RUNNER_TOKEN;
    delete process.env.CROSSBIND_RUNNER_TOKEN;
    if (!token || token.length < MIN_TOKEN_LENGTH) {
        process.stderr.write(`crossbind runner: set CROSSBIND_RUNNER_TOKEN to at least ${MIN_TOKEN_LENGTH} characters - the runner runs build commands for whoever holds it.\n`);
        process.exit(1);
    }
    const server = createRunnerServer({
        mountPrefixes: listFromEnv(process.env.CROSSBIND_RUNNER_MOUNT_PREFIXES, DEFAULT_MOUNT_PREFIXES),
        scratchDirs: listFromEnv(process.env.CROSSBIND_RUNNER_SCRATCH_DIRS, DEFAULT_SCRATCH_DIRS),
        blobDir: process.env.CROSSBIND_RUNNER_BLOBS || '/tmp/crossbind-runner/blobs',
        token,
        image: process.env.CROSSBIND_RUNNER_IMAGE || '',
        role: process.env.CROSSBIND_RUNNER_ROLE || 'web',
    });
    const port = Number(process.env.CROSSBIND_RUNNER_PORT || DEFAULT_PORT);
    server.listen(port, '0.0.0.0', () => process.stdout.write(`crossbind runner (${process.env.CROSSBIND_RUNNER_ROLE || 'web'}) listening on ${port}\n`));
}
