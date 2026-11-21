import {
    ACCOUNT_BLOCKED, buildsOpenOn, dayWords, hashOf, nameOf, userKey,
} from './accounts.js';
import {
    countryOf, deviceLabel, shownCode, DEVICE_CODE_SECONDS, MATCH_FROM, MATCH_TO, POLL_SECONDS, STARTS_PER_MINUTE,
} from './devices.js';
import {
    BodyTooLarge, SECURITY_HEADERS, bearerToken, jsonResponse, log, readLimited,
} from './http.js';
import {
    isDeviceLoginConfigured, minAccountDays, pollDeviceCode, requestDeviceCode, signInProviders,
} from './oauth.js';
import { devSessionOf, isSessionId, MAX_SESSIONS_PER_ACCOUNT } from './project-sessions.js';
import { deleteAccountWithSnapshots, startSnapshotRoute, uploadSnapshotRoute } from './snapshots.js';

// The API of `crossbind login`, `logout`, `usage` and `app preview`, of the crossbind app, and the account's own, under
// /v1. No browser calls it: it sends no CORS headers and reads no cookies, only the token in the Authorization header.

const MAX_BODY_BYTES = 1024;
const MAX_DEVICE_CODE_LENGTH = 128;
const DEVICE_CODE = /^[A-Za-z0-9_-]{43}$/;
// The key of everyone's starts at a Cloudflare location: one key, so that a flood reaches the quota's exact count at a
// bounded rate from each location.
const EVERYONE = 'everyone';
// RFC 8628 3.5's errors of a device's poll, in words a device can show.
const POLL_WORDS = Object.freeze({
    invalid_grant: 'No sign-in has this code; start again.',
    expired_token: 'The code expired; start again.',
    authorization_pending: 'The code waits to be approved on the page.',
    access_denied: 'This sign-in was denied or has ended; start again.',
    matching_required: 'The code is approved: send the number the page shows.',
});
const MISMATCH = 'The number did not match, and the code no longer works; start again.';
// The kinds of token a route takes (tokens.kind): builds and usage take the CLI's alone, the account itself any.
const CLI_ONLY = Object.freeze(['cli']);
const EVERY_KIND = Object.freeze(['cli', 'app']);
// Sessions are read by the crossbind app alone, which opens them; the CLI registers and removes them.
const APP_ONLY = Object.freeze(['app']);
const SESSION_PATH = /^\/v1\/sessions\/([^/]+)$/;
const SNAPSHOT_PATH = /^\/v1\/snapshots\/([^/]+)$/;
const NO_SESSION = 'No session of this account has this id.';

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

// `crossbind login` of the releases before the device page: GitHub's device flow, kept for the CLIs installed. Each start
// makes GitHub a new code; polling one costs nothing extra, so only starting is held to a tighter rate.
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
    // An identity crossbind does not know makes its account at once here: this flow has no page to ask on.
    const { user, freeFrom } = await deps.accounts.signIn(outcome.identity);
    if (freeFrom) {
        return jsonResponse(403, {
            error: `This GitHub account was unlinked from a crossbind account this month: it signs in again from ${dayWords(freeFrom)}, and can be linked back to that account now.`,
        });
    }
    if (user.blocked) {
        log({ event: 'blocked-sign-in', who: userKey(user.id) });
        return jsonResponse(403, { error: ACCOUNT_BLOCKED });
    }
    log({ event: 'cli-login', who: userKey(user.id) });
    return jsonResponse(200, { token: await deps.accounts.issueToken(user.id), login: user.login });
}

const oauthError = (status, error, description) => jsonResponse(status, { error, error_description: description });

async function readJson(request) {
    try {
        return JSON.parse(await readLimited(request, MAX_BODY_BYTES));
    } catch (error) {
        if (error instanceof BodyTooLarge || error instanceof SyntaxError) return undefined;
        throw error;
    }
}

// A device starts a sign-in, with no token: the crossbind app or `crossbind login` (worker/devices.js). Ten a minute
// from a network, and STARTS_PER_MINUTE for everyone together, counted exactly in the quota's Durable Object behind a
// limiter of each location's: a flood from many networks holds sign-ins up while it lasts, and writes no rows past it.
async function deviceAuthorizeRoute({
    request, env, deps, network,
}) {
    if (signInProviders(env).length === 0) return oauthError(503, 'temporarily_unavailable', 'Signing in is not set up.');
    if (!(await deps.limits.login.limit({ key: network })).success) return oauthError(429, 'slow_down', 'Too many sign-ins from this network; try again in a minute.');
    const body = await readJson(request);
    const label = deviceLabel(body);
    if (!label) return oauthError(400, 'invalid_request', 'Send {"client": "app", "version", "platform", "os"} or {"client": "cli", "version"}.');
    if (!(await deps.limits.starts.limit({ key: EVERYONE })).success || !(await deps.quota.startSignIn({ limit: STARTS_PER_MINUTE }))) {
        return oauthError(429, 'slow_down', 'Too many sign-ins are starting right now; try again in a minute.');
    }
    const { deviceCode, userCode } = await deps.devices.start({ client: body.client, label, country: countryOf(request) });
    return jsonResponse(200, {
        device_code: deviceCode, user_code: shownCode(userCode), verification_uri: `${new URL(request.url).origin}/device`, expires_in: DEVICE_CODE_SECONDS, interval: POLL_SECONDS,
    });
}

// A device polls for its sign-in (RFC 8628 3.4): pending until its person approves the code on the page; then it sends
// the number that page shows, once, and gets a token of the kind it asked as, which its account's page lists by its label.
async function deviceTokenRoute({ request, deps }) {
    const { device_code: deviceCode, match } = (await readJson(request)) ?? {};
    const matchFits = match === undefined || (Number.isInteger(match) && match >= MATCH_FROM && match <= MATCH_TO);
    if (typeof deviceCode !== 'string' || !DEVICE_CODE.test(deviceCode) || !matchFits) {
        return oauthError(400, 'invalid_request', 'Send {"device_code"}, with "match" once the code is approved.');
    }
    const hash = await hashOf(deviceCode);
    // A poll every five seconds is about twelve a minute; faster is told to slow down, and adds five seconds.
    if (!(await deps.limits.poll.limit({ key: hash })).success) return oauthError(400, 'slow_down', 'Polled too often: wait five seconds more between polls.');
    const found = await deps.devices.poll(hash, match);
    if (found.error) return oauthError(400, found.error, found.mismatch ? MISMATCH : POLL_WORDS[found.error]);
    const standing = await deps.accounts.standing(found.userId);
    if (!standing.exists) return oauthError(400, 'invalid_grant', POLL_WORDS.invalid_grant);
    if (standing.blocked) {
        log({ event: 'blocked-sign-in', who: userKey(found.userId) });
        return oauthError(400, 'access_denied', ACCOUNT_BLOCKED);
    }
    const token = await deps.accounts.issueToken(found.userId, { kind: found.client, label: found.label });
    log({ event: 'device-signed-in', who: userKey(found.userId), kind: found.client });
    return jsonResponse(200, { access_token: token, token_type: 'Bearer', account: { id: found.userId, name: standing.name } });
}

// A new account has no build minutes until `opensOn` (accounts.js buildsOpenOn), and the playground's day of a new one.
async function usageRoute({ env, deps, settings }, user) {
    const at = now(deps);
    const month = new Date(at).toISOString().slice(0, 7);
    const byImage = await deps.accounts.buildSeconds(user.id, month);
    const opensOn = buildsOpenOn(user, minAccountDays(env), at);
    const daily = opensOn ? settings.newAccountDaily : settings.userDaily;
    return jsonResponse(200, {
        login: nameOf(user),
        builds: {
            month,
            limitSeconds: opensOn ? 0 : settings.buildSecondsMonthly,
            usedSeconds: Object.values(byImage).reduce((sum, seconds) => sum + seconds, 0),
            byImage,
            ...(opensOn ? { opensOn } : {}),
        },
        playground: { limit: daily, remaining: await deps.quota.remaining({ key: userKey(user.id), limit: daily }) },
    });
}

// The account a request's token belongs to, or the answer to give instead; the runners use it too. A route takes the
// CLI's tokens alone unless it names the kinds it takes.
export async function authenticate(request, accounts, { allowBlocked = false, kinds = CLI_ONLY } = {}) {
    const token = bearerToken(request);
    const user = await accounts.userOfToken(token);
    if (!user) return { answer: jsonResponse(401, { error: 'Sign in with crossbind login.' }, { 'www-authenticate': 'Bearer' }) };
    if (!kinds.includes(user.kind)) return { answer: jsonResponse(403, { error: 'This token cannot be used here.' }) };
    if (user.blocked && !allowBlocked) return { answer: jsonResponse(403, { error: ACCOUNT_BLOCKED }) };
    return { user, token };
}

const authenticated = (route, options) => async (context) => {
    const { user, token, answer } = await authenticate(context.request, context.deps.accounts, options);
    return answer ?? route(context, user, token);
};

// crossbind app preview registers its dev server's session, and renews it with the same body while it runs.
async function putSessionRoute({ request, deps, sessionId }, user) {
    if (!isSessionId(sessionId)) return jsonResponse(400, { error: 'A session\'s id is 16 random bytes in base64url.' });
    const session = devSessionOf(await readJson(request));
    if (!session) return jsonResponse(400, { error: 'Send {"source": "dev", "project": {"id", "name"}, "addresses", "protocol", "key"}: a dev server at a local address alone.' });
    const registered = await deps.sessions.register(user.id, sessionId, session);
    if (registered.error === 'taken') return jsonResponse(409, { error: 'This session id is in use by another run; make a new one.' });
    if (registered.error === 'full') return jsonResponse(429, { error: `This account has ${MAX_SESSIONS_PER_ACCOUNT} previews running, as many as it may: stop one first.` });
    return jsonResponse(200, { id: sessionId, expiresAt: registered.expiresAt });
}

const SESSION_ROUTES = Object.freeze({
    PUT: authenticated(putSessionRoute),
    DELETE: authenticated(async ({ deps, sessionId }, user) => {
        const removed = isSessionId(sessionId) && await deps.sessions.remove(user.id, sessionId);
        return removed ? noContent() : jsonResponse(404, { error: NO_SESSION });
    }),
    GET: authenticated(async ({ deps, settings, sessionId }, user) => {
        const session = isSessionId(sessionId) ? await deps.sessions.find(user.id, sessionId, { snapshots: settings.snapshotsEnabled }) : null;
        return session ? jsonResponse(200, session) : jsonResponse(404, { error: NO_SESSION });
    }, { kinds: APP_ONLY }),
});

const UPLOAD_ROUTE = authenticated(uploadSnapshotRoute);

const ROUTES = Object.freeze({
    'POST /v1/login/device': deviceRoute,
    'POST /v1/login/token': tokenRoute,
    'POST /v1/device/authorize': deviceAuthorizeRoute,
    'POST /v1/device/token': deviceTokenRoute,
    'GET /v1/usage': authenticated(usageRoute),
    'GET /v1/account': authenticated((context, user) => jsonResponse(200, { id: user.id, name: nameOf(user) }), { kinds: EVERY_KIND }),
    'GET /v1/sessions': authenticated(async ({ deps, settings }, user) => jsonResponse(200, { sessions: await deps.sessions.list(user.id, { snapshots: settings.snapshotsEnabled }) }), { kinds: APP_ONLY }),
    // crossbind app preview --cloud asks for its snapshot's id, then uploads to it (worker/snapshots.js).
    'POST /v1/snapshots': authenticated(startSnapshotRoute),
    // A crossbind app signed out may have read the snapshots' keys: they change (worker/snapshots.js rekey).
    'DELETE /v1/token': authenticated(async ({ deps }, user, token) => {
        await deps.accounts.revokeToken(token);
        if (user.kind === 'app') await deps.snapshots.rekey(user.id);
        log({ event: 'token-revoked', who: userKey(user.id), all: false });
        return noContent();
    }, { kinds: EVERY_KIND }),
    // `crossbind logout --all` does what the account's page does as "Sign out everywhere": the browsers go too.
    'DELETE /v1/tokens': authenticated(async ({ deps }, user) => {
        await deps.accounts.signOutEverywhere(user.id);
        await deps.snapshots.rekey(user.id);
        log({ event: 'token-revoked', who: userKey(user.id), all: true });
        return noContent();
    }, { kinds: EVERY_KIND }),
    // A blocked account may delete itself too; what stays of it keeps the block (worker/accounts.js).
    'DELETE /v1/account': authenticated(async ({ deps }, user) => {
        await deleteAccountWithSnapshots(deps, user.id);
        log({ event: 'account-deleted', who: userKey(user.id) });
        return noContent();
    }, { allowBlocked: true, kinds: EVERY_KIND }),
});

// context: the request, env, deps, settings and caller's network of worker/api.js.
export function handleAccountRequest(context) {
    const { method } = context.request;
    const { pathname } = new URL(context.request.url);
    const session = SESSION_PATH.exec(pathname);
    const snapshot = SNAPSHOT_PATH.exec(pathname);
    let route = ROUTES[`${method} ${pathname}`];
    if (session) route = SESSION_ROUTES[method];
    else if (snapshot) route = method === 'PUT' ? UPLOAD_ROUTE : undefined;
    return route ? route({ ...context, sessionId: (session ?? snapshot)?.[1] }) : jsonResponse(404, { error: 'Not found.' });
}
