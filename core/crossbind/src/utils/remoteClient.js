// One toolchain step on the remote runner: send what changed below each mount's input roots, stream the
// step's output, write the files it produced back through the mounts, exit with its exit code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { walk, hashIndex, presentUnits } from '../runner/files.js';
import { isHash } from '../runner/blobs.js';
import { getContentHash } from './hash.js';
import { outputTarget, writeOutputFile, removeOutputFile } from './remoteOutputs.js';
import { request, expectOk, uploadMissing } from './remoteUpload.js';

const INDEX_DIR = path.join(os.homedir(), '.crossbind', 'remote-index');

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

function describeMount(mount, rules, index) {
    const { files, dirs } = walk(mount.host, mount.inputRoots, rules);
    const hashes = hashIndex(mount.host, files, index);
    const manifest = Object.fromEntries([...hashes].map(([rel, sha256]) => [rel, { sha256, mode: files.get(rel).mode }]));
    const sources = [...hashes].map(([rel, sha256]) => [sha256, path.join(mount.host, rel)]);
    return { manifest, dirs, sources };
}

function writeOutput(target, entry, data, indexes) {
    if (getContentHash(data) !== entry.sha256) throw new Error(`crossbind: ${target.file} arrived from the remote runner with the wrong content.`);
    writeOutputFile(target, data, entry.mode);
    const { size, mtimeMs } = fs.statSync(target.file);
    indexes.get(target.mount).set(target.rel, { size, mtimeMs, sha256: entry.sha256 });
}

async function runStep(payload, described, present, indexes, received) {
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
            present: present[i],
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
            writeOutput(outputTarget(payload.mounts, present, record.file), record, Buffer.from(record.data, 'base64'), indexes);
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
async function writeOutputs(payload, result, present, indexes, received) {
    for (const [file, entry] of Object.entries(result.outputs).filter(([name]) => !received.has(name))) {
        const target = outputTarget(payload.mounts, present, file);
        if (!isHash(entry.sha256)) throw new Error(`crossbind: the remote runner named ${file} without a sha256 digest.`);
        const response = await request(payload.url, `/v1/blobs/${entry.sha256}`);
        if (response.status !== 200) throw new Error(`crossbind: could not download ${file} from the remote runner (${response.status}).`);
        writeOutput(target, entry, Buffer.from(await response.arrayBuffer()), indexes);
    }
    result.removed.forEach((file) => {
        const target = outputTarget(payload.mounts, present, file);
        removeOutputFile(target);
        indexes.get(target.mount).delete(target.rel);
    });
}

async function main() {
    const payload = JSON.parse(process.argv[2]);
    const indexes = new Map(payload.mounts.map((mount) => [mount, loadIndex(mount)]));
    const described = payload.mounts.map((mount) => describeMount(mount, payload.rules, indexes.get(mount)));
    await uploadMissing(payload.url, new Map(described.flatMap((d) => d.sources)));

    // The store units this machine holds before the step: the runner sends only the others, and may write only those.
    const present = payload.mounts.map((mount) => presentUnits(mount.host, mount.outputRoots));
    const received = new Set();
    const result = await runStep(payload, described, present, indexes, received);
    await writeOutputs(payload, result, present, indexes, received);
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
