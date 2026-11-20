import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createAccounts, OWN_IDS_FROM } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { CLIENT_SECRET_SECONDS } from '../worker/apple.js';
import { STATE_COOKIE } from '../worker/oauth.js';
import { NOTICE_COOKIE, SESSION_COOKIE } from '../worker/session.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const API = 'https://api.crossbind.dev';
const SITE = 'https://crossbind.dev';
const NOW = Date.parse('2026-11-20T10:00:00Z');
// A key made for these tests alone, in the form of Apple's .p8: a PEM of PKCS #8.
const KEYS = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const PEM = `-----BEGIN PRIVATE KEY-----\n${Buffer.from(await webcrypto.subtle.exportKey('pkcs8', KEYS.privateKey)).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
const APPLE_ENV = {
    APPLE_SERVICES_ID: 'dev.made-up.signin', APPLE_TEAM_ID: 'MADEUPTEAM', APPLE_KEY_ID: 'MADEUPKEY1', APPLE_PRIVATE_KEY: PEM,
};
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_URL: `${SITE}/playground/`,
    ALLOWED_ORIGINS: SITE,
    MIN_GITHUB_ACCOUNT_DAYS: '30',
    ...APPLE_ENV,
};
// A made-up Apple id, in the form of Apple's `sub`.
const SUB = '000123.made0up0apple0id0for0tests.0456';
const fromBase64Url = (text) => Buffer.from(text, 'base64url');
const jsonOf = (part) => JSON.parse(fromBase64Url(part).toString());

// Apple as the Worker asks it: its token endpoint gives an id_token for the code of the person `subject`, with the nonce
// the authorize URL carried (the code holds it, as Apple keeps it with the code), and records each revoke.
function apple({
    subject = SUB, claims = {}, status = 200, refresh = 'made-up-refresh-token', revokeStatus = 200, extra = { email: 'made-up@example.com' },
} = {}) {
    const calls = { token: [], revoke: [] };
    const fetcher = async (url, init) => {
        const body = Object.fromEntries(new URLSearchParams(init.body));
        if (url === 'https://appleid.apple.com/auth/revoke') {
            calls.revoke.push(body);
            return new Response(null, { status: revokeStatus });
        }
        assert.equal(url, 'https://appleid.apple.com/auth/token');
        calls.token.push(body);
        if (status !== 200) return Response.json({ error: 'invalid_grant' }, { status });
        const { nonce } = jsonOf(body.code);
        const payload = {
            iss: 'https://appleid.apple.com', aud: APPLE_ENV.APPLE_SERVICES_ID, exp: Math.floor(NOW / 1000) + 600, iat: Math.floor(NOW / 1000), sub: subject, nonce, ...extra, ...claims,
        };
        const idToken = [{ alg: 'RS256', kid: 'made-up' }, payload].map((part) => Buffer.from(JSON.stringify(part)).toString('base64url')).join('.');
        return Response.json({
            access_token: 'made-up-access-token', token_type: 'Bearer', expires_in: 3600, id_token: `${idToken}.made-up-signature`, ...(refresh ? { refresh_token: refresh } : {}),
        });
    };
    return { fetcher, calls };
}

function setup({ fetcher = apple().fetcher, environment = env } = {}) {
    const db = sqliteD1();
    const accounts = createAccounts(db, () => NOW, () => OWN_IDS_FROM + 1643);
    const deps = {
        limits: { api: { limit: async () => ({ success: true }) } }, accounts, quota: { remaining: async ({ limit }) => limit }, fetcher, now: () => NOW,
    };
    const send = (path, { cookie } = {}) => handleRequest(new Request(`${API}${path}`, { headers: cookie ? { cookie } : {} }), environment, deps);
    return { db, accounts, send };
}

const cookiesOf = (response) => Object.fromEntries(response.headers.getSetCookie().map((cookie) => cookie.split(';')[0].split(/=(.*)/s).slice(0, 2)));

// A sign-in in one browser: the start, then Apple's answer at the callback, with the code `answer` makes of the URL.
async function signIn(send, { start = '/account/login/apple', answer = (asked) => ({ code: Buffer.from(JSON.stringify({ nonce: asked.searchParams.get('nonce') })).toString('base64url'), state: asked.searchParams.get('state') }) } = {}) {
    const started = await send(start);
    const asked = new URL(started.headers.get('location'));
    const back = new URL(`${API}/playground/callback/apple`);
    Object.entries(answer(asked)).forEach(([key, value]) => back.searchParams.set(key, value));
    const response = await send(`${back.pathname}${back.search}`, { cookie: `${STATE_COOKIE}=${cookiesOf(started)[STATE_COOKIE]}` });
    return { started, asked, response };
}

test('answers 503 while Signing in with Apple is not set up, and the page offers it only once it is, beside GitHub', async () => {
    const unset = setup({ environment: { ...env, APPLE_PRIVATE_KEY: '' } });
    const { send } = setup();

    const refused = await unset.send('/account/login/apple');
    const without = await (await unset.send('/login')).text();
    const both = await (await send('/login?next=playground')).text();

    assert.deepEqual([refused.status, (await refused.json()).error], [503, 'Signing in with Apple is not set up.']);
    assert.ok(!without.includes('/account/login/apple') && without.includes('Sign in with GitHub'));
    assert.ok(both.includes('<a class="button" href="/account/login/github?next=playground">Sign in with GitHub</a> <a class="button" href="/account/login/apple?next=playground">Sign in with Apple</a>'));
});

test('sends the browser to Apple asking for no scope, in query mode, with the callback Apple lists, a state it remembers and the nonce of a secret it keeps', async () => {
    const { send } = setup();

    const started = await send('/account/login/apple?next=playground');
    const asked = new URL(started.headers.get('location'));
    const [state, secret, next, provider] = cookiesOf(started)[STATE_COOKIE].split('.');

    assert.equal(started.status, 302);
    assert.equal(`${asked.origin}${asked.pathname}`, 'https://appleid.apple.com/auth/authorize');
    assert.deepEqual(Object.fromEntries(asked.searchParams), {
        client_id: 'dev.made-up.signin',
        redirect_uri: `${API}/playground/callback/apple`,
        response_type: 'code',
        response_mode: 'query',
        state,
        nonce: createHash('sha256').update(secret).digest('base64url'),
    });
    assert.deepEqual([next, provider], ['playground', 'apple']);
    assert.ok(!asked.href.includes(secret));
    assert.match(started.headers.getSetCookie()[0], /^__Host-pg_oauth=[^;]+; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
});

test('exchanges the code with a client secret of five minutes signed by the key, revokes the refresh token at once, and reads nothing but sub', async () => {
    const { fetcher, calls } = apple();
    const { db, accounts, send } = setup({ fetcher });
    await db.batch([
        db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (583231, 'made_up_dev', ?1, ?1)").bind(new Date(NOW).toISOString()),
        db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', '583231', 583231, ?1), ('apple', ?2, 583231, ?1)").bind(new Date(NOW).toISOString(), SUB),
    ]);

    const { response } = await signIn(send);
    const [header, claims, signature] = calls.token[0].client_secret.split('.');
    const verified = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, KEYS.publicKey, fromBase64Url(signature), Buffer.from(`${header}.${claims}`));

    assert.equal(response.headers.get('location'), `${API}/login#login=ok`);
    assert.ok(cookiesOf(response)[SESSION_COOKIE]);
    assert.deepEqual({ ...calls.token[0], client_secret: 'checked below' }, {
        client_id: 'dev.made-up.signin', client_secret: 'checked below', code: calls.token[0].code, grant_type: 'authorization_code', redirect_uri: `${API}/playground/callback/apple`,
    });
    assert.equal(verified, true);
    assert.deepEqual(jsonOf(header), { alg: 'ES256', kid: 'MADEUPKEY1' });
    assert.deepEqual(jsonOf(claims), {
        iss: 'MADEUPTEAM', iat: NOW / 1000, exp: NOW / 1000 + CLIENT_SECRET_SECONDS, aud: 'https://appleid.apple.com', sub: 'dev.made-up.signin',
    });
    assert.equal(CLIENT_SECRET_SECONDS, 300);
    assert.deepEqual(calls.revoke, [{
        client_id: 'dev.made-up.signin', client_secret: calls.token[0].client_secret, token: 'made-up-refresh-token', token_type_hint: 'refresh_token',
    }]);
    // The account keeps its GitHub name through a sign-in with its Apple ID, which brings none, and nothing of the
    // email Apple's answer held is kept.
    assert.deepEqual((await accounts.standing('583231')).name, 'made_up_dev');
    const kept = JSON.stringify([...(await db.prepare('SELECT * FROM users').all()).results, ...(await db.prepare('SELECT * FROM identities').all()).results]);
    assert.ok(!kept.includes('@') && !kept.includes('made-up-refresh-token'));
});

test('makes an account for an Apple ID crossbind does not know, named by the last four digits of its id', async () => {
    const { db, send } = setup();

    const { response } = await signIn(send);
    const page = await (await send('/login', { cookie: `${SESSION_COOKIE}=${cookiesOf(response)[SESSION_COOKIE]}` })).text();

    assert.equal(response.headers.get('location'), `${API}/login#login=ok`);
    assert.deepEqual((await db.prepare('SELECT id, login FROM users').all()).results, [{ id: OWN_IDS_FROM + 1643, login: '' }]);
    assert.deepEqual((await db.prepare('SELECT provider, subject FROM identities').all()).results, [{ provider: 'apple', subject: SUB }]);
    assert.ok(page.includes(`Signed in as <strong>Apple account …${String(OWN_IDS_FROM + 1643).slice(-4)}</strong>.`));
});

test('signs nobody in on an answer that is not this sign-in\'s, and revokes what Apple gave all the same', async () => {
    const tries = {
        'Apple\'s cancel': [{}, (asked) => ({ error: 'user_cancelled_authorize', state: asked.searchParams.get('state') })],
        'another state': [{}, (asked) => ({ code: Buffer.from(JSON.stringify({ nonce: asked.searchParams.get('nonce') })).toString('base64url'), state: 'made-up-state' })],
        'another nonce': [{}, (asked) => ({ code: Buffer.from(JSON.stringify({ nonce: 'made-up-nonce' })).toString('base64url'), state: asked.searchParams.get('state') })],
        'Apple\'s 400': [{ status: 400 }],
        'another issuer': [{ claims: { iss: 'https://evil.example' } }],
        'another audience': [{ claims: { aud: 'dev.another.signin' } }],
        'an expired token': [{ claims: { exp: Math.floor(NOW / 1000) - 1 } }],
        'no user': [{ claims: { sub: '' } }],
    };

    const outcomes = {};
    for (const [name, [answer, code]] of Object.entries(tries)) {
        const { fetcher, calls } = apple(answer);
        const { db, send } = setup({ fetcher });
        const { response } = await signIn(send, code ? { answer: code } : {});
        outcomes[name] = {
            location: response.headers.get('location'), session: Boolean(cookiesOf(response)[SESSION_COOKIE]), accounts: (await db.prepare('SELECT count(1) AS n FROM users').first('n')), revoked: calls.revoke.length,
        };
    }

    const failed = (revoked) => ({
        location: `${API}/login#login=failed`, session: false, accounts: 0, revoked,
    });
    assert.deepEqual(outcomes, {
        'Apple\'s cancel': {
            location: `${API}/login#login=cancelled`, session: false, accounts: 0, revoked: 0,
        },
        'another state': failed(0),
        'another nonce': failed(1),
        'Apple\'s 400': failed(0),
        'another issuer': failed(1),
        'another audience': failed(1),
        'an expired token': failed(1),
        'no user': failed(1),
    });
});

test('takes no state of a GitHub sign-in at Apple\'s callback, nor one of Apple\'s at GitHub\'s, though the answer would hold', async () => {
    // Apple's stand-in, and a GitHub that gives a token for any code: an answer each callback would take but for the
    // provider its state cookie names.
    const both = async (url, init) => {
        if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: 'gho_made_up' });
        if (url === 'https://api.github.com/user') return Response.json({ id: 8000000001, login: 'made_up_dev', created_at: new Date(NOW - 400 * 24 * 3600 * 1000).toISOString() });
        return apple().fetcher(url, init);
    };
    const { db, send } = setup({ fetcher: both });
    const github = await send('/account/login/github');
    const appleStart = await send('/account/login/apple');
    const stateOf = (response) => new URL(response.headers.get('location')).searchParams.get('state');
    const secretOf = (response) => cookiesOf(response)[STATE_COOKIE].split('.')[1];
    const code = Buffer.from(JSON.stringify({ nonce: createHash('sha256').update(secretOf(github)).digest('base64url') })).toString('base64url');

    const atApple = await send(`/playground/callback/apple?code=${code}&state=${stateOf(github)}`, { cookie: `${STATE_COOKIE}=${cookiesOf(github)[STATE_COOKIE]}` });
    const atGitHub = await send(`/playground/callback/github?code=made-up&state=${stateOf(appleStart)}`, { cookie: `${STATE_COOKIE}=${cookiesOf(appleStart)[STATE_COOKIE]}` });

    assert.deepEqual([atApple, atGitHub].map((response) => response.headers.get('location')), [`${API}/login#login=failed`, `${API}/login#login=failed`]);
    assert.equal(await db.prepare('SELECT count(1) AS n FROM users').first('n'), 0);
});

test('signs in when Apple refuses the revoke, logging its status alone, and never logs Apple\'s id, a token or a code', async (t) => {
    const lines = t.mock.method(console, 'log', () => {});
    const refusing = apple({ revokeStatus: 503 });
    const ok = setup({ fetcher: refusing.fetcher });
    const lying = setup({ fetcher: apple({ claims: { iss: 'https://evil.example' } }).fetcher });

    const { response } = await signIn(ok.send);
    const { response: refused } = await signIn(lying.send);

    assert.equal(response.headers.get('location'), `${API}/login#login=ok`);
    assert.equal(refused.headers.get('location'), `${API}/login#login=failed`);
    const logged = lines.mock.calls.map((each) => each.arguments[0]);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
        { event: 'apple-revoke-failed', status: 503 },
        { event: 'login-failed', provider: 'apple', message: 'Apple\'s id_token is not for this sign-in' },
    ]);
    assert.ok(![SUB, 'made-up-refresh-token', 'made-up-access-token', refusing.calls.token[0].code].some((secret) => logged.join('\n').includes(secret)));
});

test('shows a held Apple ID the day it signs in again, once, from the notice its sign-in left', async () => {
    const { db, send } = setup();
    const at = new Date(NOW).toISOString();
    await db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (583231, 'made_up_dev', ?1, ?1)").bind(at).run();
    await db.prepare("INSERT INTO identities (provider, subject, user_id, created_at, unlinked_at) VALUES ('github', '583231', 583231, ?1, NULL), ('apple', ?2, 583231, ?1, ?1)").bind(at, SUB).run();

    const { response } = await signIn(send);
    const notice = `${NOTICE_COOKIE}=${cookiesOf(response)[NOTICE_COOKIE]}`;
    const shown = await send('/login', { cookie: notice });
    const forged = await (await send('/login', { cookie: `${NOTICE_COOKIE}=${Buffer.from(JSON.stringify({ said: 'held', provider: 'apple', day: '<b>' })).toString('base64url')}` })).text();

    assert.deepEqual([response.headers.get('location'), cookiesOf(response)[SESSION_COOKIE]], [`${API}/login`, undefined]);
    assert.ok((await shown.text()).includes('<p class="notice" role="status">This Apple ID was unlinked from a crossbind account this month: it signs in again from 1 December 2026, and can be linked back to that account now.</p>'));
    assert.ok(shown.headers.getSetCookie().includes(`${NOTICE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`));
    assert.ok(!forged.includes('role="status"') && !forged.includes('<b>'));
});
