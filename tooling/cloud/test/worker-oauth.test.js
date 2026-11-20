import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    startLogin, finishLogin, requestDeviceCode, pollDeviceCode, STATE_COOKIE,
} from '../worker/oauth.js';
import { readSession, SESSION_COOKIE } from '../worker/session.js';

const NOW = Date.parse('2026-10-07T12:00:00Z');
const DAY = 24 * 3600 * 1000;
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_URL: 'https://crossbind.dev/playground/',
    MIN_GITHUB_ACCOUNT_DAYS: '30',
};
const API = 'https://api.crossbind.dev';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

const setCookies = (response) => response.headers.getSetCookie();
const stateFrom = (response) => setCookies(response).find((c) => c.startsWith(`${STATE_COOKIE}=`)).split(';')[0].slice(STATE_COOKIE.length + 1);

function callback({
    state, cookieState = state, verifier = 'v1', query = {},
}) {
    const url = new URL(`${API}/playground/callback/github`);
    Object.entries({ code: 'the-code', state, ...query }).forEach(([k, v]) => url.searchParams.set(k, v));
    return new Request(url, { headers: { cookie: `${STATE_COOKIE}=${cookieState}.${verifier}` } });
}

const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');

const userEndpoint = (ageDays) => (url, init) => {
    assert.equal(url, 'https://api.github.com/user');
    assert.equal(init.headers.authorization, 'Bearer gho_token');
    return Response.json({ id: 583231, login: 'octocat', created_at: new Date(NOW - ageDays * DAY).toISOString() });
};

// GitHub's web-flow token endpoint and its user endpoint, answering for an account created `ageDays` ago.
const github = (ageDays) => async (url, init) => {
    if (url !== 'https://github.com/login/oauth/access_token') return userEndpoint(ageDays)(url, init);
    const body = JSON.parse(init.body);
    assert.deepEqual([body.client_secret, body.code, body.redirect_uri, body.code_verifier], ['gh-secret', 'the-code', `${API}/playground/callback/github`, 'v1']);
    return Response.json({ access_token: 'gho_token' });
};

// The device flow's token endpoint answers 200 with `error` until the user approves the code.
const deviceGitHub = (answer, ageDays = 400) => async (url, init) => {
    if (url !== 'https://github.com/login/oauth/access_token') return userEndpoint(ageDays)(url, init);
    assert.deepEqual(JSON.parse(init.body), { client_id: 'gh-id', device_code: 'the-device-code', grant_type: DEVICE_GRANT });
    return Response.json(answer);
};

// The account the GitHub account signs in to: one of crossbind's own, whose id is not the GitHub id.
const ACCOUNT_ID = '1099511627781';

function accountsWith({ blocked = false, freeFrom } = {}) {
    const signedIn = [];
    return {
        signedIn,
        signIn: async (identity) => {
            signedIn.push(identity);
            return freeFrom ? { freeFrom } : { user: { id: ACCOUNT_ID, login: identity.login, blocked } };
        },
    };
}

const finish = (request, { fetcher = github(400), accounts = accountsWith(), environment = env } = {}) => finishLogin(request, environment, { fetcher, now: NOW, accounts });

test('sends the browser to GitHub with no scope, a state it remembers and the challenge of a verifier it keeps', async () => {
    const response = await startLogin(new Request(`${API}/playground/login/github`), env);
    const location = new URL(response.headers.get('location'));
    const [state, verifier] = stateFrom(response).split('.');

    assert.equal(response.status, 302);
    assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize');
    assert.equal(location.searchParams.get('scope'), null);
    assert.equal(location.searchParams.get('redirect_uri'), `${API}/playground/callback/github`);
    assert.equal(state, location.searchParams.get('state'));
    assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(location.searchParams.get('code_challenge'), challengeOf(verifier));
    assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.href.includes(verifier), false);
    assert.match(setCookies(response)[0], /HttpOnly; SameSite=Lax/);
});

test('signs the GitHub account in to its account, whose id the session holds, and returns to the playground', async () => {
    const accounts = accountsWith();

    const response = await finish(callback({ state: 's1' }), { accounts });

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=ok');
    assert.deepEqual(accounts.signedIn, [{ provider: 'github', subject: '583231', login: 'octocat' }]);
    const session = setCookies(response).find((c) => c.startsWith(`${SESSION_COOKIE}=`)).split(';')[0];
    assert.deepEqual(await readSession(new Request(API, { headers: { cookie: session } }), env.SESSION_SECRET, NOW), { id: ACCOUNT_ID, name: 'octocat' });
    assert.ok(setCookies(response).some((c) => c.startsWith(`${STATE_COOKIE}=; Max-Age=0`)));
});

test('binds GitHub\'s code to the browser that asked for it: with another verifier, or none, it signs nobody in', async () => {
    const started = await startLogin(new Request(`${API}/playground/login/github`), env);
    const [state, verifier] = stateFrom(started).split('.');
    const challenge = new URL(started.headers.get('location')).searchParams.get('code_challenge');
    // GitHub keeps the challenge with the code it issues, and gives a token for the verifier that made it alone.
    const sent = [];
    const pkce = async (url, init) => {
        if (url !== 'https://github.com/login/oauth/access_token') return userEndpoint(400)(url, init);
        sent.push(JSON.parse(init.body).code_verifier);
        return Response.json(challengeOf(sent.at(-1) ?? '') === challenge ? { access_token: 'gho_token' } : { error: 'bad_verification_code' });
    };
    const accounts = accountsWith();

    const outcomes = [];
    for (const each of [verifier, 'another-browser-s-verifier', '']) {
        outcomes.push((await finish(callback({ state, verifier: each }), { fetcher: pkce, accounts })).headers.get('location'));
    }

    assert.deepEqual(outcomes, ['ok', 'failed', 'failed'].map((result) => `https://crossbind.dev/playground/#login=${result}`));
    assert.deepEqual(sent, [verifier, 'another-browser-s-verifier']);
    assert.equal(accounts.signedIn.length, 1);
});

test('turns away a GitHub account younger than the minimum age before recording it', async () => {
    const accounts = accountsWith();

    const response = await finish(callback({ state: 's1' }), { fetcher: github(3), accounts });

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=too-new');
    assert.ok(!setCookies(response).some((c) => c.startsWith(`${SESSION_COOKIE}=`)));
    assert.equal(accounts.signedIn.length, 0);
});

test('turns away a blocked account without a session, and logs the account\'s id alone', async (t) => {
    const lines = t.mock.method(console, 'log', () => {});

    const response = await finish(callback({ state: 's1' }), { accounts: accountsWith({ blocked: true }) });

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=blocked');
    assert.ok(!setCookies(response).some((c) => c.startsWith(`${SESSION_COOKIE}=`)));
    assert.deepEqual(lines.mock.calls.map((each) => JSON.parse(each.arguments[0])), [{ event: 'blocked-sign-in', who: `user:${ACCOUNT_ID}` }]);
});

test('signs an identity that is held in to nothing', async () => {
    const response = await finish(callback({ state: 's1' }), { accounts: accountsWith({ freeFrom: '2026-11-01' }) });

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=held');
    assert.ok(!setCookies(response).some((c) => c.startsWith(`${SESSION_COOKIE}=`)));
});

test('refuses a callback whose state does not match the one it set', async () => {
    const forged = await finish(callback({ state: 'attacker', cookieState: 's1' }));
    const missing = await finish(new Request(`${API}/playground/callback/github?code=c&state=s1`));

    assert.equal(forged.headers.get('location'), 'https://crossbind.dev/playground/#login=failed');
    assert.equal(missing.headers.get('location'), 'https://crossbind.dev/playground/#login=failed');
});

test('reports a login the user cancelled at GitHub', async () => {
    const response = await finish(callback({ state: 's1', query: { error: 'access_denied' } }));

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=cancelled');
});

test('answers 503 while GitHub sign-in is not set up', async () => {
    assert.equal((await startLogin(new Request(`${API}/playground/login/github`), { ...env, GITHUB_CLIENT_SECRET: '' })).status, 503);
    assert.equal((await startLogin(new Request(`${API}/playground/login/github`), { ...env, SESSION_SECRET: undefined })).status, 503);
});

test('asks GitHub for a device code with the client id alone, so the CLI sign-in gets no scope', async () => {
    const sent = [];
    const fetcher = async (url, init) => {
        sent.push({ url, body: JSON.parse(init.body) });
        return Response.json({
            device_code: 'the-device-code', user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
        });
    };

    const code = await requestDeviceCode(env, fetcher);

    assert.deepEqual(sent, [{ url: 'https://github.com/login/device/code', body: { client_id: 'gh-id' } }]);
    assert.deepEqual(code, {
        deviceCode: 'the-device-code', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5,
    });
});

test('refuses a device code answer that does not send the user to GitHub', async () => {
    const fetcher = async () => Response.json({
        device_code: 'd', user_code: 'WDJB-MJHT', verification_uri: 'https://evil.example/device', expires_in: 900, interval: 5,
    });

    await assert.rejects(() => requestDeviceCode(env, fetcher), /device code/);
});

test('keeps a device login pending until the user approves it, at the pace GitHub asks for', async () => {
    const poll = (answer) => pollDeviceCode('the-device-code', env, { fetcher: deviceGitHub(answer), now: NOW });

    assert.deepEqual(await poll({ error: 'authorization_pending' }), { pending: true });
    assert.deepEqual(await poll({ error: 'slow_down', interval: 10 }), { pending: true, interval: 10 });
});

test('turns an approved device code into the GitHub account\'s identity, after the age check', async () => {
    const approved = { access_token: 'gho_token', token_type: 'bearer', scope: '' };

    const identity = await pollDeviceCode('the-device-code', env, { fetcher: deviceGitHub(approved), now: NOW });
    const tooNew = await pollDeviceCode('the-device-code', env, { fetcher: deviceGitHub(approved, 3), now: NOW });

    assert.deepEqual(identity, { identity: { provider: 'github', subject: '583231', login: 'octocat' } });
    assert.deepEqual(tooNew, { failure: 'too-new' });
});

test('keeps the default minimum account age when the setting is left blank', async () => {
    const response = await finish(callback({ state: 's1' }), { fetcher: github(3), environment: { ...env, MIN_GITHUB_ACCOUNT_DAYS: '' } });

    assert.equal(response.headers.get('location'), 'https://crossbind.dev/playground/#login=too-new');
});

test('logs only device-flow failures that point at a setup problem, not codes anyone can make up', async (t) => {
    const lines = t.mock.method(console, 'log', () => {});
    const poll = (error) => pollDeviceCode('the-device-code', env, { fetcher: deviceGitHub({ error }), now: NOW });

    await poll('incorrect_device_code');
    await poll('device_flow_disabled');

    assert.deepEqual(lines.mock.calls.map((each) => JSON.parse(each.arguments[0]).error), ['device_flow_disabled']);
});

test('reports an expired, cancelled or unknown device code as such', async () => {
    const poll = (error) => pollDeviceCode('the-device-code', env, { fetcher: deviceGitHub({ error }), now: NOW });

    assert.deepEqual(await poll('expired_token'), { failure: 'expired' });
    assert.deepEqual(await poll('access_denied'), { failure: 'cancelled' });
    assert.deepEqual(await poll('incorrect_device_code'), { failure: 'failed' });
    assert.deepEqual(await poll('device_flow_disabled'), { failure: 'failed' });
});
