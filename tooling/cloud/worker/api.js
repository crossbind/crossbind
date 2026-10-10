import { validateRequest, InvalidRequest } from '../compiler/validate.js';
import { handleAccountRequest } from './account-api.js';
import { userKey } from './accounts.js';
import {
    BodyTooLarge, SECURITY_HEADERS, jsonResponse, log, networkOf, readLimited,
} from './http.js';
import { startLogin, finishLogin, isLoginConfigured } from './oauth.js';
import { handleRunnerRequest } from './runner-api.js';
import { readSession, clearCookie, SESSION_COOKIE } from './session.js';
import { settingsOf } from './settings.js';

const PREFIX = 'playground';
const MAX_BODY_BYTES = 80 * 1024;
const MAX_TURNSTILE_TOKEN_LENGTH = 2048;
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const CACHE_ORIGIN = 'https://playground-cache.invalid';
const CACHE_SECONDS = 7 * 24 * 3600;
// The compiler caps its outputs well below this (compiler/compile.js OUTPUT_LIMITS).
const MAX_COMPILER_ANSWER_BYTES = 12 * 1024 * 1024;

// Results that the same sources always give again; a timeout depends on the load at the time.
const isCacheable = (result) => result.ok === true || result.reason === 'compile';

function withCors(response, origin) {
    if (!origin) return response;
    const headers = new Headers(response.headers);
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.append('vary', 'Origin');
    return new Response(response.body, { status: response.status, headers });
}

async function verifyTurnstile(token, { secret, ip, hostnames, fetcher }) {
    if (!secret || typeof token !== 'string' || token.length === 0 || token.length > MAX_TURNSTILE_TOKEN_LENGTH) return false;
    const response = await fetcher(SITEVERIFY_URL, { method: 'POST', body: new URLSearchParams({ secret, response: token, remoteip: ip }) });
    if (!response.ok) return false;
    const outcome = await response.json();
    // Cloudflare's test secret, staging's, answers for example.com and with no action; only a test secret answers so.
    const isTestAnswer = outcome.metadata?.result_with_testing_key === true;
    return outcome.success === true && (outcome.action === 'compile' || isTestAnswer) && hostnames.includes(outcome.hostname);
}

async function cacheUrl(version, files) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([version, files['native.h'], files['native.cpp']])));
    return `${CACHE_ORIGIN}/${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function callerOf({
    request, env, settings, ip, network,
}) {
    const user = await readSession(request, env.SESSION_SECRET);
    return {
        user,
        ip,
        key: user ? userKey(user.id) : `ip:${network}`,
        limit: user ? settings.userDaily : settings.anonymousDaily,
    };
}

async function readCompileBody(request, respond) {
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return { error: respond(415, { error: 'Send JSON.' }) };
    try {
        const body = JSON.parse(await readLimited(request, MAX_BODY_BYTES));
        return { files: validateRequest({ files: body?.files }), turnstile: body?.turnstile };
    } catch (error) {
        if (error instanceof BodyTooLarge) return { error: respond(413, { error: `The body is over ${MAX_BODY_BYTES} bytes.` }) };
        if (error instanceof SyntaxError) return { error: respond(400, { error: 'The body is not JSON.' }) };
        if (error instanceof InvalidRequest) return { error: respond(400, { error: error.message }) };
        throw error;
    }
}

async function runCompile({ files, caller, cacheRequest, reservation }, { deps, respond }) {
    let response;
    try {
        response = await deps.compiler.fetch(new Request('http://compiler/compile', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files }),
        }));
    } catch (error) {
        // The container went away during the compile, which the compile itself may have caused: it stays counted.
        log({ event: 'compiler-lost', who: caller.key, message: error.message });
        return respond(503, { error: 'The compiler is restarting; try again in a moment.' });
    }
    if (response.status === 503) {
        // Turned away before it started (busy, or the container not up yet): the compile is given back.
        await deps.quota.refund({ key: caller.key });
        return respond(503, { error: 'The compiler is busy; try again in a moment.' });
    }
    const failed = (event) => {
        log({ ...event, who: caller.key });
        return respond(502, { error: 'The compiler failed; try again later.' });
    };
    if (!response.ok) return failed({ event: 'compiler-error', status: response.status });
    if (Number(response.headers.get('content-length')) > MAX_COMPILER_ANSWER_BYTES) return failed({ event: 'compiler-answer-too-large' });
    let result;
    try {
        result = await response.json();
    } catch (error) {
        return failed({ event: 'compiler-answer-unreadable', message: error.message });
    }
    log({ event: 'compile', who: caller.key, ok: result.ok, reason: result.reason, ms: result.ms });
    if (isCacheable(result)) {
        deps.waitUntil(deps.cache?.put(cacheRequest, Response.json(result, { headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` } })));
    }
    return respond(200, { ...result, remaining: reservation.remaining });
}

// Cheap checks first: nothing reaches the browser check, the quota or the compiler before the body is sound.
async function compileRoute(context) {
    const { request, env, deps, settings, corsOrigin, respond } = context;
    if (!settings.enabled) return respond(503, { error: 'The playground is paused; the examples on this page still run.' });
    if (!corsOrigin) return respond(403, { error: 'Compiles are accepted from the playground page only.' });
    const { files, turnstile, error } = await readCompileBody(request, respond);
    if (error) return error;
    const caller = await callerOf(context);
    // Accounts are blocked in D1; a blocked network still compiles for whoever signs in, who can be blocked in turn.
    const standing = caller.user ? await deps.accounts.standing(caller.user.id) : { exists: true, blocked: settings.blockedNetworks.has(context.network) };
    if (!standing.exists) return respond(401, { error: 'This account was deleted; sign in again to make a new one.', login: true });
    if (standing.blocked) return respond(403, { error: 'This account or network may not compile here.' });
    if (!caller.user && !(await verifyTurnstile(turnstile, { secret: env.TURNSTILE_SECRET, ip: caller.ip, hostnames: settings.turnstileHostnames, fetcher: deps.fetcher }))) {
        return respond(403, { error: 'The browser check did not pass; reload the page and try again.', turnstile: true });
    }
    const cacheRequest = new Request(await cacheUrl(settings.compilerVersion, files));
    const cached = await deps.cache?.match(cacheRequest);
    if (cached) return respond(200, { ...(await cached.json()), cached: true, remaining: await deps.quota.remaining({ key: caller.key, limit: caller.limit }) });
    const reservation = await deps.quota.reserve({ key: caller.key, limit: caller.limit, globalLimit: settings.globalDaily });
    if (!reservation.ok) {
        const ownLimit = reservation.reason === 'quota';
        return respond(429, {
            error: ownLimit ? `That was today's last compile (${caller.limit} a day).` : 'The playground has run out of compiles for today; it opens again tomorrow.',
            reason: reservation.reason,
            login: ownLimit && !caller.user,
        });
    }
    return runCompile({ files, caller, cacheRequest, reservation }, context);
}

async function sessionRoute(context) {
    const {
        env, deps, settings, respond,
    } = context;
    const caller = await callerOf(context);
    return respond(200, {
        enabled: settings.enabled,
        user: caller.user ? { name: caller.user.name } : null,
        limit: caller.limit,
        remaining: await deps.quota.remaining({ key: caller.key, limit: caller.limit }),
        canSignIn: isLoginConfigured(env),
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
    });
}

const signedOut = (corsOrigin) => withCors(new Response(null, { status: 204, headers: { ...SECURITY_HEADERS, 'set-cookie': clearCookie(SESSION_COOKIE) } }), corsOrigin);

function logoutRoute({ corsOrigin, respond }) {
    if (!corsOrigin) return respond(403, { error: 'Sign out from the playground page.' });
    return signedOut(corsOrigin);
}

// The same account `crossbind account delete` deletes: the CLI's tokens go with it.
async function deleteAccountRoute({
    request, env, deps, corsOrigin, respond,
}) {
    if (!corsOrigin) return respond(403, { error: 'Delete your account from the playground page.' });
    const user = await readSession(request, env.SESSION_SECRET);
    if (!user) return respond(401, { error: 'Sign in to delete your account.' });
    await deps.accounts.deleteAccount(user.id);
    log({ event: 'account-deleted', who: userKey(user.id) });
    return signedOut(corsOrigin);
}

function preflight({ corsOrigin }) {
    if (!corsOrigin) return new Response(null, { status: 403, headers: SECURITY_HEADERS });
    return withCors(new Response(null, {
        status: 204,
        headers: { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' },
    }), corsOrigin);
}

const PLAYGROUND_ROUTES = Object.freeze({
    'GET /session': sessionRoute,
    'POST /compile': compileRoute,
    'POST /logout': logoutRoute,
    'POST /delete-account': deleteAccountRoute,
    'GET /login/github': ({ request, env }) => startLogin(request, env),
    'GET /callback/github': ({ request, env, deps }) => finishLogin(request, env, { fetcher: deps.fetcher, accounts: deps.accounts }),
});

// deps: the rate limiters, the accounts, the quota and compiler Durable Object stubs, the cache, fetch and
// waitUntil, so tests can stand in for them.
export async function handleRequest(request, env, deps) {
    const settings = settingsOf(env);
    const { pathname } = new URL(request.url);
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    const network = networkOf(ip);
    const origin = request.headers.get('origin');
    const corsOrigin = origin !== null && settings.origins.includes(origin) ? origin : null;
    const respond = (status, body) => withCors(jsonResponse(status, body), corsOrigin);
    const context = {
        request, env, deps, settings, corsOrigin, respond, ip, network,
    };
    // A build talks to its runner far more often than a person to the rest; worker/runner-api.js picks its limiter.
    if (pathname.startsWith('/runner/')) return handleRunnerRequest(context);
    // Before anything that costs: a session, an account, the quota, GitHub or the compiler.
    if (!(await deps.limits.api.limit({ key: network })).success) return respond(429, { error: 'Too many requests from this network; try again in a minute.' });
    if (pathname.startsWith('/v1/')) return handleAccountRequest(context);
    if (!pathname.startsWith(`/${PREFIX}/`)) return respond(404, { error: 'Not found.' });
    if (request.method === 'OPTIONS') return preflight(context);
    const route = PLAYGROUND_ROUTES[`${request.method} ${pathname.slice(PREFIX.length + 1)}`];
    return route ? route(context) : respond(404, { error: 'Not found.' });
}
