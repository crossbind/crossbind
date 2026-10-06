// One toolchain step on the remote runner: send what changed below each mount's input roots, stream the
// step's output, write the files it produced back through the mounts, exit with its exit code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    walk, hashIndex, hostPathOf, presentUnits,
} from '../runner/files.js';
import { getContentHash } from './hash.js';

const INDEX_DIR = path.join(os.homedir(), '.crossbind', 'remote-index');
// Raw bytes per upload request; a larger file still travels, alone.
const UPLOAD_BATCH_BYTES = 16 * 1024 * 1024;

const indexFileOf = (mount) => path.join(INDEX_DIR, `${getContentHash(`${mount.host}\n${mount.container}`).slice(0, 16)}.json`);

function loadIndex(mount) {
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(indexFileOf(mount), 'utf8'))));
    } catch {
        return new Map();
    }
}

function saveIndex(mount, index) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(indexFileOf(mount), JSON.stringify(Object.fromEntries(index)));
}

async function request(url, route, init = {}) {
    const token = process.env.CROSSBIND_TOKEN;
    const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers };
    try {
        return await fetch(`${url}${route}`, { ...init, headers });
    } catch (error) {
        throw new Error(`crossbind: the remote runner at ${url} is unreachable (${error.cause?.code ?? error.message}).`, { cause: error });
    }
}

async function expectOk(response, what) {
    if (response.ok) return response.json();
    const body = await response.json().catch(() => ({}));
    throw new Error(`crossbind: the remote runner failed ${what}: ${body.error ?? response.status}.`);
}

function describeMount(mount, rules, index) {
    const { files, dirs } = walk(mount.host, mount.inputRoots, rules);
    const hashes = hashIndex(mount.host, files, index);
    const manifest = Object.fromEntries([...hashes].map(([rel, sha256]) => [rel, { sha256, mode: files.get(rel).mode }]));
    const sources = [...hashes].map(([rel, sha256]) => [sha256, path.join(mount.host, rel)]);
    return { manifest, dirs, sources };
}

// `sources` maps each hash to a file holding it; only what the runner lacks travels, in a few batches.
async function uploadMissing(url, sources) {
    const listing = await request(url, '/v1/missing', { method: 'POST', body: JSON.stringify({ hashes: [...sources.keys()] }) });
    const { missing } = await expectOk(listing, 'to list the files it lacks');
    let batch = [];
    let size = 0;
    const flush = async () => {
        if (batch.length === 0) return;
        const body = batch.map(({ hash, data }) => JSON.stringify({ sha256: hash, data: data.toString('base64') })).join('\n');
        await expectOk(await request(url, '/v1/blobs', { method: 'POST', body }), `to receive ${batch.length} files`);
        batch = [];
        size = 0;
    };
    for (const hash of missing) {
        const data = fs.readFileSync(sources.get(hash));
        if (size > 0 && size + data.length > UPLOAD_BATCH_BYTES) await flush();
        batch.push({ hash, data });
        size += data.length;
    }
    await flush();
}

function writeOutput(target, entry, data, indexes) {
    if (getContentHash(data) !== entry.sha256) throw new Error(`crossbind: ${target.file} arrived from the remote runner with the wrong content.`);
    fs.mkdirSync(path.dirname(target.file), { recursive: true });
    fs.writeFileSync(target.file, data);
    fs.chmodSync(target.file, entry.mode);
    const { size, mtimeMs } = fs.statSync(target.file);
    indexes.get(target.mount).set(target.rel, { size, mtimeMs, sha256: entry.sha256 });
}

async function runStep(payload, described, indexes, received) {
    const body = {
        role: payload.role,
        image: payload.image,
        rules: payload.rules,
        cwd: payload.cwd,
        argv: payload.argv,
        env: payload.env,
        mounts: payload.mounts.map((mount, i) => ({
            path: mount.container,
            roots: mount.inputRoots,
            outputRoots: mount.outputRoots,
            manifest: described[i].manifest,
            dirs: described[i].dirs,
            present: presentUnits(mount.host, mount.outputRoots),
        })),
    };
    const response = await request(payload.url, '/v1/exec', { method: 'POST', body: JSON.stringify(body) });
    if (response.status !== 200) await expectOk(response, 'to run the step');

    const decoder = new TextDecoder();
    let pending = '';
    let result = null;
    const handle = (record) => {
        if ('exit' in record) result = record;
        if (record.stdout) process.stdout.write(record.stdout);
        if (record.stderr) process.stderr.write(record.stderr);
        if (record.file) {
            writeOutput(hostPathOf(payload.mounts, record.file), record, Buffer.from(record.data, 'base64'), indexes);
            received.add(record.file);
        }
    };
    for await (const chunk of response.body) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf('\n');
        while (newline !== -1) {
            if (newline > 0) handle(JSON.parse(pending.slice(0, newline)));
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
        }
    }
    if (!result) throw new Error('crossbind: the remote runner closed the connection before the step finished.');
    if (result.error) throw new Error(`crossbind: the remote runner failed during the step: ${result.error}.`);
    return result;
}

// Outputs too large for the stream are fetched by hash.
async function writeOutputs(payload, result, indexes, received) {
    for (const [file, entry] of Object.entries(result.outputs).filter(([name]) => !received.has(name))) {
        const response = await request(payload.url, `/v1/blobs/${entry.sha256}`);
        if (response.status !== 200) throw new Error(`crossbind: could not download ${file} from the remote runner (${response.status}).`);
        writeOutput(hostPathOf(payload.mounts, file), entry, Buffer.from(await response.arrayBuffer()), indexes);
    }
    result.removed.forEach((file) => {
        const target = hostPathOf(payload.mounts, file);
        fs.rmSync(target.file, { force: true });
        indexes.get(target.mount).delete(target.rel);
    });
}

async function main() {
    const payload = JSON.parse(process.argv[2]);
    const indexes = new Map(payload.mounts.map((mount) => [mount, loadIndex(mount)]));
    const described = payload.mounts.map((mount) => describeMount(mount, payload.rules, indexes.get(mount)));
    await uploadMissing(payload.url, new Map(described.flatMap((d) => d.sources)));

    const received = new Set();
    const result = await runStep(payload, described, indexes, received);
    await writeOutputs(payload, result, indexes, received);
    indexes.forEach((index, mount) => saveIndex(mount, index));
    return result.exit;
}

main().then(
    (code) => process.exit(code),
    (error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    },
);
