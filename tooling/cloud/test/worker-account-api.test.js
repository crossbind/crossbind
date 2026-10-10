import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/api.js';
import { createAccounts } from '../worker/accounts.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const API = 'https://api.crossbind.dev/v1';
const NOW = Date.parse('2026-10-08T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const env = {
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    MIN_GITHUB_ACCOUNT_DAYS: '30',
    USER_DAILY: '100',
    BUILD_SECONDS_MONTHLY: '3600',
};
const deviceCode = {
    device_code: 'the-device-code', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
};

// GitHub as the device flow sees it: `answer` from the token endpoint, an account created `ageDays` ago.
const github = ({ answer = { access_token: 'gho_token' }, ageDays = 400 } = {}) => async (url) => {
    if (url === 'https://github.com/login/device/code') return Response.json(deviceCode);
    if (url === 'https://github.com/login/oauth/access_token') return Response.json(answer);
    return Response.json({ id: 583231, login: 'octocat', created_at: new Date(NOW - ageDays * DAY).toISOString() });
};

function setup({ fetcher = github(), environment = env, loginOverLimit = false } = {}) {
    const db = sqliteD1();
    const accounts = createAccounts(db, () => NOW);
    const deps = {
        limits: {
            api: { limit: async () => ({ success: true }) },
            login: { limit: async () => ({ success: !loginOverLimit }) },
        },
        accounts,
        quota: { remaining: async ({ key, limit }) => (key === 'github:583231' ? limit - 3 : limit) },
        fetcher,
        now: () => NOW,
    };
    const call = (method, path, { token, body } = {}) => handleRequest(new Request(`${API}${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    }), environment, deps);
    return { db, accounts, call };
}

async function signedIn() {
    const context = setup();
    await context.accounts.signIn({ id: '583231', login: 'octocat' });
    return { ...context, token: await context.accounts.issueToken('583231') };
}

test('starts a CLI sign-in with a GitHub device code', async () => {
    const { call } = setup();

    const response = await call('POST', '/login/device');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        deviceCode: 'the-device-code', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5,
    });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('answers 503 to a CLI sign-in while GitHub sign-in is not set up', async () => {
    const { call } = setup({ environment: { ...env, GITHUB_CLIENT_ID: '' } });

    assert.equal((await call('POST', '/login/device')).status, 503);
    assert.equal((await call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } })).status, 503);
});

test('keeps the CLI waiting while the user has not approved the code yet', async () => {
    const pending = setup({ fetcher: github({ answer: { error: 'authorization_pending' } }) });
    const slower = setup({ fetcher: github({ answer: { error: 'slow_down', interval: 10 } }) });

    const responses = [
        await pending.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } }),
        await slower.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } }),
    ];

    assert.deepEqual(responses.map((response) => response.status), [202, 202]);
    assert.deepEqual(await responses[1].json(), { pending: true, interval: 10 });
});

test('gives the CLI a token of its own once GitHub approved the code, and records the account', async () => {
    const { call, db } = setup();

    const response = await call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } });
    const { token, login } = await response.json();

    assert.equal(response.status, 200);
    assert.equal(login, 'octocat');
    assert.match(token, /^cbt_/);
    assert.deepEqual((await db.prepare('SELECT id, login FROM users').all()).results, [{ id: 583231, login: 'octocat' }]);
    assert.equal((await call('GET', '/usage', { token })).status, 200);
});

test('refuses the CLI sign-in of an account that is too new or blocked, and tells why', async () => {
    const tooNew = setup({ fetcher: github({ ageDays: 3 }) });
    const blocked = setup();
    await blocked.accounts.signIn({ id: '583231', login: 'octocat' });
    await blocked.db.prepare('UPDATE users SET blocked = 1').run();

    const responses = [
        await tooNew.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } }),
        await blocked.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } }),
    ];

    assert.deepEqual(responses.map((response) => response.status), [403, 403]);
    assert.match((await responses[0].json()).error, /30 days/);
    assert.match((await responses[1].json()).error, /may not use/);
    assert.equal((await blocked.db.prepare('SELECT hash FROM tokens').all()).results.length, 0);
});

test('reports an expired or cancelled code, and a request without one', async () => {
    const expired = setup({ fetcher: github({ answer: { error: 'expired_token' } }) });
    const cancelled = setup({ fetcher: github({ answer: { error: 'access_denied' } }) });
    const { call } = setup();

    const statuses = [
        (await expired.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } })).status,
        (await cancelled.call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } })).status,
        (await call('POST', '/login/token', { body: {} })).status,
        (await call('POST', '/login/token', { body: { deviceCode: 'x'.repeat(2000) } })).status,
    ];

    assert.deepEqual(statuses, [410, 403, 400, 413]);
});

test('answers 502 when GitHub cannot be reached during a sign-in', async () => {
    const { call } = setup({ fetcher: async () => { throw new Error('connect ETIMEDOUT'); } });

    assert.equal((await call('POST', '/login/device')).status, 502);
    assert.equal((await call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } })).status, 502);
});

test('shows the signed-in account what it used this month and what is left', async () => {
    const { call, db, token } = await signedIn();
    await db.prepare('INSERT INTO build_usage (user_id, month, image, seconds) VALUES (?, ?, ?, ?)').bind(583231, '2026-10', 'web', 754.25).run();

    const response = await call('GET', '/usage', { token });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        login: 'octocat',
        builds: { month: '2026-10', limitSeconds: 3600, usedSeconds: 754.25, byImage: { web: 754.25 } },
        playground: { limit: 100, remaining: 97 },
    });
});

test('answers 401 without a valid token, and 403 to a blocked account', async () => {
    const { call, db, token } = await signedIn();

    const statuses = [
        (await call('GET', '/usage')).status,
        (await call('GET', '/usage', { token: 'cbt_not-a-token' })).status,
        (await call('GET', '/usage', { token: `cbt_${'A'.repeat(43)}` })).status,
    ];
    await db.prepare('UPDATE users SET blocked = 1').run();

    assert.deepEqual(statuses, [401, 401, 401]);
    assert.equal((await call('GET', '/usage', { token })).status, 403);
});

test('revokes the token it was sent, or every token of the account', async () => {
    const { call, accounts, token } = await signedIn();
    const other = await accounts.issueToken('583231');
    const third = await accounts.issueToken('583231');

    const one = await call('DELETE', '/token', { token });
    const all = await call('DELETE', '/tokens', { token: other });

    assert.deepEqual([one.status, all.status], [204, 204]);
    assert.deepEqual(await Promise.all([token, other, third].map((each) => accounts.userOfToken(each))), [null, null, null]);
    assert.equal((await call('DELETE', '/token', { token })).status, 401);
});

test('lets a network start only a few CLI sign-ins a minute, and still poll the one it started', async () => {
    const { call } = setup({ loginOverLimit: true });

    assert.equal((await call('POST', '/login/device')).status, 429);
    assert.equal((await call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } })).status, 200);
});

test('logs a blocked sign-in and every revocation, never the token', async (t) => {
    const { call, db, accounts, token } = await signedIn();
    const lines = t.mock.method(console, 'log', () => {});
    const other = await accounts.issueToken('583231');

    await call('DELETE', '/token', { token });
    await call('DELETE', '/tokens', { token: other });
    await db.prepare('UPDATE users SET blocked = 1').run();
    await call('POST', '/login/token', { body: { deviceCode: 'the-device-code' } });

    const events = lines.mock.calls.map((each) => JSON.parse(each.arguments[0]));
    assert.deepEqual(events.map(({ event, who, all }) => ({ event, who, all })), [
        { event: 'token-revoked', who: 'github:583231', all: false },
        { event: 'token-revoked', who: 'github:583231', all: true },
        { event: 'blocked-sign-in', who: 'github:583231', all: undefined },
    ]);
    assert.ok(!lines.mock.calls.some((each) => each.arguments[0].includes('cbt_')));
});

test('deletes the account of the token it was sent, with every token of it', async () => {
    const { call, db, accounts, token } = await signedIn();
    const other = await accounts.issueToken('583231');

    const response = await call('DELETE', '/account', { token });

    assert.equal(response.status, 204);
    assert.deepEqual((await db.prepare('SELECT id FROM users').all()).results, []);
    assert.equal(await accounts.userOfToken(other), null);
    assert.equal((await call('GET', '/usage', { token })).status, 401);
});

test('deletes no account without a valid token', async () => {
    const { call, db } = await signedIn();

    assert.equal((await call('DELETE', '/account')).status, 401);
    assert.equal((await db.prepare('SELECT id FROM users').all()).results.length, 1);
});

test('answers anything else under /v1 with 404', async () => {
    const { call, token } = await signedIn();

    assert.equal((await call('GET', '/login/device')).status, 404);
    assert.equal((await call('POST', '/exec', { token })).status, 404);
});
