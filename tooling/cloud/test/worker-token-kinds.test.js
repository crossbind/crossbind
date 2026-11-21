import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { createDeviceCodes } from '../worker/devices.js';
import { createProjectSessions } from '../worker/project-sessions.js';
import { createQuota } from '../worker/quota.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import { createSnapshots } from '../worker/snapshots.js';
import { memoryBucket } from './support/bucket.mjs';

// Each kind of token on each route that takes a token, the runners and the app's compile included: the design's table
// of who may do what, with tokens made by the device sign-in itself.

const API = 'https://api.crossbind.dev';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_ENABLED: 'true',
    CLOUD_BUILDS_ENABLED: 'true',
    PLAYGROUND_URL: 'https://crossbind.dev/playground/',
    ALLOWED_ORIGINS: 'https://crossbind.dev',
    MIN_GITHUB_ACCOUNT_DAYS: '30',
    USER_DAILY: '100',
    NEW_ACCOUNT_DAILY: '20',
    GLOBAL_DAILY: '1000',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_HOSTNAMES: 'crossbind.dev',
    SNAPSHOTS_ENABLED: 'true',
};
const DEVICES = Object.freeze({
    app: {
        client: 'app', version: '1.0.0', platform: 'ios', os: '27.1',
    },
    cli: { client: 'cli', version: '2.0.0-beta.79' },
});
// A made-up GitHub account: an id of ten digits, and a name with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const files = { 'native.h': 'int answer();', 'native.cpp': 'int answer() { return 42; }' };
const compiled = {
    ok: true, js: 'var Module;', wasm: 'AGFzbQ==', log: '', ms: 900,
};
const unlimited = { limit: async () => ({ success: true }) };

function setup() {
    const db = sqliteD1();
    const accounts = createAccounts(db, () => NOW);
    const calls = { compile: 0, runner: [], siteverify: 0 };
    const deps = {
        limits: {
            api: unlimited, login: unlimited, runner: unlimited, starts: unlimited, poll: unlimited, code: unlimited, upload: unlimited, snapshot: unlimited,
        },
        accounts,
        devices: createDeviceCodes(db, () => NOW),
        sessions: createProjectSessions(db, () => NOW),
        snapshots: createSnapshots(db, memoryBucket(), () => NOW),
        quota: createQuota(memoryStorage(), () => NOW),
        compiler: { fetch: async () => { calls.compile += 1; return Response.json(compiled); } },
        cache: { match: async () => undefined, put: async () => {} },
        runner: (image, userId) => ({ fetch: async () => { calls.runner.push(userId); return new Response('{"exit":0}\n'); } }),
        recentTokens: new Map(),
        fetcher: async () => { calls.siteverify += 1; return Response.json({ success: false }); },
        waitUntil: () => {},
        now: () => NOW,
    };
    const send = (method, path, {
        token, origin, cookie, body,
    } = {}) => handleRequest(new Request(`${API}${path}`, {
        method,
        headers: {
            'cf-connecting-ip': '203.0.113.7',
            ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
            ...(origin === undefined ? {} : { origin }),
            ...(cookie === undefined ? {} : { cookie }),
            ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON.stringify(body))) }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    }), env, deps);
    return {
        db, accounts, calls, deps, send,
    };
}

// A token of the kind a device asks as: started, approved on the device page by the signed-in account, then the number.
async function deviceToken({ accounts, send }, kind) {
    const { user } = await accounts.signIn(dev);
    const started = await (await send('POST', '/v1/device/authorize', { body: DEVICES[kind] })).json();
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: user.id, name: user.login }, env.SESSION_SECRET, NOW)}`;
    const approved = await send('POST', '/account/device/approve', { origin: API, cookie, body: { user_code: started.user_code, approve: true } });
    const { match } = await approved.json();
    return (await (await send('POST', '/v1/device/token', { body: { device_code: started.device_code, match } })).json()).access_token;
}

// A session no route has registered: a kind that may read or remove it gets 404.
const SESSION = '/v1/sessions/IRVUB8Fpwuh0lT_7NkiJ8Q';
const DEV_SESSION = {
    source: 'dev', project: { id: 'mWW-UyZhfd1-czxo9qk5Aw', name: 'made-up-app' }, addresses: ['192.168.1.6:5173'], protocol: 1, key: 'GheN2aAnJDjAj-qTuiyNWPEy-yOsSHLE15uyL80No6o',
};

// A snapshot no route has made: the CLI's upload to it gets 404, and so does a removal of a kind that may remove one.
const SNAPSHOT = '/v1/snapshots/IRVUB8Fpwuh0lT_7NkiJ8Q';

const ROUTES = Object.freeze([
    ['GET', '/v1/usage'],
    ['GET', '/v1/account'],
    ['PUT', SESSION, DEV_SESSION],
    ['GET', '/v1/sessions'],
    ['GET', SESSION],
    ['DELETE', SESSION],
    ['POST', '/v1/snapshots', { project: DEV_SESSION.project, protocol: 1 }],
    ['PUT', SNAPSHOT, {}],
    ['DELETE', SNAPSHOT],
    ['POST', '/playground/compile', { files }],
    ['POST', '/runner/web/v1/missing', { hashes: [] }],
    ['DELETE', '/v1/token'],
    ['DELETE', '/v1/tokens'],
    ['DELETE', '/v1/account'],
]);

test('takes each kind of token on the routes the design gives it alone, the runners and the playground\'s compile included', async () => {
    const statuses = {};
    for (const kind of ['cli', 'app', 'partner']) {
        statuses[kind] = [];
        for (const [method, path, body] of ROUTES) {
            const context = setup();
            const token = await deviceToken(context, kind === 'partner' ? 'app' : kind);
            // A kind no route names, as a partner's would be until a route takes it.
            if (kind === 'partner') await context.db.prepare("UPDATE tokens SET kind = 'partner' WHERE hash = ?").bind(createHash('sha256').update(token).digest('hex')).run();
            statuses[kind].push(`${method} ${path} ${(await context.send(method, path, { token, body })).status}`);
        }
    }

    const sessions = {
        cli: ['200', '403', '403', '404', '200', '404', '404'], app: ['403', '200', '404', '403', '403', '403', '404'], partner: ['403', '403', '403', '403', '403', '403', '403'],
    };
    const sessionRoutes = (kind) => [`PUT ${SESSION}`, 'GET /v1/sessions', `GET ${SESSION}`, `DELETE ${SESSION}`, 'POST /v1/snapshots', `PUT ${SNAPSHOT}`, `DELETE ${SNAPSHOT}`]
        .map((route, at) => `${route} ${sessions[kind][at]}`);
    assert.deepEqual(statuses, {
        cli: ['GET /v1/usage 200', 'GET /v1/account 200', ...sessionRoutes('cli'), 'POST /playground/compile 403', 'POST /runner/web/v1/missing 200', 'DELETE /v1/token 204', 'DELETE /v1/tokens 204', 'DELETE /v1/account 204'],
        app: ['GET /v1/usage 403', 'GET /v1/account 200', ...sessionRoutes('app'), 'POST /playground/compile 200', 'POST /runner/web/v1/missing 403', 'DELETE /v1/token 204', 'DELETE /v1/tokens 204', 'DELETE /v1/account 204'],
        partner: ['GET /v1/usage 403', 'GET /v1/account 403', ...sessionRoutes('partner'), 'POST /playground/compile 403', 'POST /runner/web/v1/missing 403', 'DELETE /v1/token 403', 'DELETE /v1/tokens 403', 'DELETE /v1/account 403'],
    });
});

test('compiles with the crossbind app\'s token for its account, held to the token and not to the Origin, without the browser check', async () => {
    const context = setup();
    const token = await deviceToken(context, 'app');
    const { user } = await context.accounts.signIn(dev);

    const answers = [];
    for (const origin of [undefined, 'https://evil.example', 'null']) {
        const response = await context.send('POST', '/playground/compile', { token, origin, body: { files } });
        answers.push([response.status, (await response.json()).remaining]);
    }
    const cli = await deviceToken(context, 'cli');
    const refused = await context.send('POST', '/playground/compile', { token: cli, body: { files } });
    const unknown = await context.send('POST', '/playground/compile', { token: `cbt_${'A'.repeat(43)}`, body: { files } });

    assert.deepEqual(answers, [[200, 99], [200, 98], [200, 97]]);
    assert.equal(context.calls.compile, 3);
    assert.equal(context.calls.siteverify, 0, 'a token\'s compile meets no browser check');
    assert.equal(await context.deps.quota.remaining({ key: `user:${user.id}`, limit: 100 }), 97);
    assert.deepEqual([refused.status, (await refused.json()).error], [403, 'This token cannot be used here.']);
    assert.equal(unknown.status, 401);
    assert.equal(context.calls.compile, 3);
});

test('counts a new account\'s compiles with its app token on its own day of 20', async () => {
    const context = setup();
    const at = new Date(NOW).toISOString();
    const id = 1099511627777;
    await context.db.batch([
        context.db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, '', ?2, ?2)").bind(id, at),
        context.db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('apple', '000123.made0up0apple0id.0001', ?1, ?2)").bind(id, at),
    ]);
    const token = await context.accounts.issueToken(String(id), { kind: 'app', label: 'crossbind app 1.0.0 on iOS 27.1' });

    const response = await context.send('POST', '/playground/compile', { token, body: { files } });

    assert.deepEqual([response.status, (await response.json()).remaining], [200, 19]);
});

test('refuses a compile to a blocked account\'s app token, and one with no token from no listed origin', async () => {
    const context = setup();
    const token = await deviceToken(context, 'app');
    await context.db.prepare('UPDATE users SET blocked = 1').run();

    const blocked = await context.send('POST', '/playground/compile', { token, body: { files } });
    const pageless = await context.send('POST', '/playground/compile', { origin: 'https://evil.example', body: { files } });

    assert.deepEqual([blocked.status, (await blocked.json()).error], [403, 'This account may not use crossbind cloud.']);
    assert.deepEqual([pageless.status, (await pageless.json()).error], [403, 'Compiles are accepted from the playground page only.']);
    assert.equal(context.calls.compile, 0);
});
