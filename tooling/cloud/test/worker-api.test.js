import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../worker/api.js';
import { networkOf } from '../worker/http.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';

const PAGE = 'https://crossbind.dev';
const API = 'https://api.crossbind.dev/playground';
const env = {
    PLAYGROUND_ENABLED: 'true',
    ALLOWED_ORIGINS: PAGE,
    ANONYMOUS_DAILY: '5',
    USER_DAILY: '100',
    GLOBAL_DAILY: '1000',
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    TURNSTILE_SECRET: 'turnstile-secret',
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_HOSTNAMES: 'crossbind.dev',
    COMPILER_VERSION: 'image-1',
    BLOCKED_NETWORKS: '198.51.100.9',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
};
const files = { 'native.h': 'int answer();', 'native.cpp': 'int answer() { return 42; }' };
const compiled = { ok: true, js: 'var Module;', wasm: 'AGFzbQ==', log: '', ms: 900 };

// standing: what the account's row says beyond a live account named octocat that never signed out everywhere.
function setup({
    reserve = { ok: true, remaining: 4 }, compilerStatus = 200, compilerResult = compiled, turnstile = { success: true, action: 'compile', hostname: 'crossbind.dev' }, blockedUsers = [],
    overLimit = false, standing = {},
} = {}) {
    const calls = {
        reserve: [], refund: [], compile: [], siteverify: [], limited: [],
    };
    const store = new Map();
    const deps = {
        limits: {
            api: { limit: async ({ key }) => { calls.limited.push(key); return { success: !overLimit }; } },
            login: { limit: async () => ({ success: true }) },
        },
        accounts: {
            standing: async (id) => ({
                exists: true, blocked: blockedUsers.includes(id), login: 'octocat', name: 'octocat', signedOutAt: null, ...standing,
            }),
        },
        quota: {
            reserve: async (args) => { calls.reserve.push(args); return reserve; },
            refund: async (args) => { calls.refund.push(args); },
            remaining: async ({ limit }) => limit - 1,
        },
        compiler: {
            fetch: async (request) => {
                calls.compile.push(await request.json());
                if (compilerStatus === 'throw') throw new Error('container is starting');
                if (compilerStatus === 'garbled') return new Response('{"ok": true, "wasm": "AGFz', { status: 200 });
                if (compilerStatus === 'oversized') return new Response('{}', { status: 200, headers: { 'content-length': String(64 * 1024 * 1024) } });
                return Response.json(compilerStatus === 200 ? compilerResult : { error: 'busy' }, { status: compilerStatus });
            },
        },
        cache: {
            match: async (request) => store.get(request.url)?.clone(),
            put: async (request, response) => { store.set(request.url, response); },
        },
        fetcher: async (url, init) => {
            calls.siteverify.push({ url, body: Object.fromEntries(init.body) });
            return Response.json(turnstile);
        },
        waitUntil: () => {},
    };
    return { deps, calls, store };
}

const compileRequest = ({ origin = PAGE, ip = '203.0.113.7', cookie, body = { files, turnstile: 'token' }, contentType = 'application/json' } = {}) => new Request(`${API}/compile`, {
    method: 'POST',
    headers: { origin, 'cf-connecting-ip': ip, 'content-type': contentType, ...(cookie ? { cookie } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('compiles for an anonymous visitor who passed the browser check, counting it against their network', async () => {
    const { deps, calls } = setup();

    const response = await handleRequest(compileRequest(), env, deps);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ...compiled, remaining: 4 });
    assert.deepEqual(calls.reserve, [{ key: 'ip:203.0.113.7', limit: 5, globalLimit: 1000 }]);
    // The first playground's names reach the compiler as the project they mean.
    assert.deepEqual(calls.compile, [{ files: { 'native/native.cpp': files['native.cpp'], 'native/native.h': files['native.h'] }, packages: [] }]);
    assert.deepEqual(calls.siteverify[0].body, { secret: 'turnstile-secret', response: 'token', remoteip: '203.0.113.7' });
    assert.equal(response.headers.get('access-control-allow-origin'), PAGE);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('compiles for a signed-in user without the browser check, against their own daily limit', async () => {
    const { deps, calls } = setup();
    const session = await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET);

    const response = await handleRequest(compileRequest({ cookie: `${SESSION_COOKIE}=${session}`, body: { files } }), env, deps);

    assert.equal(response.status, 200);
    assert.deepEqual(calls.reserve, [{ key: 'user:583231', limit: 100, globalLimit: 1000 }]);
    assert.equal(calls.siteverify.length, 0);
});

test('counts a new account\'s compiles for the account, on a day of its own and without the browser check, until it is 30 days old or links GitHub', async () => {
    const madeAt = Date.parse('2026-11-20T10:00:00Z');
    // NEW_ACCOUNT_DAILY unset, as 20 is its default, but for the last.
    const accounts = {
        'new, no GitHub': [{ github: false }, madeAt + 60_000],
        'a moment before its 30th day ends': [{ github: false }, madeAt + 30 * 24 * 3600 * 1000 - 1],
        '30 days old': [{ github: false }, madeAt + 30 * 24 * 3600 * 1000],
        'new, with GitHub linked': [{ github: true }, madeAt + 60_000],
        'new, NEW_ACCOUNT_DAILY set': [{ github: false }, madeAt + 60_000, { ...env, NEW_ACCOUNT_DAILY: '7' }],
    };

    const limits = {};
    for (const [name, [standing, now, environment = env]] of Object.entries(accounts)) {
        const { deps, calls } = setup({ standing: { ...standing, createdAt: new Date(madeAt).toISOString(), name: 'Apple account …7776' } });
        deps.now = () => now;
        // A cookie of a sign-in a minute before, whatever the account's age.
        const session = `${SESSION_COOKIE}=${await signSession({ id: '1099511627776', name: 'Apple account …7776' }, env.SESSION_SECRET, now - 60_000)}`;
        await handleRequest(compileRequest({ cookie: session, body: { files } }), environment, deps);
        const told = await (await handleRequest(new Request(`${API}/session`, { headers: { origin: PAGE, cookie: session } }), environment, deps)).json();
        limits[name] = [calls.reserve[0].limit, calls.reserve[0].key, calls.siteverify.length, told.limit];
    }

    assert.deepEqual(limits, {
        'new, no GitHub': [20, 'user:1099511627776', 0, 20],
        'a moment before its 30th day ends': [20, 'user:1099511627776', 0, 20],
        '30 days old': [100, 'user:1099511627776', 0, 100],
        'new, with GitHub linked': [100, 'user:1099511627776', 0, 100],
        'new, NEW_ACCOUNT_DAILY set': [7, 'user:1099511627776', 0, 7],
    });
});

test('turns away an anonymous compile without a passing browser check before spending any quota', async () => {
    const missing = setup();
    const wrongSite = setup({ turnstile: { success: true, action: 'compile', hostname: 'evil.example' } });
    const failed = setup({ turnstile: { success: false } });
    const otherAction = setup({ turnstile: { success: true, action: 'login', hostname: 'crossbind.dev' } });
    const noAction = setup({ turnstile: { success: true, hostname: 'crossbind.dev' } });

    const responses = [
        await handleRequest(compileRequest({ body: { files } }), env, missing.deps),
        await handleRequest(compileRequest(), env, wrongSite.deps),
        await handleRequest(compileRequest(), env, failed.deps),
        await handleRequest(compileRequest(), env, otherAction.deps),
        await handleRequest(compileRequest(), env, noAction.deps),
    ];

    assert.deepEqual(responses.map((r) => r.status), [403, 403, 403, 403, 403]);
    assert.deepEqual([missing, wrongSite, failed, otherAction, noAction].map(({ calls }) => calls.reserve.length + calls.compile.length), [0, 0, 0, 0, 0]);
});

test('takes the answer of Cloudflare\'s test secret, which names no action, from a listed hostname', async () => {
    const testing = { success: true, hostname: 'example.com', metadata: { result_with_testing_key: true } };
    const staging = setup({ turnstile: testing });
    const elsewhere = setup({ turnstile: testing });

    const passed = await handleRequest(compileRequest(), { ...env, TURNSTILE_HOSTNAMES: 'localhost,example.com' }, staging.deps);
    const refused = await handleRequest(compileRequest(), env, elsewhere.deps);

    assert.deepEqual([passed.status, refused.status], [200, 403]);
});

test('accepts compiles from the playground page only, and answers its preflight', async () => {
    const { deps, calls } = setup();
    const preflight = (origin) => handleRequest(new Request(`${API}/compile`, { method: 'OPTIONS', headers: { origin } }), env, deps);

    const foreign = await handleRequest(compileRequest({ origin: 'https://evil.example' }), env, deps);
    const allowedPreflight = await preflight(PAGE);

    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    assert.equal((await preflight('https://evil.example')).status, 403);
    assert.equal(allowedPreflight.status, 204);
    assert.equal(allowedPreflight.headers.get('access-control-allow-headers'), 'content-type');
    assert.equal(calls.compile.length, 0);
});

test('refuses a body that is not JSON, too large or not the two sources, before any check that costs', async () => {
    const { deps, calls } = setup();

    const statuses = [
        (await handleRequest(compileRequest({ contentType: 'text/plain' }), env, deps)).status,
        (await handleRequest(compileRequest({ body: '{"files":' }), env, deps)).status,
        (await handleRequest(compileRequest({ body: { files: { 'native.h': 'x'.repeat(140 * 1024) } } }), env, deps)).status,
        (await handleRequest(compileRequest({ body: { files: { 'native.h': '', 'CMakeLists.txt': '' }, turnstile: 'token' } }), env, deps)).status,
    ];

    assert.deepEqual(statuses, [415, 400, 413, 400]);
    assert.equal(calls.siteverify.length + calls.reserve.length, 0);
});

test('tells an anonymous visitor out of compiles to sign in, and everyone when the day\'s total is spent', async () => {
    const own = setup({ reserve: { ok: false, reason: 'quota', remaining: 0 } });
    const everyone = setup({ reserve: { ok: false, reason: 'global', remaining: 3 } });

    const ownResponse = await handleRequest(compileRequest(), env, own.deps);
    const everyoneResponse = await handleRequest(compileRequest(), env, everyone.deps);

    assert.equal(ownResponse.status, 429);
    assert.equal((await ownResponse.json()).login, true);
    assert.equal(everyoneResponse.status, 429);
    assert.deepEqual([(await everyoneResponse.json()).login, own.calls.compile.length], [false, 0]);
});

test('gives the compile back only when the compiler turned it away before it started', async () => {
    const busy = setup({ compilerStatus: 503 });
    const lost = setup({ compilerStatus: 'throw' });

    assert.equal((await handleRequest(compileRequest(), env, busy.deps)).status, 503);
    assert.equal((await handleRequest(compileRequest(), env, lost.deps)).status, 503);
    assert.deepEqual([busy.calls.refund, lost.calls.refund], [[{ key: 'ip:203.0.113.7' }], []]);
});

test('caches nothing and keeps the compile counted when the compiler\'s answer is cut short or too large', async () => {
    const garbled = setup({ compilerStatus: 'garbled' });
    const oversized = setup({ compilerStatus: 'oversized' });

    const statuses = [(await handleRequest(compileRequest(), env, garbled.deps)).status, (await handleRequest(compileRequest(), env, oversized.deps)).status];

    assert.deepEqual(statuses, [502, 502]);
    assert.deepEqual([garbled.calls.refund.length, oversized.calls.refund.length], [0, 0]);
    assert.equal(garbled.store.size + oversized.store.size, 0);
});

test('serves a compile it has seen before from the cache without spending quota, but never a timeout', async () => {
    const seen = setup();
    await handleRequest(compileRequest(), env, seen.deps);
    const again = await handleRequest(compileRequest(), env, seen.deps);
    const timedOut = setup({ compilerResult: { ok: false, reason: 'timeout', log: '' } });
    await handleRequest(compileRequest(), env, timedOut.deps);

    assert.deepEqual(await again.json(), { ...compiled, cached: true, remaining: 4 });
    assert.equal(seen.calls.reserve.length, 1);
    assert.equal(timedOut.store.size, 0);
});

test('keeps a compile error for minutes only, since the container rather than the sources may have caused it', async () => {
    const succeeded = setup();
    const failed = setup({ compilerResult: { ok: false, reason: 'compile', log: 'native.cpp:1: error' } });

    await handleRequest(compileRequest(), env, succeeded.deps);
    await handleRequest(compileRequest(), env, failed.deps);

    const cacheControl = ({ store }) => [...store.values()][0].headers.get('cache-control');
    assert.deepEqual([cacheControl(succeeded), cacheControl(failed)], ['public, max-age=604800', 'public, max-age=600']);
});

test('answers 429 to a network over its rate before any other work, on every route', async () => {
    const { deps, calls } = setup({ overLimit: true });

    const compile = await handleRequest(compileRequest({ ip: '2001:db8:85a3:42::9' }), env, deps);
    const session = await handleRequest(new Request(`${API}/session`, { headers: { origin: PAGE, 'cf-connecting-ip': '203.0.113.7' } }), env, deps);
    const cli = await handleRequest(new Request('https://api.crossbind.dev/v1/usage', { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env, deps);

    assert.deepEqual([compile.status, session.status, cli.status], [429, 429, 429]);
    assert.equal(compile.headers.get('access-control-allow-origin'), PAGE);
    assert.deepEqual(calls.limited, ['2001:db8:85a3:42::/64', '203.0.113.7', '203.0.113.7']);
    assert.equal(calls.siteverify.length + calls.reserve.length + calls.compile.length, 0);
});

test('counts every address of one IPv6 /64 as one network', () => {
    assert.equal(networkOf('2001:db8:85a3:42:1:2:3:4'), networkOf('2001:db8:85a3:42::9'));
    assert.equal(networkOf('2001:db8::1'), '2001:db8:0:0::/64');
    assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
});

test('turns away a blocked network, a blocked account, and everyone while the playground is paused', async () => {
    const blocked = setup();
    const blockedAccount = setup({ blockedUsers: ['583231'] });
    const paused = setup();
    const session = await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET);

    const blockedResponse = await handleRequest(compileRequest({ ip: '198.51.100.9' }), env, blocked.deps);
    const accountResponse = await handleRequest(compileRequest({ cookie: `${SESSION_COOKIE}=${session}`, body: { files } }), env, blockedAccount.deps);
    const pausedResponse = await handleRequest(compileRequest(), { ...env, PLAYGROUND_ENABLED: 'false' }, paused.deps);

    assert.deepEqual([blockedResponse.status, accountResponse.status, pausedResponse.status], [403, 403, 503]);
    assert.equal(blocked.calls.compile.length + blockedAccount.calls.reserve.length + paused.calls.compile.length, 0);
});

test('describes the session: who is signed in, what is left today and how to sign in', async () => {
    const { deps } = setup();
    const session = await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET);
    const ask = (cookie) => handleRequest(new Request(`${API}/session`, { headers: { origin: PAGE, 'cf-connecting-ip': '203.0.113.7', ...(cookie ? { cookie } : {}) } }), env, deps);

    assert.deepEqual(await (await ask()).json(), {
        enabled: true, user: null, limit: 5, remaining: 4, canSignIn: true, turnstileSiteKey: 'site-key',
    });
    assert.deepEqual((await (await ask(`${SESSION_COOKIE}=${session}`)).json()).user, { name: 'octocat' });
    assert.equal((await (await handleRequest(new Request(`${API}/session`), { ...env, GITHUB_CLIENT_SECRET: '' }, deps)).json()).canSignIn, false);
    const appleAlone = {
        ...env, GITHUB_CLIENT_SECRET: '', APPLE_SERVICES_ID: 'dev.made-up.signin', APPLE_TEAM_ID: 'MADEUPTEAM', APPLE_KEY_ID: 'MADEUPKEY1', APPLE_PRIVATE_KEY: 'made-up',
    };
    assert.equal((await (await handleRequest(new Request(`${API}/session`), appleAlone, deps)).json()).canSignIn, true);
});

test('signs a cookie in only while its account is there, not blocked, and not signed out everywhere since the cookie was made', async () => {
    const madeAt = Date.parse('2026-11-20T10:00:00Z');
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET, madeAt)}`;
    const rows = {
        live: {},
        'signed out before it': { signedOutAt: '2026-11-20T09:59:59.999Z' },
        'signed out as it was made': { signedOutAt: '2026-11-20T10:00:00.000Z' },
        'signed out after it': { signedOutAt: '2026-11-20T10:00:00.001Z' },
        deleted: { exists: false, login: '' },
        blocked: { blocked: true },
    };

    const answers = {};
    for (const [name, standing] of Object.entries(rows)) {
        const { deps, calls } = setup({ standing });
        deps.now = () => madeAt + 60_000;
        const deleted = [];
        deps.accounts.deleteAccount = async (id) => { deleted.push(id); };
        const session = await (await handleRequest(new Request(`${API}/session`, { headers: { origin: PAGE, cookie } }), env, deps)).json();
        const compile = await handleRequest(compileRequest({ cookie, body: { files } }), env, deps);
        const remove = await handleRequest(new Request(`${API}/delete-account`, { method: 'POST', headers: { origin: PAGE, cookie } }), env, deps);
        answers[name] = {
            user: session.user?.name ?? null, compile: compile.status, error: (await compile.json()).error ?? null, compiled: calls.compile.length, remove: remove.status, deleted,
        };
    }

    const refused = (compile, error) => ({
        user: null, compile, error, compiled: 0, remove: 401, deleted: [],
    });
    const taken = {
        user: 'octocat', compile: 200, error: null, compiled: 1, remove: 204, deleted: ['583231'],
    };
    assert.deepEqual(answers, {
        live: taken,
        'signed out before it': taken,
        'signed out as it was made': refused(401, 'This account was signed out everywhere; sign in again.'),
        'signed out after it': refused(401, 'This account was signed out everywhere; sign in again.'),
        deleted: refused(401, 'This account was deleted; sign in again to make a new one.'),
        blocked: refused(403, 'This account or network may not compile here.'),
    });
});

test('deletes the signed-in account from the playground page only, and signs it out', async () => {
    const deleted = [];
    const { deps } = setup();
    deps.accounts.deleteAccount = async (id) => { deleted.push(id); };
    const session = await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET);
    const remove = (origin, cookie) => handleRequest(new Request(`${API}/delete-account`, {
        method: 'POST', headers: { origin, ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
    }), env, deps);

    const foreign = await remove('https://evil.example', session);
    const anonymous = await remove(PAGE);
    const response = await remove(PAGE, session);

    assert.deepEqual([foreign.status, anonymous.status, response.status], [403, 401, 204]);
    assert.deepEqual(deleted, ['583231']);
    assert.match(response.headers.get('set-cookie'), new RegExp(`^${SESSION_COOKIE}=; Max-Age=0`));
    assert.equal(response.headers.get('access-control-allow-origin'), PAGE);
});

test('signs out by clearing the session cookie, from the playground page only', async () => {
    const { deps } = setup();
    const logout = (origin) => handleRequest(new Request(`${API}/logout`, { method: 'POST', headers: { origin } }), env, deps);

    const response = await logout(PAGE);

    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie'), new RegExp(`^${SESSION_COOKIE}=; Max-Age=0`));
    assert.equal((await logout('https://evil.example')).status, 403);
});

test('answers anything else with 404, sign-in with another provider included', async () => {
    const { deps } = setup();

    const responses = [
        await handleRequest(new Request('https://api.crossbind.dev/admin', { method: 'POST' }), env, deps),
        await handleRequest(new Request(`${API}/login/google`), env, deps),
        await handleRequest(new Request(`${API}/callback/google?code=c&state=s`), env, deps),
    ];

    assert.deepEqual(responses.map((response) => response.status), [404, 404, 404]);
    assert.equal(responses[0].headers.get('x-content-type-options'), 'nosniff');
});
