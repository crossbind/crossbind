import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/api.js';
import { createAccounts } from '../worker/accounts.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const API = 'https://api.crossbind.dev/runner';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const env = { CLOUD_BUILDS_ENABLED: 'true' };

async function setup({ overLimit = {}, runnerThrows = false } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    await accounts.signIn({ id: '583231', login: 'octocat' });
    const token = await accounts.issueToken('583231');
    const forwarded = [];
    const limited = { api: [], runner: [] };
    const limiter = (name) => ({ limit: async ({ key }) => { limited[name].push(key); return { success: !overLimit[name] }; } });
    const deps = {
        limits: { api: limiter('api'), login: { limit: async () => ({ success: true }) }, runner: limiter('runner') },
        accounts,
        recentTokens: new Map(),
        now: () => now,
        runner: (image, userId) => ({
            fetch: async (request) => {
                if (runnerThrows) throw new Error('Network connection lost.');
                forwarded.push({
                    image, userId, url: request.url, method: request.method, headers: Object.fromEntries(request.headers), body: await request.text(),
                });
                return new Response('{"exit":0}\n', { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
            },
        }),
    };
    const call = (path, {
        method = 'POST', bearer = token, body = '{"hashes":[]}', environment = env, headers = {},
    } = {}) => handleRequest(new Request(`${API}${path}`, {
        method,
        headers: {
            'cf-connecting-ip': '203.0.113.7', 'content-type': 'application/json', cookie: '__Host-pg_session=x', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...headers,
        },
        body: method === 'GET' ? undefined : body,
    }), environment, deps);
    return {
        db, token, forwarded, limited, call, advance: (ms) => { now += ms; },
    };
}

test('hands a signed-in user\'s request to their own runner of that image, without their token or cookies', async () => {
    const { forwarded, call } = await setup();

    const response = await call('/android/v1/missing');
    const blob = await call(`/web/v1/blobs/${'a'.repeat(64)}?part=1`, { method: 'GET' });

    assert.deepEqual([response.status, await response.text(), blob.status], [200, '{"exit":0}\n', 200]);
    assert.deepEqual(forwarded.map(({ image, userId, url, method }) => ({
        image, userId, url, method,
    })), [
        {
            image: 'android', userId: '583231', url: 'http://runner/v1/missing', method: 'POST',
        },
        {
            image: 'web', userId: '583231', url: `http://runner/v1/blobs/${'a'.repeat(64)}?part=1`, method: 'GET',
        },
    ]);
    assert.equal(forwarded[0].body, '{"hashes":[]}');
    assert.deepEqual(forwarded[0].headers, { 'content-type': 'application/json', 'x-crossbind-user': '583231' });
});

test('passes on the range and upload id of a file sent in parts', async () => {
    const { forwarded, call } = await setup();
    const hash = 'b'.repeat(64);
    const part = { 'content-range': 'bytes 0-3/8', 'x-crossbind-upload': hash.slice(0, 32) };

    const response = await call(`/linux/v1/blobs/${hash}`, { method: 'PUT', body: 'abcd', headers: part });

    assert.equal(response.status, 200);
    assert.equal(forwarded[0].body, 'abcd');
    assert.deepEqual(forwarded[0].headers, { ...part, 'content-type': 'application/json', 'x-crossbind-user': '583231' });
});

test('answers 401 without a valid token and 403 to a blocked account, before any runner wakes', async () => {
    const { db, forwarded, call } = await setup();

    const statuses = [(await call('/web/v1/exec', { bearer: null })).status, (await call('/web/v1/exec', { bearer: `cbt_${'b'.repeat(43)}` })).status];
    await db.prepare('UPDATE users SET blocked = 1').run();

    assert.deepEqual([...statuses, (await call('/web/v1/exec')).status], [401, 401, 403]);
    assert.equal(forwarded.length, 0);
});

test('runs only the toolchain images crossbind pins, and only their runner protocol', async () => {
    const { forwarded, call } = await setup();

    const statuses = await Promise.all(['/ios/v1/exec', '/web/v2/exec', '/web', '/web/health'].map(async (path) => (await call(path)).status));

    assert.deepEqual(statuses, [404, 404, 404, 404]);
    assert.equal(forwarded.length, 0);
});

test('answers 503 while cloud builds are paused', async () => {
    const { forwarded, call } = await setup();

    const response = await call('/web/v1/exec', { environment: { CLOUD_BUILDS_ENABLED: 'false' } });

    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /paused/);
    assert.equal(forwarded.length, 0);
});

test('holds a token it has not seen to the general rate, and one it found valid moments ago to the runners\' own', async () => {
    const { limited, call, advance } = await setup();

    await call('/web/v1/missing');
    await call('/web/v1/missing');
    await call('/web/v1/missing', { bearer: `cbt_${'b'.repeat(43)}` });
    advance(31 * 1000);
    await call('/web/v1/missing');

    assert.deepEqual(limited, { api: ['203.0.113.7', '203.0.113.7', '203.0.113.7'], runner: ['203.0.113.7'] });
});

test('answers 429 to a network over its rate before it reads any account', async () => {
    const { forwarded, call } = await setup({ overLimit: { api: true } });

    assert.equal((await call('/web/v1/exec')).status, 429);
    assert.equal(forwarded.length, 0);
});

test('answers 502 when the runner cannot be reached', async () => {
    const { call } = await setup({ runnerThrows: true });

    const response = await call('/web/v1/exec');

    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /runner/);
});
