import { nameOf, userKey } from './accounts.js';
import { appleAuthorizeUrl, appleIdentity, isAppleConfigured } from './apple.js';
import { log } from './http.js';
import {
    signSession, sessionCookie, clearCookie, noticeCookie, readCookie, randomToken, toBase64Url, SESSION_COOKIE, SESSION_TTL_MS,
} from './session.js';
import { numberOr } from './settings.js';

export const STATE_COOKIE = '__Host-pg_oauth';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const USER_URL = 'https://api.github.com/user';
const GITHUB_ORIGIN = 'https://github.com';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const STATE_TTL_SECONDS = 600;
const DAY_MS = 24 * 3600 * 1000;
const DEFAULT_MIN_GITHUB_ACCOUNT_DAYS = 30;
const MAX_NAME_LENGTH = 64;
// The final answers of the device flow that anyone can cause, a made-up code among them; any other means the
// sign-in is set up wrong and is worth a log line.
const DEVICE_OUTCOMES = Object.freeze({ expired_token: 'expired', access_denied: 'cancelled', incorrect_device_code: 'failed' });

class LoginFailed extends Error {}

async function json(response) {
    if (!response.ok) throw new LoginFailed(`GitHub answered ${response.status}`);
    return response.json();
}

const post = (fetcher, url, body) => fetcher(url, {
    method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body),
});

export const isLoginConfigured = (env) => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET);
// The device flow is for public clients: it needs no client secret.
export const isDeviceLoginConfigured = (env) => Boolean(env.GITHUB_CLIENT_ID);
export const minAccountDays = (env) => numberOr(env.MIN_GITHUB_ACCOUNT_DAYS, DEFAULT_MIN_GITHUB_ACCOUNT_DAYS);

// Neither flow asks for a scope: an id and a name are all a sign-in needs. A fresh GitHub account per day would
// multiply the daily limits, so young accounts are turned away.
async function githubIdentity(accessToken, env, fetcher, now) {
    const user = await json(await fetcher(USER_URL, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'crossbind-cloud' },
    }));
    if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new LoginFailed('GitHub sent no user');
    if (!(now - Date.parse(user.created_at) >= minAccountDays(env) * DAY_MS)) return { failure: 'too-new' };
    return { identity: { provider: 'github', subject: String(user.id), login: user.login.slice(0, MAX_NAME_LENGTH) } };
}

function redirect(location, cookies) {
    const headers = new Headers({ location, 'cache-control': 'no-store' });
    cookies.forEach((cookie) => headers.append('set-cookie', cookie));
    return new Response(null, { status: 302, headers });
}

// PKCE (S256) binds GitHub's code to this browser, as the nonce binds Apple's: the verifier waits in its HttpOnly state
// cookie, so a code caught on its way is worth nothing in another browser.
async function githubAuthorizeUrl(env, redirectUri, state, verifier) {
    const challenge = toBase64Url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const url = new URL(AUTHORIZE_URL);
    Object.entries({
        client_id: env.GITHUB_CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: 'S256',
    }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.href;
}

async function githubWebIdentity(env, {
    code, secret, redirectUri, fetcher, now,
}) {
    const token = await json(await post(fetcher, TOKEN_URL, {
        client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: redirectUri, code_verifier: secret,
    }));
    if (typeof token.access_token !== 'string') throw new LoginFailed('GitHub sent no access token');
    return githubIdentity(token.access_token, env, fetcher, now);
}

// The ways a browser signs in, each through its own callback, the address its provider lists for this origin.
const PROVIDERS = Object.freeze({
    github: {
        configured: isLoginConfigured, unset: 'Signing in with GitHub is not set up.', authorizeUrl: githubAuthorizeUrl, identity: githubWebIdentity,
    },
    apple: {
        configured: isAppleConfigured, unset: 'Signing in with Apple is not set up.', authorizeUrl: appleAuthorizeUrl, identity: appleIdentity,
    },
});

export const signInProviders = (env) => Object.keys(PROVIDERS).filter((provider) => PROVIDERS[provider].configured(env));

const callbackUrl = (request, provider) => `${new URL(request.url).origin}/playground/callback/${provider}`;

// The state cookie holds `<state>.<secret>.<next>.<provider>`: the secret is GitHub's PKCE verifier or the source of
// Apple's nonce, and `next` where a sign-in returns, `account`, the account's page, or `playground`. A cookie of a
// sign-in started before Apple, with three parts or two, is GitHub's.
export async function startLogin(request, env, { provider = 'github', next = 'playground' } = {}) {
    const { configured, unset, authorizeUrl } = PROVIDERS[provider];
    if (!configured(env)) return Response.json({ error: unset }, { status: 503 });
    const state = randomToken();
    const secret = randomToken();
    const location = await authorizeUrl(env, callbackUrl(request, provider), state, secret);
    return redirect(location, [sessionCookie(STATE_COOKIE, `${state}.${secret}.${next}.${provider}`, STATE_TTL_SECONDS)]);
}

// Signed in, the browser goes where the start chose: the account's page on this origin, or the configured playground
// page, never an address the request names; a sign-in started before the account's page goes to the playground.
// Anything else comes back to the account's page, which says what happened and offers to sign in again.
export async function finishLogin(request, env, {
    provider = 'github', fetcher = fetch, now = Date.now(), accounts,
}) {
    const [expected, secret, next, started = 'github'] = readCookie(request, STATE_COOKIE)?.split('.') ?? [];
    const { origin } = new URL(request.url);
    const page = next === 'account' ? `${origin}/login` : `${origin}/login?next=playground`;
    const done = (location, cookies = []) => redirect(location, [clearCookie(STATE_COOKIE), ...cookies]);
    const back = (result) => done(`${page}#login=${result}`);
    const params = new URL(request.url).searchParams;
    if (params.get('error')) return back('cancelled');
    const state = params.get('state');
    if (!state || state !== expected || !secret || started !== provider) return back('failed');
    try {
        const { identity, failure } = await PROVIDERS[provider].identity(env, {
            code: params.get('code') ?? '', secret, redirectUri: callbackUrl(request, provider), fetcher, now,
        });
        if (failure) return back(failure);
        const { user, freeFrom } = await accounts.signIn(identity);
        if (freeFrom) return done(page, [noticeCookie({ said: 'held', provider, day: freeFrom })]);
        if (user.blocked) {
            log({ event: 'blocked-sign-in', who: userKey(user.id) });
            return back('blocked');
        }
        const session = await signSession({ id: user.id, name: nameOf(user) }, env.SESSION_SECRET, now);
        const target = next === 'account' ? page : env.PLAYGROUND_URL;
        return done(`${target}#login=ok`, [sessionCookie(SESSION_COOKIE, session, SESSION_TTL_MS / 1000)]);
    } catch (error) {
        log({ event: 'login-failed', provider, message: error.message });
        return back('failed');
    }
}

// The CLI's sign-in (RFC 8628): GitHub shows the user a page to enter the code on, and this API, not the CLI, asks
// GitHub for the outcome, so no GitHub token ever leaves it.
export async function requestDeviceCode(env, fetcher = fetch) {
    const code = await json(await post(fetcher, DEVICE_CODE_URL, { client_id: env.GITHUB_CLIENT_ID }));
    if (typeof code.device_code !== 'string' || typeof code.user_code !== 'string' || URL.parse(code.verification_uri)?.origin !== GITHUB_ORIGIN) {
        throw new LoginFailed('GitHub sent no usable device code');
    }
    return {
        deviceCode: code.device_code, userCode: code.user_code, verificationUri: code.verification_uri, expiresIn: code.expires_in, interval: code.interval,
    };
}

export async function pollDeviceCode(deviceCode, env, { fetcher = fetch, now = Date.now() } = {}) {
    const answer = await json(await post(fetcher, TOKEN_URL, { client_id: env.GITHUB_CLIENT_ID, device_code: deviceCode, grant_type: DEVICE_GRANT }));
    if (answer.error === 'authorization_pending') return { pending: true };
    if (answer.error === 'slow_down') return Number.isFinite(answer.interval) ? { pending: true, interval: answer.interval } : { pending: true };
    if (answer.error) {
        if (!DEVICE_OUTCOMES[answer.error]) log({ event: 'device-login-failed', error: answer.error });
        return { failure: DEVICE_OUTCOMES[answer.error] ?? 'failed' };
    }
    if (typeof answer.access_token !== 'string') throw new LoginFailed('GitHub sent no access token');
    return githubIdentity(answer.access_token, env, fetcher, now);
}
