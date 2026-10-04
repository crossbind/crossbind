#!/usr/bin/env node
// Installs a ready-made Node package the way a user does, from a registry, and runs its e2e/check.mjs:
// on this machine, then in glibc and musl containers of both architectures. The packages are packed
// and served by a registry this script runs, so npm picks the addon package by os, cpu and libc as it
// does from npmjs.org. Addons for machines nothing here runs are checked for the machine they target.
// Runs in ports/<family>/node after its build.

import { execFile, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const INSTALL_TIMEOUT_MS = 600000;
const OUTPUT_LIMIT = 64 * 1024 * 1024;
const CONTAINER_IMAGES = { glibc: 'node:24-bookworm-slim', musl: 'node:24-alpine' };
const CONTAINERS = [['glibc', 'arm64'], ['glibc', 'x64'], ['musl', 'arm64'], ['musl', 'x64']];
const DOCKER_ARCH = { arm64: 'arm64', x64: 'amd64' };
const PE_HEADER_OFFSET = 0x3c;
const PE_MACHINE = { x64: 0x8664, arm64: 0xaa64 };
const MACHO_MAGIC = 0xfeedfacf;
const MACHO_CPU = { x64: 0x01000007, arm64: 0x0100000c };

const root = process.cwd();
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const manifest = readManifest(root);
const [scope, baseName] = manifest.name.split('/');
const addonDirOf = (name) => path.join(root, '..', `node-${name.slice(manifest.name.length + 1)}`);
const addonPackages = Object.keys(manifest.optionalDependencies ?? {})
    .filter((name) => name.startsWith(`${manifest.name}-`))
    .map((name) => ({ name, dir: addonDirOf(name), ...readManifest(addonDirOf(name)) }));

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

// The registry answers from this process, so its clients run without blocking it.
function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { encoding: 'utf8', maxBuffer: OUTPUT_LIMIT, timeout: INSTALL_TIMEOUT_MS, ...options }, (error, stdout, stderr) => {
            process.stdout.write(stdout);
            process.stderr.write(stderr);
            if (error) reject(error);
            else resolve(stdout);
        });
    });
}

function pack(dir, destination) {
    const before = new Set(fs.readdirSync(destination));
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: dir, stdio: 'ignore' });
    const file = fs.readdirSync(destination).find((entry) => !before.has(entry));
    const packed = JSON.parse(execFileSync('tar', ['-xzOf', path.join(destination, file), 'package/package.json'], { encoding: 'utf8' }));
    const bytes = fs.readFileSync(path.join(destination, file));
    return { file, manifest: packed, integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}` };
}

// A packument per package, its tarball addressed through the host the client asked for.
function serve(packed, tarballDir) {
    const byName = new Map(packed.map((entry) => [entry.manifest.name, entry]));
    const server = http.createServer((request, response) => {
        const url = decodeURIComponent(request.url.split('?')[0]).slice(1);
        if (url.startsWith('-/tarballs/')) {
            const file = path.join(tarballDir, path.basename(url));
            if (!fs.existsSync(file)) return response.writeHead(404).end();
            response.writeHead(200, { 'content-type': 'application/octet-stream' });
            return fs.createReadStream(file).pipe(response);
        }
        const entry = byName.get(url);
        if (!entry) return response.writeHead(404, { 'content-type': 'application/json' }).end('{}');
        const { version } = entry.manifest;
        response.writeHead(200, { 'content-type': 'application/json' });
        return response.end(JSON.stringify({
            name: url,
            'dist-tags': { latest: version },
            versions: {
                [version]: {
                    ...entry.manifest,
                    dist: { tarball: `http://${request.headers.host}/-/tarballs/${entry.file}`, integrity: entry.integrity },
                },
            },
        }));
    });
    return new Promise((resolve) => {
        server.listen(0, '0.0.0.0', () => resolve(server));
    });
}

// The one addon package npm installed must be the one for the machine.
function checkInstalled(label, listing, expected) {
    const installed = listing.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${baseName}-`));
    if (installed.length !== 1 || installed[0] !== expected) {
        fail(`${label} installed ${installed.join(', ') || 'no addon package'}, expected ${expected}`);
    }
    console.log(`ok: ${label} installed ${scope}/${expected} alone`);
}

async function runHost(port, checkDir) {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-package-'));
    try {
        fs.writeFileSync(path.join(app, 'package.json'), '{"name":"e2e","private":true}\n');
        await run('npm', [
            'install', `${manifest.name}@${manifest.version}`, '--registry', `http://127.0.0.1:${port}`,
            '--no-audit', '--no-fund', '--loglevel', 'error', '--cache', path.join(app, '.npm'),
        ], { cwd: app });
        fs.copyFileSync(path.join(checkDir, 'check.mjs'), path.join(app, 'check.mjs'));
        await run('node', ['check.mjs'], { cwd: app, env: { ...process.env, NATIVE_VERSION: manifest.nativeVersion } });
        const label = `${process.platform}-${process.arch} host`;
        checkInstalled(label, fs.readdirSync(path.join(app, 'node_modules', scope)).join('\n'), `${baseName}-${process.platform}-${process.arch}`);
    } finally {
        fs.rmSync(app, { recursive: true, force: true });
    }
}

async function runContainer(port, checkDir, libc, arch) {
    const platform = libc === 'musl' ? 'linuxmusl' : 'linux';
    const script = [
        'set -e',
        'mkdir -p /tmp/app && cd /tmp/app',
        'echo \'{"name":"e2e","private":true}\' > package.json',
        `npm install ${manifest.name}@${manifest.version} --registry http://host.docker.internal:${port} --no-audit --no-fund --loglevel error`,
        'cp /check/check.mjs . && node check.mjs',
        `ls node_modules/${scope}`,
    ].join('\n');
    const output = await run('docker', [
        'run', '--rm', '--platform', `linux/${DOCKER_ARCH[arch]}`, '--add-host', 'host.docker.internal:host-gateway',
        '-e', `NATIVE_VERSION=${manifest.nativeVersion}`, '-v', `${checkDir}:/check:ro`,
        CONTAINER_IMAGES[libc], 'sh', '-c', script,
    ]);
    checkInstalled(`${platform}-${arch} in ${CONTAINER_IMAGES[libc]}`, output, `${baseName}-${platform}-${arch}`);
}

function targetOf(file) {
    const bytes = fs.readFileSync(file);
    if (bytes.readUInt32LE(0) === MACHO_MAGIC) return { format: 'Mach-O', cpu: bytes.readUInt32LE(4) };
    if (bytes.toString('latin1', 0, 2) === 'MZ') return { format: 'PE', cpu: bytes.readUInt16LE(bytes.readUInt32LE(PE_HEADER_OFFSET) + 4) };
    return { format: 'other' };
}

// The macOS and Windows addons of machines neither the host nor a container runs.
function checkUnrun() {
    addonPackages
        .filter(({ os: [system], cpu: [arch] }) => system !== 'linux' && `${system}-${arch}` !== `${process.platform}-${process.arch}`)
        .forEach(({ name, dir, main, os: [system], cpu: [arch] }) => {
            const expected = system === 'win32' ? { format: 'PE', cpu: PE_MACHINE[arch] } : { format: 'Mach-O', cpu: MACHO_CPU[arch] };
            const actual = targetOf(path.join(dir, main));
            if (actual.format !== expected.format || actual.cpu !== expected.cpu) fail(`${name} does not target ${system}-${arch}`);
            console.log(`ok: ${name} targets ${system}-${arch}, not run`);
        });
}

const missing = addonPackages.filter(({ dir, main }) => !fs.existsSync(path.join(dir, main))).map(({ name }) => name);
if (missing.length) fail(`not built: ${missing.join(', ')}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-registry-'));
const server = await serve([root, ...addonPackages.map(({ dir }) => dir)].map((dir) => pack(dir, work)), work);
try {
    const { port } = server.address();
    const checkDir = path.join(root, 'e2e');
    await runHost(port, checkDir);
    for (const [libc, arch] of CONTAINERS) await runContainer(port, checkDir, libc, arch);
    checkUnrun();
} finally {
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
}
