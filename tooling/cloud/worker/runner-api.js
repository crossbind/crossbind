import { authenticate } from './account-api.js';
import { userKey } from './accounts.js';
import { bearerToken, jsonResponse, log } from './http.js';

// /runner/<image>/v1/*: crossbind cloud's runners, one per user and toolchain image (worker/runner.js), for builds
// under RUNNER=REMOTE signed in with `crossbind login`. The caller's token stays here; the runner learns whose
// build it is from USER_HEADER, which only this Worker can set.

export const RUNNER_IMAGES = Object.freeze(['web', 'android', 'linux', 'windows']);
export const USER_HEADER = 'x-crossbind-user';
// A runner stops this long after its last request: the next step of a build finds it up, and the wait counts against
// the user's month.
export const RUNNER_IDLE_SECONDS = 60;
// All the runner protocol needs of the caller's request besides its method, path and body.
const FORWARDED_HEADERS = Object.freeze(['content-type', 'content-range', 'x-crossbind-upload']);
// A build makes several requests a step. A token found valid this recently skips the D1 read and is held to the
// runners' rate; any other is held to the general rate first, so made-up tokens cannot spend D1 reads at the
// runners' rate. A revoked or blocked account keeps its token at most this long, and its runner stops within a minute.
const RECENT_TOKEN_MS = 30 * 1000;
const MAX_RECENT_TOKENS = 1000;

const tooMany = () => jsonResponse(429, { error: 'Too many requests from this network; try again in a minute.' });

function remember(recentTokens, token, entry) {
    if (recentTokens.size >= MAX_RECENT_TOKENS) recentTokens.delete(recentTokens.keys().next().value);
    recentTokens.set(token, entry);
}

async function callerOf({ request, deps, network }) {
    const token = bearerToken(request);
    const now = (deps.now ?? Date.now)();
    const recent = token && deps.recentTokens?.get(token);
    if (recent && recent.until > now) {
        return (await deps.limits.runner.limit({ key: network })).success ? { user: recent.user } : { answer: tooMany() };
    }
    if (!(await deps.limits.api.limit({ key: network })).success) return { answer: tooMany() };
    const { user, answer } = await authenticate(request, deps.accounts);
    if (user && deps.recentTokens) remember(deps.recentTokens, token, { user, until: now + RECENT_TOKEN_MS });
    return { user, answer };
}

export async function handleRunnerRequest(context) {
    const { request, deps, settings } = context;
    const { pathname, search } = new URL(request.url);
    const [, , image, ...rest] = pathname.split('/');
    const route = `/${rest.join('/')}`;
    if (!RUNNER_IMAGES.includes(image) || !route.startsWith('/v1/')) return jsonResponse(404, { error: 'Not found.' });
    if (!settings.cloudBuildsEnabled) {
        return jsonResponse(503, { error: 'crossbind cloud builds are paused; build with CROSSBIND_RUNNER=DOCKER_RUN meanwhile.' });
    }
    const { user, answer } = await callerOf(context);
    if (answer) return answer;
    const headers = new Headers(FORWARDED_HEADERS.filter((name) => request.headers.has(name)).map((name) => [name, request.headers.get(name)]));
    headers.set(USER_HEADER, user.id);
    const hasBody = !['GET', 'HEAD'].includes(request.method);
    try {
        return await deps.runner(image, user.id).fetch(new Request(`http://runner${route}${search}`, {
            method: request.method, headers, body: hasBody ? request.body : undefined, duplex: 'half',
        }));
    } catch (error) {
        log({
            event: 'runner-unreachable', who: userKey(user.id), image, message: error.message,
        });
        return jsonResponse(502, { error: 'crossbind cloud could not reach your runner; try again in a moment.' });
    }
}
