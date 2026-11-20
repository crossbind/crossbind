import { askLine, hasTerminal } from '../utils/ask.js';
import {
    CREDENTIALS_FILE, cloudCredentials, readCredentials, writeCredentials,
} from '../utils/cloudAccount.js';

// `crossbind login`, `logout` and `usage`, against tooling/cloud/worker/account-api.js.

const TOKEN_PATTERN = /^cbt_[A-Za-z0-9_-]{43}$/;
const MAX_NAME_LENGTH = 64;
// The cloud's defaults for a device's sign-in; it asks for no faster polling than this, and a device told to slow
// down waits five seconds more (RFC 8628 3.5).
const MIN_INTERVAL_SECONDS = 5;
const SLOW_DOWN_SECONDS = 5;
const DEFAULT_EXPIRES_SECONDS = 600;
const NUMBER_QUESTION = 'crossbind: once you approve, the page shows a number: type it here (one try): ';
// The number the device page shows: two digits, 10 to 99.
const NUMBER = /^\s*([1-9]\d)\s*$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_NAMES = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

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

// The device sign-in's routes answer as RFC 8628 has it, the words in `error_description`; the others in `error`.
const refused = ({ status, body }) => new Error(`crossbind: ${printable(body.error_description ?? body.error ?? `crossbind cloud answered ${status}.`)}`);

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

// The number the device page shows, typed once: anything but two digits is asked again, so that a slip of the keyboard
// spends no try.
async function askNumber(ask) {
    for (let question = NUMBER_QUESTION; ; question = 'crossbind: type the two digits the page shows: ') {
        const typed = NUMBER.exec(await ask(question));
        if (typed) return Number(typed[1]);
    }
}

// The token a sign-in gave, kept for this cloud address alone; the one it replaces is revoked.
async function keep(answer, { url, file, fetcher, print }) {
    const { access_token: token, account } = answer.body;
    if (!TOKEN_PATTERN.test(token ?? '')) throw new Error('crossbind: crossbind cloud sent no usable token.');
    const name = printable(account?.name).slice(0, MAX_NAME_LENGTH);
    const previous = cloudCredentials(url, file);
    writeCredentials({ ...readCredentials(file), [url]: { token, login: name } }, file);
    if (previous && previous.token !== token) {
        const outcome = await revoke(fetcher, url, previous.token, false);
        if (!outcome.revoked) print(`crossbind: the token this sign-in replaces still works (${outcome.reason.replace(/^crossbind: /, '')}); crossbind logout --all revokes it.`);
    }
    return { login: name };
}

// crossbind's own device sign-in: the user enters a code on the cloud's device page, signed in there with GitHub or
// Apple, approves it, and types here the number that page shows, which gets one try. The page must be the cloud's own,
// on the origin this asks.
export async function login({
    url, version, file = CREDENTIALS_FILE, fetcher = fetch, sleep = wait, now = Date.now, print = console.log, ask = askLine, isTerminal = hasTerminal,
}) {
    if (!isTerminal()) throw new Error('crossbind: crossbind login asks for a number: run it in a terminal.');
    const device = await call(fetcher, url, '/v1/device/authorize', { method: 'POST', body: { client: 'cli', version } });
    if (!device.ok) throw refused(device);
    const { device_code: deviceCode, user_code: userCode, verification_uri: page } = device.body;
    if (URL.parse(page)?.origin !== url || typeof userCode !== 'string' || typeof deviceCode !== 'string') {
        throw new Error(`crossbind: crossbind cloud sent a sign-in page that is not its own, at ${url}.`);
    }
    print(`crossbind: open ${printable(page)} and enter the code ${printable(userCode)} to sign in with GitHub or Apple.`);
    let pace = paceOf(device.body.interval, MIN_INTERVAL_SECONDS);
    const deadline = now() + (device.body.expires_in ?? DEFAULT_EXPIRES_SECONDS) * 1000;
    let match;
    // Polls at the pace asked until the code is approved; the number is then sent at once, after its question.
    for (let waits = true; now() < deadline;) {
        if (waits) await sleep(pace * 1000);
        const answer = await call(fetcher, url, '/v1/device/token', { method: 'POST', body: match === undefined ? { device_code: deviceCode } : { device_code: deviceCode, match } });
        if (answer.ok) return keep(answer, { url, file, fetcher, print });
        const { error } = answer.body;
        if (error === 'matching_required' && match === undefined) {
            match = await askNumber(ask);
            waits = false;
        } else if (error === 'authorization_pending' || error === 'slow_down') {
            if (error === 'slow_down') pace += SLOW_DOWN_SECONDS;
            waits = true;
        } else {
            throw refused(answer);
        }
    }
    throw new Error('crossbind: the code expired before it was approved; run crossbind login again.');
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

// 2026-12-20 as "20 December 2026", as the cloud words its days.
function dayWords(day) {
    const [, year, month, date] = DAY.exec(day);
    return `${Number(date)} ${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

// A new account's builds open on `opensOn`: one made with an Apple ID, before it links a GitHub account.
export function usageLines({ login: name, builds, playground }) {
    const images = Object.entries(builds.byImage).sort(([, a], [, b]) => b - a);
    const column = Math.max(...images.map(([image]) => image.length)) + 3;
    const left = builds.limitSeconds - builds.usedSeconds;
    return [
        `Signed in as ${printable(name)}.`,
        typeof builds.opensOn === 'string' && DAY.test(builds.opensOn)
            ? `Cloud builds open to this account on ${dayWords(builds.opensOn)}, or as soon as a GitHub account is linked.`
            : `Cloud builds in ${printable(builds.month)}: ${formatSeconds(builds.usedSeconds)} of ${formatSeconds(builds.limitSeconds)} used, ${formatSeconds(left)} left.`,
        ...images.map(([image, seconds]) => `  ${printable(image).padEnd(column)}${formatSeconds(seconds)}`),
        `Playground: ${playground.remaining} of ${playground.limit} compiles left today.`,
    ];
}
