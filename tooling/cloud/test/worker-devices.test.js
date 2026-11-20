import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import {
    createDeviceCodes, drawMatch, drawUserCode, CODE_LETTERS, MATCH_FROM, MATCH_TO, STARTS_PER_MINUTE,
} from '../worker/devices.js';
import { createQuota } from '../worker/quota.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const API = 'https://api.crossbind.dev';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const MINUTE = 60 * 1000;
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_URL: 'https://crossbind.dev/playground/',
    ALLOWED_ORIGINS: 'https://crossbind.dev',
    MIN_GITHUB_ACCOUNT_DAYS: '30',
};
const APP = Object.freeze({
    client: 'app', version: '1.0.0', platform: 'ios', os: '27.1',
});
const CLI = Object.freeze({ client: 'cli', version: '2.0.0-beta.79' });
// A made-up GitHub account: an id of ten digits, and a name with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const POLL_WORDS = {
    matching_required: 'The code is approved: send the number the page shows.',
    ended: 'This sign-in was denied or has ended; start again.',
    mismatch: 'The number did not match, and the code no longer works; start again.',
};

// A rate limit as Workers counts one at a location: `limit` calls a key, then refusals; each key asked is recorded.
function limiter(limit = Infinity) {
    const counts = new Map();
    const keys = [];
    return {
        keys,
        limit: async ({ key }) => {
            keys.push(key);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return { success: counts.get(key) <= limit };
        },
    };
}

function setup({ limits = {} } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    const quota = createQuota(memoryStorage(), () => now);
    const deps = {
        limits: {
            api: limiter(), login: limiter(10), starts: limiter(300), poll: limiter(13), code: limiter(10), ...limits,
        },
        accounts,
        devices: createDeviceCodes(db, () => now),
        quota,
        fetcher: async (url) => { throw new Error(`nothing outside is reached: ${url}`); },
        now: () => now,
    };
    const call = (method, path, {
        body, origin, cookie, token, country, network = '203.0.113.7',
    } = {}) => {
        const request = new Request(`${API}${path}`, {
            method,
            headers: {
                'cf-connecting-ip': network,
                ...(origin === undefined ? {} : { origin }),
                ...(cookie === undefined ? {} : { cookie }),
                ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
        });
        // Cloudflare's reading of the caller's address, which a request of Node's has no place for.
        if (country !== undefined) Object.defineProperty(request, 'cf', { value: { country } });
        return handleRequest(request, env, deps);
    };
    return {
        db, accounts, deps, quota, call, advance: (ms) => { now += ms; },
    };
}

const read = async (response) => ({ status: response.status, body: await response.json() });
const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const hashOf = (text) => createHash('sha256').update(text).digest('hex');
const cookieOf = async (user) => `${SESSION_COOKIE}=${await signSession({ id: user.id, name: user.login }, env.SESSION_SECRET, NOW)}`;
const start = async (context, device = APP, options = {}) => (await context.call('POST', '/v1/device/authorize', { body: device, ...options })).json();
const poll = (context, deviceCode, match) => context.call('POST', '/v1/device/token', { body: match === undefined ? { device_code: deviceCode } : { device_code: deviceCode, match } });
const otherThan = (match) => (match === MATCH_TO ? MATCH_FROM : match + 1);

// A device's start, approved on the page by `user`: the start's answer and the number the page showed.
async function approved(context, user, device = APP) {
    const started = await start(context, device);
    const page = await context.call('POST', '/account/device/approve', { origin: API, cookie: await cookieOf(user), body: { user_code: started.user_code, approve: true } });
    return { started, match: (await page.json()).match };
}

test('starts a device\'s sign-in with a code of eight letters and the cloud\'s own page, and keeps the device code as its hash alone', async () => {
    const context = setup();

    const response = await context.call('POST', '/v1/device/authorize', { body: APP, country: 'TR' });
    const started = await response.json();
    const cli = await start(context, CLI);

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(started).sort(), ['device_code', 'expires_in', 'interval', 'user_code', 'verification_uri']);
    assert.match(started.device_code, /^[A-Za-z0-9_-]{43}$/);
    assert.match(started.user_code, /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    assert.deepEqual([started.verification_uri, started.expires_in, started.interval], [`${API}/device`, 600, 5]);
    assert.deepEqual([response.headers.get('cache-control'), response.headers.get('access-control-allow-origin')], ['no-store', null]);
    assert.deepEqual(await rows(context.db, 'SELECT * FROM device_codes ORDER BY client'), [
        {
            hash: hashOf(started.device_code),
            user_code: started.user_code.replace('-', ''),
            client: 'app',
            label: 'crossbind app 1.0.0 on iOS 27.1',
            country: 'TR',
            created_at: '2026-11-21T10:00:00.000Z',
            expires_at: '2026-11-21T10:10:00.000Z',
            state: 'pending',
            user_id: null,
            match: null,
        },
        {
            hash: hashOf(cli.device_code),
            user_code: cli.user_code.replace('-', ''),
            client: 'cli',
            label: 'crossbind CLI 2.0.0-beta.79',
            country: null,
            created_at: '2026-11-21T10:00:00.000Z',
            expires_at: '2026-11-21T10:10:00.000Z',
            state: 'pending',
            user_id: null,
            match: null,
        },
    ]);
});

test('refuses a start out of its form, free text included, and writes nothing', async () => {
    const context = setup({ limits: { login: limiter() } });
    const bodies = [
        {}, 'not JSON', [APP], { ...APP, client: 'web' }, { ...APP, name: 'made-up name' }, { ...CLI, os: '27.1' }, { ...APP, platform: 'ios ' },
        { ...APP, platform: ['ios'] }, { ...APP, platform: 'constructor' }, { ...APP, version: '1.0' }, { ...APP, version: ['1.0.0'] },
        { ...APP, os: 'twenty-seven' }, { ...CLI, version: '2.0.0-beta.79; made-up' }, { ...CLI, version: '2.0.0-Beta.79' }, `{"client":"cli","version":"${'1'.repeat(1100)}"}`,
    ];

    const answers = [];
    for (const body of bodies) answers.push(await read(await context.call('POST', '/v1/device/authorize', { body })));

    assert.deepEqual(new Set(answers.map(JSON.stringify)), new Set([JSON.stringify({
        status: 400, body: { error: 'invalid_request', error_description: 'Send {"client": "app", "version", "platform", "os"} or {"client": "cli", "version"}.' },
    })]));
    assert.deepEqual(await rows(context.db, 'SELECT count(1) AS codes FROM device_codes'), [{ codes: 0 }]);
});

test('takes ten starts a minute from a network, and stops everyone\'s at the location\'s limit or the exact count, writing nothing past them', async () => {
    const fromOne = setup();
    const statuses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) statuses.push((await fromOne.call('POST', '/v1/device/authorize', { body: CLI })).status);
    const refused = await read(await fromOne.call('POST', '/v1/device/authorize', { body: CLI }));
    const elsewhere = await fromOne.call('POST', '/v1/device/authorize', { body: CLI, network: '198.51.100.20' });

    const atTheLocation = setup({ limits: { starts: limiter(0) } });
    const held = await read(await atTheLocation.call('POST', '/v1/device/authorize', { body: CLI }));

    const everyone = setup({ limits: { login: limiter(), starts: limiter() } });
    for (let count = 0; count < STARTS_PER_MINUTE; count += 1) await everyone.call('POST', '/v1/device/authorize', { body: CLI });
    const past = await read(await everyone.call('POST', '/v1/device/authorize', { body: CLI }));
    everyone.advance(MINUTE);
    const nextMinute = await everyone.call('POST', '/v1/device/authorize', { body: CLI });

    assert.deepEqual(statuses, [...Array(10).fill(200), 429]);
    assert.deepEqual(refused, { status: 429, body: { error: 'slow_down', error_description: 'Too many sign-ins from this network; try again in a minute.' } });
    assert.equal(elsewhere.status, 200);
    // Only the starts its network let through reached everyone's limit, under one key.
    assert.deepEqual(fromOne.deps.limits.starts.keys, Array(11).fill('everyone'));
    assert.deepEqual(held, { status: 429, body: { error: 'slow_down', error_description: 'Too many sign-ins are starting right now; try again in a minute.' } });
    assert.equal(await atTheLocation.quota.startSignIn({ limit: 1 }), true, 'a start the location refused is not counted');
    assert.deepEqual(past, held);
    assert.equal(nextMinute.status, 200);
    assert.deepEqual(await rows(everyone.db, 'SELECT count(1) AS codes FROM device_codes'), [{ codes: STARTS_PER_MINUTE + 1 }]);
    assert.deepEqual(await rows(atTheLocation.db, 'SELECT count(1) AS codes FROM device_codes'), [{ codes: 0 }]);
});

test('answers 503 to a start while no way of signing in is set up', async () => {
    const context = setup();
    const unset = { ...env, GITHUB_CLIENT_ID: '' };

    const response = await handleRequest(new Request(`${API}/v1/device/authorize`, { method: 'POST', body: JSON.stringify(CLI) }), unset, context.deps);

    assert.deepEqual(await read(response), { status: 503, body: { error: 'temporarily_unavailable', error_description: 'Signing in is not set up.' } });
});

test('keeps a device waiting until its code is approved, then asks for the number, and signs it in with the number as the account that approved', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const started = await start(context);

    const waiting = await read(await poll(context, started.device_code));
    const page = await read(await context.call('POST', '/account/device/approve', { origin: API, cookie: await cookieOf(user), body: { user_code: started.user_code, approve: true } }));
    const asking = await read(await poll(context, started.device_code));
    const signed = await read(await poll(context, started.device_code, page.body.match));
    const again = await read(await poll(context, started.device_code, page.body.match));

    assert.deepEqual(waiting, { status: 400, body: { error: 'authorization_pending', error_description: 'The code waits to be approved on the page.' } });
    assert.deepEqual(asking, { status: 400, body: { error: 'matching_required', error_description: POLL_WORDS.matching_required } });
    assert.equal(signed.status, 200);
    assert.match(signed.body.access_token, /^cbt_[A-Za-z0-9_-]{43}$/);
    assert.deepEqual({ ...signed.body, access_token: 'cbt_…' }, { access_token: 'cbt_…', token_type: 'Bearer', account: { id: user.id, name: 'made_up_dev' } });
    assert.deepEqual(await read(await context.call('GET', '/v1/account', { token: signed.body.access_token })), { status: 200, body: { id: user.id, name: 'made_up_dev' } });
    assert.deepEqual(await rows(context.db, 'SELECT user_id, kind, label FROM tokens'), [{ user_id: Number(user.id), kind: 'app', label: 'crossbind app 1.0.0 on iOS 27.1' }]);
    assert.deepEqual(again, { status: 400, body: { error: 'access_denied', error_description: POLL_WORDS.ended } });
});

test('gives the CLI a token of its own kind and label from the same page', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const { started, match } = await approved(context, user, CLI);

    const signed = await read(await poll(context, started.device_code, match));

    assert.equal(signed.status, 200);
    assert.deepEqual(await rows(context.db, 'SELECT kind, label FROM tokens'), [{ kind: 'cli', label: 'crossbind CLI 2.0.0-beta.79' }]);
    assert.equal((await context.call('GET', '/v1/usage', { token: signed.body.access_token })).status, 200);
});

test('gives a code one try: a wrong number ends it, and the right one after it gets nothing', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const { started, match } = await approved(context, user);

    const wrong = await read(await poll(context, started.device_code, otherThan(match)));
    const right = await read(await poll(context, started.device_code, match));

    assert.deepEqual(wrong, { status: 400, body: { error: 'access_denied', error_description: POLL_WORDS.mismatch } });
    assert.deepEqual(right, { status: 400, body: { error: 'access_denied', error_description: POLL_WORDS.ended } });
    assert.deepEqual(await rows(context.db, 'SELECT state FROM device_codes'), [{ state: 'denied' }]);
    assert.deepEqual(await rows(context.db, 'SELECT count(1) AS tokens FROM tokens'), [{ tokens: 0 }]);
});

test('gives numbers sent at once one try between them: three of them, or the right one three times, get one token at most', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const mixed = await approved(context, user);
    const repeated = await approved(context, user);

    const guesses = await Promise.all([otherThan(mixed.match), mixed.match, otherThan(otherThan(mixed.match))].map((match) => poll(context, mixed.started.device_code, match)));
    const sameNumber = await Promise.all([1, 2, 3].map(() => poll(context, repeated.started.device_code, repeated.match)));
    const signedByGuesses = guesses.filter((answer) => answer.status === 200).length;

    assert.ok(signedByGuesses <= 1);
    assert.deepEqual(sameNumber.map((answer) => answer.status).sort(), [200, 400, 400]);
    assert.deepEqual(await rows(context.db, 'SELECT count(1) AS tokens FROM tokens'), [{ tokens: 1 + signedByGuesses }]);
    assert.notEqual((await poll(context, mixed.started.device_code, mixed.match)).status, 200);
});

test('ends a code after ten minutes, approved or not, for the device and the page', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const waiting = await start(context);
    const { started, match } = await approved(context, user);

    context.advance(10 * MINUTE);
    const answers = [await read(await poll(context, waiting.device_code)), await read(await poll(context, started.device_code, match))];
    const looked = await context.call('POST', '/account/device/lookup', { origin: API, cookie: await cookieOf(user), body: { user_code: waiting.user_code } });

    assert.deepEqual(answers, Array(2).fill({ status: 400, body: { error: 'expired_token', error_description: 'The code expired; start again.' } }));
    assert.equal(looked.status, 404);
    assert.deepEqual(await rows(context.db, 'SELECT count(1) AS tokens FROM tokens'), [{ tokens: 0 }]);
});

test('tells a device that polls faster than every five seconds to slow down, by its code\'s hash', async () => {
    const context = setup();
    const first = await start(context);
    const second = await start(context);

    const errors = [];
    for (let count = 0; count < 15; count += 1) errors.push((await (await poll(context, first.device_code)).json()).error);
    const slowed = await read(await poll(context, first.device_code));
    const other = await read(await poll(context, second.device_code));

    assert.deepEqual(errors, [...Array(13).fill('authorization_pending'), 'slow_down', 'slow_down']);
    assert.deepEqual(slowed, { status: 400, body: { error: 'slow_down', error_description: 'Polled too often: wait five seconds more between polls.' } });
    assert.equal(other.body.error, 'authorization_pending');
    assert.deepEqual([...new Set(context.deps.limits.poll.keys)], [hashOf(first.device_code), hashOf(second.device_code)]);
});

test('answers invalid_grant to a code it never made, and invalid_request to a poll out of its form', async () => {
    const context = setup();
    const started = await start(context);
    const bodies = [
        {}, 'not JSON', { device_code: 'short' }, { device_code: started.device_code, match: '47' }, { device_code: started.device_code, match: MATCH_FROM - 1 },
        { device_code: started.device_code, match: MATCH_TO + 1 }, { device_code: started.device_code, match: 47.5 }, { device_code: [started.device_code] },
    ];

    const unknown = await read(await poll(context, 'A'.repeat(43)));
    const malformed = [];
    for (const body of bodies) malformed.push(await read(await context.call('POST', '/v1/device/token', { body })));

    assert.deepEqual(unknown, { status: 400, body: { error: 'invalid_grant', error_description: 'No sign-in has this code; start again.' } });
    assert.deepEqual(new Set(malformed.map(JSON.stringify)), new Set([JSON.stringify({
        status: 400, body: { error: 'invalid_request', error_description: 'Send {"device_code"}, with "match" once the code is approved.' },
    })]));
});

test('signs no device in for an account blocked since its approval, and none for one deleted since, whose codes went with it', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const blocked = await approved(context, user);
    const deleted = await approved(context, user);

    await context.db.prepare('UPDATE users SET blocked = 1').run();
    const refused = await read(await poll(context, blocked.started.device_code, blocked.match));
    await context.db.prepare('UPDATE users SET blocked = 0').run();
    await context.accounts.deleteAccount(user.id);
    const gone = await read(await poll(context, deleted.started.device_code, deleted.match));

    assert.deepEqual(refused, { status: 400, body: { error: 'access_denied', error_description: 'This account may not use crossbind cloud.' } });
    assert.deepEqual(gone, { status: 400, body: { error: 'invalid_grant', error_description: 'No sign-in has this code; start again.' } });
    assert.deepEqual(await rows(context.db, 'SELECT count(1) AS tokens FROM tokens'), [{ tokens: 0 }]);
});

test('draws user codes and numbers without bias: in 100,000 draws each letter, and each number of 10 to 99, falls within its expected range', () => {
    const DRAWS = 100_000;
    const letters = new Map([...CODE_LETTERS].map((letter) => [letter, 0]));
    const numbers = new Map(Array.from({ length: MATCH_TO - MATCH_FROM + 1 }, (_, index) => [MATCH_FROM + index, 0]));

    for (let draw = 0; draw < DRAWS; draw += 1) {
        for (const letter of drawUserCode()) letters.set(letter, letters.get(letter) + 1);
        const match = drawMatch();
        numbers.set(match, numbers.get(match) + 1);
    }

    // Six standard deviations each side: a fair draw falls outside about once in five hundred million, while
    // `byte % count` gives each letter past the 16th about 37,500 and each number past 85 about 781, outside both.
    const outside = (counts, total) => {
        const share = 1 / counts.size;
        const spread = 6 * Math.sqrt(total * share * (1 - share));
        return [...counts].filter(([, count]) => Math.abs(count - total * share) > spread).map(([value]) => value);
    };
    assert.equal(letters.size, 20);
    assert.deepEqual(outside(letters, DRAWS * 8), []);
    assert.equal(numbers.size, 90);
    assert.deepEqual(outside(numbers, DRAWS), []);
});

test('prunes the codes past their ten minutes, whatever came of them, and keeps the live ones', async () => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    await approved(context, user);
    await start(context);
    context.advance(10 * MINUTE + 1);
    const live = await start(context);

    await createDeviceCodes(context.db, () => NOW + 10 * MINUTE + 1).prune();

    assert.deepEqual(await rows(context.db, 'SELECT user_code FROM device_codes'), [{ user_code: live.user_code.replace('-', '') }]);
});

test('logs a device\'s sign-in by the account\'s id and the kind alone: no code, number, label or country', async (t) => {
    const context = setup();
    const { user } = await context.accounts.signIn(dev);
    const lines = t.mock.method(console, 'log', () => {});
    const started = await start(context, APP, { country: 'TR' });
    const page = await (await context.call('POST', '/account/device/approve', { origin: API, cookie: await cookieOf(user), body: { user_code: started.user_code, approve: true } })).json();
    const signed = await (await poll(context, started.device_code, page.match)).json();

    const logged = lines.mock.calls.map((each) => each.arguments[0]);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
        { event: 'device-approved', who: `user:${user.id}` },
        { event: 'device-signed-in', who: `user:${user.id}`, kind: 'app' },
    ]);
    for (const secret of [started.device_code, started.user_code, started.user_code.replace('-', ''), signed.access_token]) {
        assert.ok(!logged.some((line) => line.includes(secret)), 'a code or a token logged');
    }
});
