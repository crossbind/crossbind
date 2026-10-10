import {
    CREDENTIALS_FILE, cloudCredentials, readCredentials, writeCredentials,
} from '../utils/cloudAccount.js';

// `crossbind login`, `logout` and `usage`, against tooling/cloud/worker/account-api.js.

const GITHUB_ORIGIN = 'https://github.com';
const TOKEN_PATTERN = /^cbt_[A-Za-z0-9_-]{43}$/;
const MAX_NAME_LENGTH = 64;
// GitHub's defaults for a device code; it asks for no faster polling than this.
const MIN_INTERVAL_SECONDS = 5;
const DEFAULT_EXPIRES_SECONDS = 900;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
// What the cloud sends ends up on the terminal: no escape sequences.
const printable = (value) => String(value ?? '').replace(/\p{Cc}/gu, '');
const paceOf = (seconds, fallback) => Math.max(MIN_INTERVAL_SECONDS, Number.isFinite(seconds) ? seconds : fallback);

async function call(fetcher, url, route, { method = 'GET', token, body } = {}) {
    let response;
    try {
        // A redirect would carry the token to an address nobody configured.
        response = await fetcher(`${url}${route}`, {
            method,
            headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
            body: body && JSON.stringify(body),
            redirect: 'error',
        });
    } catch (error) {
        throw new Error(`crossbind: crossbind cloud at ${url} is unreachable (${error.cause?.code ?? error.message}).`, { cause: error });
    }
    const answer = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body: answer !== null && typeof answer === 'object' ? answer : {} };
}

const refused = ({ status, body }) => new Error(`crossbind: ${printable(body.error ?? `crossbind cloud answered ${status}.`)}`);

// { revoked: true }, or { revoked: false, reason }.
async function revoke(fetcher, url, token, all) {
    try {
        const answer = await call(fetcher, url, all ? '/v1/tokens' : '/v1/token', { method: 'DELETE', token });
        // 401: the cloud no longer knows this token, so there is nothing left to revoke, unless every token was asked for.
        return answer.ok || (!all && answer.status === 401) ? { revoked: true } : { revoked: false, reason: refused(answer).message };
    } catch (error) {
        return { revoked: false, reason: error.message };
    }
}

// GitHub's device flow: the user approves a code on github.com while this polls crossbind cloud, which asks GitHub.
export async function login({
    url, file = CREDENTIALS_FILE, fetcher = fetch, sleep = wait, now = Date.now, print = console.log,
}) {
    const device = await call(fetcher, url, '/v1/login/device', { method: 'POST' });
    if (!device.ok) throw refused(device);
    const { deviceCode, userCode, verificationUri } = device.body;
    if (URL.parse(verificationUri)?.origin !== GITHUB_ORIGIN || typeof userCode !== 'string') {
        throw new Error('crossbind: crossbind cloud sent a sign-in page that is not on github.com.');
    }
    print(`crossbind: open ${printable(verificationUri)} and enter the code ${printable(userCode)} to sign in with GitHub.`);
    let pace = paceOf(device.body.interval, MIN_INTERVAL_SECONDS);
    const deadline = now() + (device.body.expiresIn ?? DEFAULT_EXPIRES_SECONDS) * 1000;
    while (now() < deadline) {
        await sleep(pace * 1000);
        const answer = await call(fetcher, url, '/v1/login/token', { method: 'POST', body: { deviceCode } });
        if (answer.status === 202) {
            pace = paceOf(answer.body.interval, pace);
        } else {
            if (!answer.ok) throw refused(answer);
            const { token } = answer.body;
            if (!TOKEN_PATTERN.test(token ?? '')) throw new Error('crossbind: crossbind cloud sent no usable token.');
            const name = printable(answer.body.login).slice(0, MAX_NAME_LENGTH);
            const previous = cloudCredentials(url, file);
            writeCredentials({ ...readCredentials(file), [url]: { token, login: name } }, file);
            if (previous && previous.token !== token) {
                const outcome = await revoke(fetcher, url, previous.token, false);
                if (!outcome.revoked) print(`crossbind: the token this sign-in replaces still works (${outcome.reason.replace(/^crossbind: /, '')}); crossbind logout --all revokes it.`);
            }
            return { login: name };
        }
    }
    throw new Error('crossbind: the code expired before it was entered; run crossbind login again.');
}

// Forgets the token here whatever the cloud answers; `revoked` says whether the cloud dropped it too.
export async function logout({
    url, all = false, file = CREDENTIALS_FILE, fetcher = fetch,
}) {
    const { [url]: entry, ...rest } = readCredentials(file);
    if (!entry) return null;
    const outcome = await revoke(fetcher, url, entry.token, all);
    writeCredentials(rest, file);
    return { login: entry.login, ...outcome };
}

// The account, with the sign-in of every machine; the sign-in here is forgotten only once the cloud confirms.
export async function deleteAccount({ url, file = CREDENTIALS_FILE, fetcher = fetch }) {
    const { [url]: entry, ...rest } = readCredentials(file);
    if (!entry) throw new Error(`crossbind: not signed in to ${url}; run crossbind login first.`);
    const answer = await call(fetcher, url, '/v1/account', { method: 'DELETE', token: entry.token });
    if (answer.status === 401) throw new Error('crossbind: this sign-in is no longer valid; run crossbind login, then delete the account.');
    if (!answer.ok) throw refused(answer);
    writeCredentials(rest, file);
    return { login: entry.login };
}

export async function fetchUsage({ url, file = CREDENTIALS_FILE, fetcher = fetch }) {
    const entry = cloudCredentials(url, file);
    if (!entry) throw new Error(`crossbind: not signed in to ${url}; run crossbind login.`);
    const answer = await call(fetcher, url, '/v1/usage', { token: entry.token });
    if (answer.status === 401) throw new Error('crossbind: this sign-in is no longer valid; run crossbind login.');
    if (!answer.ok) throw refused(answer);
    return answer.body;
}

function formatSeconds(seconds) {
    const whole = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(whole / 60);
    const rest = whole % 60;
    if (minutes === 0) return `${rest}s`;
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export function usageLines({ login: name, builds, playground }) {
    const images = Object.entries(builds.byImage).sort(([, a], [, b]) => b - a);
    const column = Math.max(...images.map(([image]) => image.length)) + 3;
    const left = builds.limitSeconds - builds.usedSeconds;
    return [
        `Signed in as ${printable(name)}.`,
        `Cloud builds in ${printable(builds.month)}: ${formatSeconds(builds.usedSeconds)} of ${formatSeconds(builds.limitSeconds)} used, ${formatSeconds(left)} left.`,
        ...images.map(([image, seconds]) => `  ${printable(image).padEnd(column)}${formatSeconds(seconds)}`),
        `Playground: ${playground.remaining} of ${playground.limit} compiles left today.`,
    ];
}
