import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCompileServer, MAX_BODY_BYTES } from '../compiler/server.js';
import { WorkspaceError } from '../compiler/compile.js';

const servers = [];

afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.close(resolve); })));
});

async function start(options) {
    const server = createCompileServer({ log: () => {}, onRecycle: () => {}, ...options });
    servers.push(server);
    await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    const compileRequest = (body) => fetch(`${url}/compile`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
    return { url, compileRequest };
}

const valid = { files: { 'native.h': 'int answer();' } };

test('answers its health check with the number of compiles so far', async () => {
    const { url } = await start({ compileFiles: async () => ({ ok: true }) });

    const response = await fetch(`${url}/health`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, compiles: 0 });
});

test('compiles the validated files and returns the result', async () => {
    let received;
    const { compileRequest } = await start({ compileFiles: async (files) => { received = files; return { ok: true, js: 'x' }; } });

    const response = await compileRequest(valid);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, js: 'x' });
    assert.deepEqual(received, { 'native.h': 'int answer();', 'native.cpp': '' });
});

test('refuses a body that is not JSON or not two sources, before it takes a place in the queue', async () => {
    let calls = 0;
    const { compileRequest } = await start({ compileFiles: async () => { calls += 1; return { ok: true }; } });

    const notJson = await compileRequest('{"files":');
    const wrongFile = await compileRequest({ files: { 'native.h': '', 'build.sh': 'curl evil' } });

    assert.equal(notJson.status, 400);
    assert.match((await notJson.json()).error, /not JSON/);
    assert.equal(wrongFile.status, 400);
    assert.match((await wrongFile.json()).error, /Only native\.h and native\.cpp compile/);
    assert.equal(calls, 0);
});

test('refuses a body over the size limit', async () => {
    const { compileRequest } = await start({ compileFiles: async () => ({ ok: true }) });

    const response = await compileRequest({ files: { 'native.h': 'x'.repeat(MAX_BODY_BYTES) } });

    assert.equal(response.status, 413);
});

test('answers anything else with 404', async () => {
    const { url } = await start({ compileFiles: async () => ({ ok: true }) });

    assert.equal((await fetch(`${url}/compile`)).status, 404);
    assert.equal((await fetch(`${url}/v1/exec`, { method: 'POST', body: '{}' })).status, 404);
});

test('runs one compile at a time and turns callers away once the queue is full', async () => {
    let running = 0;
    let most = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { compileRequest } = await start({
        maxInFlight: 2,
        compileFiles: async () => {
            running += 1;
            most = Math.max(most, running);
            await gate;
            running -= 1;
            return { ok: true };
        },
    });

    const first = compileRequest(valid);
    const second = compileRequest(valid);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const third = await compileRequest(valid);
    release();

    assert.equal(third.status, 503);
    assert.deepEqual([(await first).status, (await second).status], [200, 200]);
    assert.equal(most, 1);
});

test('hides the reason of an internal failure from the caller', async () => {
    const { compileRequest } = await start({ compileFiles: async () => { throw new Error('/srv/playground/work is full'); } });

    const response = await compileRequest(valid);

    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal error.' });
});

test('asks to be recycled once it has compiled enough and nothing is running', async () => {
    let recycled = 0;
    const { compileRequest } = await start({ recycleAfter: 2, onRecycle: () => { recycled += 1; }, compileFiles: async () => ({ ok: true }) });

    await compileRequest(valid);
    assert.equal(recycled, 0);
    await compileRequest(valid);

    assert.equal(recycled, 1);
});

test('turns new work away once it is due to recycle, and recycles after the last answer has gone out', async () => {
    let recycled = 0;
    const gates = [0, 1].map(() => {
        let open;
        const opened = new Promise((resolve) => { open = resolve; });
        return { open, opened };
    });
    let calls = 0;
    const { url, compileRequest } = await start({
        recycleAfter: 1,
        maxInFlight: 3,
        onRecycle: () => { recycled += 1; },
        compileFiles: async () => {
            await gates[calls++].opened;
            return { ok: true, js: 'x'.repeat(256 * 1024) };
        },
    });
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 50); });

    const first = compileRequest(valid);
    const second = compileRequest(valid);
    await settle();
    gates[0].open();
    const firstResponse = await first;
    const third = await compileRequest(valid);
    const health = await fetch(`${url}/health`);
    const recycledWhileBusy = recycled;
    gates[1].open();
    const secondBody = await (await second).json();
    await settle();

    assert.deepEqual([firstResponse.status, third.status, health.status], [200, 503, 503]);
    assert.equal(secondBody.js.length, 256 * 1024);
    assert.deepEqual([recycledWhileBusy, recycled], [0, 1]);
});

test('answers 500 and recycles when its workspace can no longer be used', async () => {
    let recycled = 0;
    const { url, compileRequest } = await start({
        onRecycle: () => { recycled += 1; },
        compileFiles: async () => { throw new WorkspaceError('/srv/playground/work could not be removed'); },
    });

    const response = await compileRequest(valid);

    assert.deepEqual(await response.json(), { error: 'Internal error.' });
    assert.equal(response.status, 500);
    assert.equal((await fetch(`${url}/health`)).status, 503);
    assert.equal(recycled, 1);
});
