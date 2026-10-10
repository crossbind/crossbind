import { ACCOUNT_BLOCKED, userKey } from './accounts.js';
import {
    BodyTooLarge, SECURITY_HEADERS, bearerToken, jsonResponse, log, readLimited,
} from './http.js';
import {
    isDeviceLoginConfigured, minAccountDays, pollDeviceCode, requestDeviceCode,
} from './oauth.js';

// The API of `crossbind login`, `logout` and `usage`, under /v1. No browser calls it: it sends no CORS headers and
// reads no cookies, only the token in the Authorization header.

const MAX_BODY_BYTES = 1024;
const MAX_DEVICE_CODE_LENGTH = 128;

const now = (deps) => (deps.now ?? Date.now)();
const noContent = () => new Response(null, { status: 204, headers: SECURITY_HEADERS });

function githubUnreachable(error) {
    log({ event: 'github-unreachable', message: error.message });
    return jsonResponse(502, { error: 'GitHub cannot be reached right now; try again in a moment.' });
}

const failures = (env) => ({
    expired: [410, 'The code expired before it was entered; run crossbind login again.'],
    cancelled: [403, 'Signing in was cancelled on GitHub.'],
    'too-new': [403, `This GitHub account is too new; accounts can sign in ${minAccountDays(env)} days after they were created.`],
    failed: [400, 'GitHub did not confirm the sign-in; run crossbind login again.'],
});

// Each start makes GitHub a new code; polling one costs nothing extra, so only starting is held to a tighter rate.
async function deviceRoute({ env, deps, network }) {
    if (!isDeviceLoginConfigured(env)) return jsonResponse(503, { error: 'Signing in with GitHub is not set up.' });
    if (!(await deps.limits.login.limit({ key: network })).success) return jsonResponse(429, { error: 'Too many sign-ins from this network; try again in a minute.' });
    try {
        return jsonResponse(200, await requestDeviceCode(env, deps.fetcher));
    } catch (error) {
        return githubUnreachable(error);
    }
}

async function readDeviceCode(request) {
    try {
        const { deviceCode } = JSON.parse(await readLimited(request, MAX_BODY_BYTES)) ?? {};
        if (typeof deviceCode === 'string' && deviceCode.length > 0 && deviceCode.length <= MAX_DEVICE_CODE_LENGTH) return { deviceCode };
    } catch (error) {
        if (error instanceof BodyTooLarge) return { error: jsonResponse(413, { error: `The body is over ${MAX_BODY_BYTES} bytes.` }) };
        if (!(error instanceof SyntaxError)) throw error;
    }
    return { error: jsonResponse(400, { error: 'Send {"deviceCode"} from POST /v1/login/device.' }) };
}

// The CLI polls this until the user has entered the code on GitHub; 202 means not yet.
async function tokenRoute({ request, env, deps }) {
    if (!isDeviceLoginConfigured(env)) return jsonResponse(503, { error: 'Signing in with GitHub is not set up.' });
    const { deviceCode, error } = await readDeviceCode(request);
    if (error) return error;
    let outcome;
    try {
        outcome = await pollDeviceCode(deviceCode, env, { fetcher: deps.fetcher, now: now(deps) });
    } catch (failure) {
        return githubUnreachable(failure);
    }
    if (outcome.pending) return jsonResponse(202, outcome);
    if (outcome.failure) {
        const [status, message] = failures(env)[outcome.failure];
        return jsonResponse(status, { error: message });
    }
    const user = await deps.accounts.signIn(outcome.account);
    if (user.blocked) {
        log({ event: 'blocked-sign-in', who: userKey(user.id) });
        return jsonResponse(403, { error: ACCOUNT_BLOCKED });
    }
    log({ event: 'cli-login', who: userKey(user.id) });
    return jsonResponse(200, { token: await deps.accounts.issueToken(user.id), login: user.login });
}

async function usageRoute({ deps, settings }, user) {
    const month = new Date(now(deps)).toISOString().slice(0, 7);
    const byImage = await deps.accounts.buildSeconds(user.id, month);
    return jsonResponse(200, {
        login: user.login,
        builds: {
            month, limitSeconds: settings.buildSecondsMonthly, usedSeconds: Object.values(byImage).reduce((sum, seconds) => sum + seconds, 0), byImage,
        },
        playground: { limit: settings.userDaily, remaining: await deps.quota.remaining({ key: userKey(user.id), limit: settings.userDaily }) },
    });
}

// The account a request's token belongs to, or the answer to give instead; the runners use it too.
export async function authenticate(request, accounts, { allowBlocked = false } = {}) {
    const token = bearerToken(request);
    const user = await accounts.userOfToken(token);
    if (!user) return { answer: jsonResponse(401, { error: 'Sign in with crossbind login.' }, { 'www-authenticate': 'Bearer' }) };
    if (user.blocked && !allowBlocked) return { answer: jsonResponse(403, { error: ACCOUNT_BLOCKED }) };
    return { user, token };
}

const authenticated = (route, options) => async (context) => {
    const { user, token, answer } = await authenticate(context.request, context.deps.accounts, options);
    return answer ?? route(context, user, token);
};

const ROUTES = Object.freeze({
    'POST /v1/login/device': deviceRoute,
    'POST /v1/login/token': tokenRoute,
    'GET /v1/usage': authenticated(usageRoute),
    'DELETE /v1/token': authenticated(async ({ deps }, user, token) => {
        await deps.accounts.revokeToken(token);
        log({ event: 'token-revoked', who: userKey(user.id), all: false });
        return noContent();
    }),
    'DELETE /v1/tokens': authenticated(async ({ deps }, user) => {
        await deps.accounts.revokeTokens(user.id);
        log({ event: 'token-revoked', who: userKey(user.id), all: true });
        return noContent();
    }),
    // A blocked account may delete itself too; what stays of it keeps the block (worker/accounts.js).
    'DELETE /v1/account': authenticated(async ({ deps }, user) => {
        await deps.accounts.deleteAccount(user.id);
        log({ event: 'account-deleted', who: userKey(user.id) });
        return noContent();
    }, { allowBlocked: true }),
});

// context: the request, env, deps, settings and caller's network of worker/api.js.
export function handleAccountRequest(context) {
    const route = ROUTES[`${context.request.method} ${new URL(context.request.url).pathname}`];
    return route ? route(context) : jsonResponse(404, { error: 'Not found.' });
}
