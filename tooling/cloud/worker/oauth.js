import { userKey } from './accounts.js';
import { log } from './http.js';
import {
    signSession, sessionCookie, clearCookie, readCookie, randomToken, SESSION_COOKIE, SESSION_TTL_MS,
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
async function githubAccount(accessToken, env, fetcher, now) {
    const user = await json(await fetcher(USER_URL, {
        headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'crossbind-cloud' },
    }));
    if (!Number.isSafeInteger(user.id) || typeof user.login !== 'string') throw new LoginFailed('GitHub sent no user');
    if (!(now - Date.parse(user.created_at) >= minAccountDays(env) * DAY_MS)) return { failure: 'too-new' };
    return { account: { id: String(user.id), login: user.login.slice(0, MAX_NAME_LENGTH) } };
}

const callbackUrl = (request) => `${new URL(request.url).origin}/playground/callback/github`;

function redirect(location, cookies) {
    const headers = new Headers({ location, 'cache-control': 'no-store' });
    cookies.forEach((cookie) => headers.append('set-cookie', cookie));
    return new Response(null, { status: 302, headers });
}

export function startLogin(request, env) {
    if (!isLoginConfigured(env)) return Response.json({ error: 'Signing in with GitHub is not set up.' }, { status: 503 });
    const state = randomToken();
    const url = new URL(AUTHORIZE_URL);
    Object.entries({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: callbackUrl(request), state }).forEach(([key, value]) => url.searchParams.set(key, value));
    return redirect(url.href, [sessionCookie(STATE_COOKIE, state, STATE_TTL_SECONDS)]);
}

// Always returns to the configured playground page, never to an address the request names.
export async function finishLogin(request, env, { fetcher = fetch, now = Date.now(), accounts }) {
    const back = (result, cookies = []) => redirect(`${env.PLAYGROUND_URL}#login=${result}`, [clearCookie(STATE_COOKIE), ...cookies]);
    const params = new URL(request.url).searchParams;
    if (params.get('error')) return back('cancelled');
    const state = params.get('state');
    if (!state || readCookie(request, STATE_COOKIE) !== state) return back('failed');
    try {
        const token = await json(await post(fetcher, TOKEN_URL, {
            client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code: params.get('code') ?? '', redirect_uri: callbackUrl(request),
        }));
        if (typeof token.access_token !== 'string') throw new LoginFailed('GitHub sent no access token');
        const { account, failure } = await githubAccount(token.access_token, env, fetcher, now);
        if (failure) return back(failure);
        if ((await accounts.signIn(account)).blocked) {
            log({ event: 'blocked-sign-in', who: userKey(account.id) });
            return back('blocked');
        }
        const session = await signSession({ id: account.id, name: account.login }, env.SESSION_SECRET, now);
        return back('ok', [sessionCookie(SESSION_COOKIE, session, SESSION_TTL_MS / 1000)]);
    } catch (error) {
        log({ event: 'login-failed', message: error.message });
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
    return githubAccount(answer.access_token, env, fetcher, now);
}
