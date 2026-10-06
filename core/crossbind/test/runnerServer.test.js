import {
    describe, test, expect, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { createRunnerServer, PROTOCOL_VERSION } from '../src/runner/server.js';
import { createBlobStore } from '../src/runner/blobs.js';

const RULES = {
    dirs: ['node_modules', '.git'],
    extensions: ['.js'],
    serverOnly: { names: ['target', 'target-mt'], marker: 'Cargo.toml', keep: ['*/release/*.a'] },
};
const IMAGE = 'ghcr.io/crossbind/web@sha256:1111';
const TOKEN = 'secret-token-for-tests';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.close(resolve); })));
});

async function start(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-root-'));
    const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));
    const server = createRunnerServer({
        mountPrefixes: [root], scratchDirs: [`${root}/scratch`], blobDir, token: TOKEN, image: IMAGE, role: 'web', ...options,
    });
    servers.push(server);
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const call = (route, init = {}) => fetch(`${url}${route}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, ...init.headers } });
    return {
        url, root, live: `${root}/live`, call,
    };
}

const mount = (mountPath, fields = {}) => ({
    path: mountPath, roots: [], outputRoots: [], manifest: {}, dirs: [], ...fields,
});

async function upload(call, text) {
    const response = await call(`/v1/blobs/${sha(text)}`, { method: 'PUT', body: text });
    expect(response.status).toBe(201);
    return sha(text);
}

async function exec(call, body) {
    const response = await call('/v1/exec', {
        method: 'POST',
        body: JSON.stringify({
            role: 'web', image: IMAGE, rules: RULES, env: {}, ...body,
        }),
    });
    if (response.status !== 200) return { status: response.status, body: await response.json() };
    const records = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    return {
        status: 200,
        records,
        stdout: records.map((record) => record.stdout ?? '').join(''),
        files: records.filter((record) => record.file),
        result: records.at(-1),
    };
}

// The runner serves only inside the Linux toolchain image.
describe.skipIf(process.platform === 'win32')('runner server', () => {
    test('refuses to start without a token, or with one too short to resist guessing', () => {
        const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));

        expect(() => createRunnerServer({ blobDir, role: 'web' })).toThrow(/token is required/);
        expect(() => createRunnerServer({ blobDir, role: 'web', token: 'short' })).toThrow(/at least 16 characters/);
    });

    test('keeps the runner\'s own settings, its token above all, out of the commands it runs', async () => {
        vi.stubEnv('CROSSBIND_RUNNER_TOKEN', TOKEN);
        const runner = await start();

        const run = await exec(runner.call, { mounts: [mount(runner.live)], cwd: runner.live, argv: ['sh', '-c', 'echo "[$CROSSBIND_RUNNER_TOKEN]"'] });

        expect(run.stdout).toBe('[]\n');
        vi.unstubAllEnvs();
    });

    test('answers a step that waits behind another at once and keeps it alive until its turn', async () => {
        const runner = await start({ heartbeatMs: 20 });
        const first = exec(runner.call, { mounts: [mount(runner.live)], cwd: runner.live, argv: ['sh', '-c', 'sleep 1'] });
        await new Promise((resolve) => { setTimeout(resolve, 100); });

        const sent = Date.now();
        const second = await runner.call('/v1/exec', {
            method: 'POST',
            body: JSON.stringify({
                role: 'web', image: IMAGE, rules: RULES, env: {}, mounts: [mount(runner.live)], cwd: runner.live, argv: ['true'],
            }),
        });
        const answeredAfter = Date.now() - sent;
        const records = (await second.text()).trim().split('\n').map((text) => JSON.parse(text));

        expect(second.status).toBe(200);
        expect(answeredAfter).toBeLessThan(500);
        expect(records.some((record) => record.heartbeat)).toBe(true);
        expect(records.at(-1).exit).toBe(0);
        expect((await first).result.exit).toBe(0);
    });

    test('answers health without the token and everything else only with it', async () => {
        const runner = await start();

        const health = await (await fetch(`${runner.url}/v1/health`)).json();
        const refused = await fetch(`${runner.url}/v1/missing`, { method: 'POST', body: '{"hashes":[]}' });

        expect(health).toEqual({
            ok: true, protocol: PROTOCOL_VERSION, role: 'web', image: IMAGE,
        });
        expect(refused.status).toBe(401);
    });

    test('lists missing blobs and stores an upload only when its content matches the hash', async () => {
        const runner = await start();
        const hash = sha('hello');

        const before = await (await runner.call('/v1/missing', { method: 'POST', body: JSON.stringify({ hashes: [hash] }) })).json();
        const wrong = await runner.call(`/v1/blobs/${hash}`, { method: 'PUT', body: 'tampered' });
        await upload(runner.call, 'hello');
        const after = await (await runner.call('/v1/missing', { method: 'POST', body: JSON.stringify({ hashes: [hash] }) })).json();
        const download = await (await runner.call(`/v1/blobs/${hash}`)).text();

        expect(before.missing).toEqual([hash]);
        expect(wrong.status).toBe(400);
        expect(after.missing).toEqual([]);
        expect(download).toBe('hello');
    });

    test('stores many blobs from one batch request and refuses a batch with a mismatched entry', async () => {
        const runner = await start();
        const line = (text, hash = sha(text)) => JSON.stringify({ sha256: hash, data: Buffer.from(text).toString('base64') });

        const stored = await runner.call('/v1/blobs', { method: 'POST', body: [line('one'), line('two')].join('\n') });
        const refused = await runner.call('/v1/blobs', { method: 'POST', body: line('three', sha('other')) });
        const { missing } = await (await runner.call('/v1/missing', { method: 'POST', body: JSON.stringify({ hashes: [sha('one'), sha('two'), sha('three')] }) })).json();

        expect(stored.status).toBe(201);
        expect(refused.status).toBe(400);
        expect(missing).toEqual([sha('three')]);
    });

    test('rejects blob names that are not sha256 digests', async () => {
        const runner = await start();
        const response = await runner.call('/v1/blobs/..%2F..%2Fetc%2Fpasswd', { method: 'PUT', body: 'x' });
        expect(response.status).toBe(400);
    });

    test('runs the command in the synced mount, streams its output and returns the files it wrote by container path', async () => {
        const runner = await start();
        const input = await upload(runner.call, 'hello');

        const run = await exec(runner.call, {
            mounts: [mount(runner.live, { roots: ['app/src'], outputRoots: ['app/out'], manifest: { 'app/src/in.txt': { sha256: input, mode: 0o644 } } })],
            cwd: `${runner.live}/app`,
            argv: ['sh', '-c', 'mkdir -p out && cat src/in.txt > out/out.txt && echo done'],
        });
        const out = `${runner.live}/app/out/out.txt`;

        expect(run.result.exit).toBe(0);
        expect(run.stdout).toBe('done\n');
        expect(run.result.outputs[out].sha256).toBe(sha('hello'));
        expect(Buffer.from(run.files.find((record) => record.file === out).data, 'base64').toString()).toBe('hello');
    });

    test('removes files the client no longer has before the command runs', async () => {
        const runner = await start();
        const input = await upload(runner.call, 'stale');
        const cwd = `${runner.live}/app`;
        await exec(runner.call, { mounts: [mount(runner.live, { roots: ['app/src'], manifest: { 'app/src/a.cpp': { sha256: input, mode: 0o644 } } })], cwd, argv: ['true'] });

        const run = await exec(runner.call, { mounts: [mount(runner.live, { roots: ['app/src'] })], cwd, argv: ['sh', '-c', 'test -e src/a.cpp && echo present || echo absent'] });

        expect(run.stdout).toBe('absent\n');
    });

    test('creates the folders the client has, empty ones included, before the command runs', async () => {
        const runner = await start();
        const run = await exec(runner.call, {
            mounts: [mount(runner.live, { roots: ['app/.crossbind'], dirs: ['app/.crossbind/build/bridge'] })],
            cwd: `${runner.live}/app`,
            argv: ['sh', '-c', 'test -d .crossbind/build/bridge && echo exists'],
        });
        expect(run.stdout).toBe('exists\n');
    });

    test('returns a second mount\'s outputs only from its output roots and never deletes in a mount without roots', async () => {
        const runner = await start();
        const cache = `${runner.root}/cache`;
        fs.mkdirSync(`${cache}/registry/index`, { recursive: true });
        fs.writeFileSync(`${cache}/registry/index/kept`, 'x');

        const run = await exec(runner.call, {
            mounts: [mount(runner.live), mount(cache, { outputRoots: ['registry/src'] })],
            cwd: `${runner.root}/scratch`,
            argv: ['sh', '-c', `mkdir -p ${cache}/registry/src/semver ${cache}/registry/cache && echo src > ${cache}/registry/src/semver/lib.rs && echo crate > ${cache}/registry/cache/semver.crate`],
        });

        expect(Object.keys(run.result.outputs)).toEqual([`${cache}/registry/src/semver/lib.rs`]);
        expect(fs.existsSync(`${cache}/registry/index/kept`)).toBe(true);
    });

    test('returns outputs below wildcard output roots only, so a conan store sends package folders and keeps build folders', async () => {
        const runner = await start();
        const store = `${runner.root}/store`;

        const run = await exec(runner.call, {
            mounts: [mount(store, { outputRoots: ['b/*/p'] })],
            cwd: `${runner.root}/scratch`,
            argv: ['sh', '-c', `mkdir -p ${store}/b/fmt1/p/lib ${store}/b/fmt1/b && echo a > ${store}/b/fmt1/p/lib/libfmt.a && echo o > ${store}/b/fmt1/b/obj.o`],
        });

        expect(Object.keys(run.result.outputs)).toEqual([`${store}/b/fmt1/p/lib/libfmt.a`]);
    });

    test('sends a whole store unit the client lacks even when the command did not touch it, and none the client has', async () => {
        const runner = await start();
        const cache = `${runner.root}/cargo`;
        fs.mkdirSync(`${cache}/registry/src/index/semver-1.0.0`, { recursive: true });
        fs.writeFileSync(`${cache}/registry/src/index/semver-1.0.0/lib.rs`, 'pub fn x() {}');
        const step = (present) => exec(runner.call, {
            mounts: [mount(cache, { outputRoots: ['registry/src/*/*'], present })],
            cwd: `${runner.root}/scratch`,
            argv: ['true'],
        });

        const cold = await step([]);
        const warm = await step(['registry/src/index/semver-1.0.0']);

        expect(Object.keys(cold.result.outputs)).toEqual([`${cache}/registry/src/index/semver-1.0.0/lib.rs`]);
        expect(Object.keys(warm.result.outputs)).toEqual([]);
    });

    test('keeps a cargo target folder on the runner across syncs and returns only its release archives', async () => {
        const runner = await start();
        const toml = await upload(runner.call, '[package]');
        const crate = { roots: ['app/crate'], outputRoots: ['app/crate'], manifest: { 'app/crate/Cargo.toml': { sha256: toml, mode: 0o644 } } };
        const cwd = `${runner.live}/app/crate`;

        const build = await exec(runner.call, {
            mounts: [mount(runner.live, crate)],
            cwd,
            argv: ['sh', '-c', 'mkdir -p target/wasm/release/deps && echo a > target/wasm/release/libcrate.a && echo r > target/wasm/release/deps/libdep.rlib'],
        });
        const again = await exec(runner.call, { mounts: [mount(runner.live, crate)], cwd, argv: ['sh', '-c', 'test -e target/wasm/release/deps/libdep.rlib && echo kept'] });

        expect(Object.keys(build.result.outputs)).toEqual([`${runner.live}/app/crate/target/wasm/release/libcrate.a`]);
        expect(again.stdout).toBe('kept\n');
    });

    test('keeps a quiet command\'s response alive with heartbeats, so a proxy in front does not cut it', async () => {
        const runner = await start({ heartbeatMs: 20 });

        const run = await exec(runner.call, { mounts: [mount(runner.live)], cwd: runner.live, argv: ['sh', '-c', 'sleep 0.2'] });

        expect(run.records.filter((record) => record.heartbeat).length).toBeGreaterThan(0);
        expect(run.result.exit).toBe(0);
    });

    test('runs a step with as many jobs as the runner has cores, whatever count the client wrote for its own machine', async () => {
        const runner = await start({ jobs: 3 });

        const run = await exec(runner.call, { mounts: [mount(runner.live)], cwd: runner.live, argv: ['echo', 'make', '-j15', 'all', '-j', '15', '-jx'] });

        expect(run.stdout).toBe('make -j3 all -j 3 -jx\n');
    });

    test('passes the exit code of a failing command through', async () => {
        const runner = await start();
        const run = await exec(runner.call, { mounts: [mount(runner.live)], cwd: runner.live, argv: ['sh', '-c', 'exit 3'] });
        expect(run.result.exit).toBe(3);
    });

    test('accepts the same toolchain digest from another registry and refuses a different one', async () => {
        const runner = await start();
        const step = (image) => exec(runner.call, {
            image, mounts: [mount(runner.live)], cwd: runner.live, argv: ['true'],
        });

        const mirrored = await step('registry.example.dev/crossbind/web@sha256:1111');
        const other = await step('ghcr.io/crossbind/web@sha256:2222');

        expect(mirrored.status).toBe(200);
        expect(other.status).toBe(409);
    });

    test('refuses mounts, paths and folders that leave what the runner allows', async () => {
        const runner = await start();
        const ok = { mounts: [mount(runner.live, { roots: ['app'] })], cwd: runner.live, argv: ['true'] };
        const withLive = (fields) => ({ ...ok, mounts: [mount(runner.live, { roots: ['app'], ...fields })] });

        const statuses = await Promise.all([
            exec(runner.call, { ...ok, mounts: [mount('/etc')] }),
            exec(runner.call, { ...ok, mounts: [mount(runner.live), mount(`${runner.live}/app`)] }),
            exec(runner.call, withLive({ manifest: { 'app/../../x': { sha256: sha('x'), mode: 0o644 } } })),
            exec(runner.call, withLive({ roots: ['../'] })),
            exec(runner.call, withLive({ manifest: { 'other/x.cpp': { sha256: sha('x'), mode: 0o644 } } })),
            exec(runner.call, withLive({ dirs: ['../outside'] })),
            exec(runner.call, { ...ok, cwd: '/etc' }),
            exec(runner.call, { ...ok, rules: { ...RULES, files: '.env' } }),
            exec(runner.call, { ...ok, cwd: `${runner.root}/scratch` }),
        ]).then((runs) => runs.map((run) => run.status));

        expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 400, 400, 200]);
    });
});

describe('blob store', () => {
    test('leaves no temporary file behind when an upload breaks off', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runner-blobs-'));
        const broken = new Readable({
            read() {
                this.push('partial');
                this.destroy(new Error('connection reset'));
            },
        });

        await expect(createBlobStore(dir).putStream(sha('whole'), broken)).rejects.toThrow(/connection reset/);
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});
