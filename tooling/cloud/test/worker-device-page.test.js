import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { createDeviceCodes, MATCH_FROM, MATCH_TO } from '../worker/devices.js';
import { createQuota } from '../worker/quota.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import { APPLE_ENV, codeFor, github } from './support/providers.mjs';

const API = 'https://api.crossbind.dev';
const SITE = 'https://crossbind.dev';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const MINUTE = 60 * 1000;
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_URL: `${SITE}/playground/`,
    ALLOWED_ORIGINS: SITE,
    MIN_GITHUB_ACCOUNT_DAYS: '30',
};
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self' https://github.com https://appleid.apple.com https://crossbind.dev; frame-ancestors 'none'; base-uri 'none'";
const APP = {
    client: 'app', version: '1.0.0', platform: 'ios', os: '27.1',
};
// Made-up GitHub accounts: ids of ten digits, and names with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const two = { provider: 'github', subject: '8000000002', login: 'made_up_two' };
const NO_DEVICE = 'No device is waiting for this code: check it, or start again on the device.';
const ENTER_CODE = 'Enter the eight letters your device shows.';

function limiter(limit = Infinity) {
    const counts = new Map();
    return {
        limit: async ({ key }) => {
            counts.set(key, (counts.get(key) ?? 0) + 1);
            return { success: counts.get(key) <= limit };
        },
    };
}

function setup({ environment = env } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    const deps = {
        limits: {
            api: limiter(), login: limiter(), starts: limiter(), poll: limiter(), code: limiter(10),
        },
        accounts,
        devices: createDeviceCodes(db, () => now),
        quota: createQuota(memoryStorage(), () => now),
        fetcher: github({ now: NOW, person: { id: 8000000001, login: 'made_up_dev' } }),
        now: () => now,
    };
    const send = (method, path, {
        origin, cookie, json, form, country, network = '203.0.113.7',
    } = {}) => {
        const request = new Request(`${API}${path}`, {
            method,
            headers: {
                'cf-connecting-ip': network,
                ...(origin === undefined ? {} : { origin }),
                ...(cookie === undefined ? {} : { cookie }),
                ...(json === undefined ? {} : { 'content-type': 'application/json' }),
                ...(form === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
            },
            body: json !== undefined ? JSON.stringify(json) : form && new URLSearchParams(form).toString(),
        });
        // Cloudflare's reading of the caller's address, which a request of Node's has no place for.
        if (country !== undefined) Object.defineProperty(request, 'cf', { value: { country } });
        return handleRequest(request, environment, deps);
    };
    return {
        db, accounts, send, advance: (ms) => { now += ms; },
    };
}

const read = async (response) => ({ status: response.status, body: await response.json() });
const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const cookieOf = async (user, madeAt = NOW) => `${SESSION_COOKIE}=${await signSession({ id: user.id, name: user.login }, env.SESSION_SECRET, madeAt)}`;
const start = async (send, options = {}) => (await send('POST', '/v1/device/authorize', { json: APP, ...options })).json();
// The two steps of the page's script, as it sends them: JSON, from the page's own origin, with the browser's cookie.
const lookUp = (send, cookie, userCode, options = {}) => send('POST', '/account/device/lookup', {
    origin: API, cookie, json: { user_code: userCode }, ...options,
});
const decide = (send, cookie, userCode, approve, options = {}) => send('POST', '/account/device/approve', {
    origin: API, cookie, json: { user_code: userCode, approve }, ...options,
});
// A code of the letters a user code takes, other than the one given.
const anotherCode = (code) => (code === 'BCDF-GHJK' ? 'CDFG-HJKL' : 'BCDF-GHJK');

test('serves /device with the account\'s pages\' policy, and to a browser signed out a sign-in of each way in that comes back to it', async () => {
    const { send } = setup();
    const withApple = setup({ environment: { ...env, ...APPLE_ENV } });

    const response = await send('GET', '/device');
    const html = await response.text();
    const both = await (await withApple.send('GET', '/device')).text();

    assert.equal(response.status, 200);
    assert.deepEqual(Object.fromEntries(['content-type', 'content-security-policy', 'referrer-policy', 'x-content-type-options', 'cache-control']
        .map((name) => [name, response.headers.get(name)])), {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': POLICY,
        'referrer-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
    });
    assert.ok(html.includes('<title>Approve a device</title>') && html.includes('<p>Sign in to approve a device.</p>'));
    assert.ok(html.includes('<a class="button" href="/account/login/github?next=device">Sign in with GitHub</a>') && !html.includes('device-code'));
    assert.ok(both.includes('<a class="button" href="/account/login/github?next=device">Sign in with GitHub</a> <a class="button" href="/account/login/apple?next=device">Sign in with Apple</a>'));
    assert.ok(!html.includes('<script>') && !html.includes('<style') && !html.includes('style='), 'nothing inline, which the policy would block');
});

test('asks a signed-in browser for the code its device shows, names the account, and takes no code from its address', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);

    const html = await (await send('GET', '/device?user_code=BCDF-GHJK&code=BCDFGHJK', { cookie })).text();
    const script = await (await send('GET', '/account.js')).text();

    assert.ok(html.includes('Signed in as <strong>made_up_dev</strong>.'));
    assert.ok(html.includes('<label for="user-code">Enter the code your device shows</label>'));
    assert.ok(html.includes('<input id="user-code" name="user_code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" required>'));
    assert.ok(html.includes('<p>Approve only a code you started yourself, on a device in front of you.</p>'));
    assert.ok(html.includes('<form method="post" action="/account/logout"><input type="hidden" name="next" value="device"><button type="submit">Sign out</button></form>'));
    assert.ok(!html.includes('BCDF'), 'a code in the address reaches the page');
    // The script's part for this page writes what it is answered as text, never as markup, and reads no code from the
    // address.
    const devicePart = script.slice(script.indexOf("const entry = document.getElementById('device-code');"));
    assert.ok(devicePart.length < script.length && devicePart.includes("document.getElementById('device-words').textContent = "));
    assert.ok(!script.includes('innerHTML') && !devicePart.includes('location.search') && !devicePart.includes('URLSearchParams'));
});

test('signs this browser out from the device page, and back to it', async () => {
    const { send } = setup();

    const fromDevice = await send('POST', '/account/logout', { origin: API, form: { next: 'device' } });
    const elsewhere = await send('POST', '/account/logout', { origin: API, form: { next: 'https://evil.example/' } });

    assert.deepEqual([fromDevice.status, fromDevice.headers.get('location')], [303, `${API}/device`]);
    assert.deepEqual([elsewhere.status, elsewhere.headers.get('location')], [303, `${API}/login`]);
    assert.ok(fromDevice.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=; Max-Age=0`)));
});

test('brings a sign-in started on the device page back to it, and a first one, asked on the account\'s page, on to it', async () => {
    const { send } = setup();
    const jar = new Map();
    const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const take = (response) => {
        response.headers.getSetCookie().forEach((each) => {
            const [name, value] = each.split(';')[0].split(/=(.*)/s);
            if (/; Max-Age=0;/.test(each)) jar.delete(name);
            else jar.set(name, value);
        });
        return response;
    };
    // The start's link, then GitHub's answer at the callback it lists, played by the stand-in.
    const signIn = async () => {
        const started = take(await send('GET', '/account/login/github?next=device', { cookie: cookie() }));
        const asked = new URL(started.headers.get('location'));
        return take(await send('GET', `/playground/callback/github?code=${codeFor(asked)}&state=${asked.searchParams.get('state')}`, { cookie: cookie() }));
    };

    const first = await signIn();
    const question = await (await send('GET', '/login?next=device', { cookie: cookie() })).text();
    const made = take(await send('POST', '/account/new', { origin: API, cookie: cookie(), form: {} }));
    jar.delete(SESSION_COOKIE);
    const again = await signIn();

    assert.equal(first.headers.get('location'), `${API}/login?next=device`);
    assert.ok(question.includes('No crossbind account signs in with this GitHub account yet.'));
    assert.ok(question.includes('<a class="button" href="/account/login/github?next=device">Sign in with GitHub</a>'));
    assert.equal(made.headers.get('location'), `${API}/device#login=ok`);
    assert.equal(again.headers.get('location'), `${API}/device#login=ok`);
});

test('looks a code up for a signed-in account: what asked, from where and when, typed in any case, with or without its dash', async () => {
    const { accounts, send, advance } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);
    const { user_code: code } = await start(send, { country: 'TR' });
    advance(2 * MINUTE);

    const answers = [];
    for (const typed of [code, code.toLowerCase(), code.replace('-', ''), ` ${code.slice(0, 4).toLowerCase()} ${code.slice(5)} `]) {
        answers.push(await read(await lookUp(send, cookie, typed)));
    }

    assert.deepEqual(answers, Array(4).fill({
        status: 200,
        body: {
            client: 'app', label: 'crossbind app 1.0.0 on iOS 27.1', country: 'TR', asked: '2026-11-21T10:00:00.000Z', account: 'made_up_dev',
        },
    }));
});

test('takes a lookup and an approval from the device page alone: crossbind.dev, another site, none and null get 403 and change nothing', async () => {
    const { accounts, db, send } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);
    const started = await start(send);
    const routes = [['/account/device/lookup', { user_code: started.user_code }], ['/account/device/approve', { user_code: started.user_code, approve: true }]];

    const answers = [];
    for (const [path, json] of routes) {
        for (const origin of [SITE, 'https://evil.example', 'http://api.crossbind.dev', undefined, 'null']) {
            answers.push({ path, origin: origin ?? 'none', ...(await read(await send('POST', path, { origin, cookie, json }))) });
        }
    }

    assert.equal(answers.length, 10);
    assert.deepEqual(answers.filter((answer) => answer.status !== 403 || answer.body.error !== 'This is accepted from the account\'s page only.'), []);
    assert.deepEqual(await rows(db, 'SELECT state, user_id, match FROM device_codes'), [{ state: 'pending', user_id: null, match: null }]);
});

test('answers 401 to a browser signed out or signed out everywhere since, 400 to a code out of its form, and 404 when no device waits for it', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);
    const started = await start(send);
    const malformed = [{}, { user_code: 'BCDFGHJ' }, { user_code: 'BCDFGHJKL' }, { user_code: 'BCDFGHJA' }, { user_code: 12345678 }, { user_code: 'B'.repeat(40) }];

    const signedOut = await read(await lookUp(send, undefined, started.user_code));
    const outOfForm = [];
    for (const json of malformed) outOfForm.push(await read(await send('POST', '/account/device/lookup', { origin: API, cookie, json })));
    const noAnswer = await read(await decide(send, cookie, started.user_code, 'yes'));
    const unknown = await read(await lookUp(send, cookie, anotherCode(started.user_code)));
    await accounts.signOutEverywhere(user.id);
    const everywhere = [await read(await lookUp(send, cookie, started.user_code)), await read(await decide(send, cookie, started.user_code, true))];

    assert.deepEqual(signedOut, { status: 401, body: { error: 'Sign in to approve a device.' } });
    assert.deepEqual(outOfForm, Array(malformed.length).fill({ status: 400, body: { error: ENTER_CODE } }));
    assert.deepEqual(noAnswer, { status: 400, body: { error: 'Approve or deny the code on the device page.' } });
    assert.deepEqual(unknown, { status: 404, body: { error: NO_DEVICE } });
    assert.deepEqual(everywhere, Array(2).fill({ status: 401, body: { error: 'Sign in to approve a device.' } }));
});

test('takes ten codes entered a minute for an account and for a network, a lookup and an approval alike', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const { user: other } = await accounts.signIn(two);
    const [mine, theirs] = [await cookieOf(user), await cookieOf(other)];

    const statuses = [];
    for (let count = 0; count < 5; count += 1) statuses.push((await lookUp(send, mine, 'BCDF-GHJK')).status);
    for (let count = 0; count < 5; count += 1) statuses.push((await decide(send, mine, 'BCDF-GHJK', false)).status);
    const sameAccount = await read(await lookUp(send, mine, 'BCDF-GHJK', { network: '198.51.100.20' }));
    const sameNetwork = await read(await lookUp(send, theirs, 'BCDF-GHJK'));
    const neither = await lookUp(send, theirs, 'BCDF-GHJK', { network: '198.51.100.30' });

    assert.deepEqual(statuses, Array(10).fill(404));
    assert.deepEqual(sameAccount, { status: 429, body: { error: 'Too many codes entered; try again in a minute.' } });
    assert.deepEqual(sameNetwork, sameAccount);
    assert.equal(neither.status, 404);
});

test('approves a waiting code with a number of 10 to 99 that its answer alone carries, or denies it, and either ends the code for the page', async () => {
    const { accounts, db, send } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);
    const approved = await start(send);
    const denied = await start(send);

    const yes = await read(await decide(send, cookie, approved.user_code.toLowerCase(), true));
    const no = await read(await decide(send, cookie, denied.user_code, false));
    const again = [
        await read(await decide(send, cookie, approved.user_code, true)),
        await read(await decide(send, cookie, denied.user_code, false)),
        await read(await lookUp(send, cookie, approved.user_code)),
    ];
    const deviceOfTheDenied = await read(await send('POST', '/v1/device/token', { json: { device_code: denied.device_code } }));

    assert.equal(yes.status, 200);
    assert.deepEqual(Object.keys(yes.body).sort(), ['label', 'match']);
    assert.ok(Number.isInteger(yes.body.match) && yes.body.match >= MATCH_FROM && yes.body.match <= MATCH_TO);
    assert.equal(yes.body.label, 'crossbind app 1.0.0 on iOS 27.1');
    assert.deepEqual(no, { status: 200, body: { denied: true } });
    assert.deepEqual(again, Array(3).fill({ status: 404, body: { error: NO_DEVICE } }));
    assert.deepEqual(await rows(db, 'SELECT state, user_id, match FROM device_codes ORDER BY state'), [
        { state: 'approved', user_id: Number(user.id), match: yes.body.match },
        { state: 'denied', user_id: null, match: null },
    ]);
    assert.equal(deviceOfTheDenied.body.error, 'access_denied');
});

test('approves no code past its ten minutes', async () => {
    const { accounts, send, advance } = setup();
    const { user } = await accounts.signIn(dev);
    const started = await start(send);

    advance(10 * MINUTE);

    assert.deepEqual(await read(await decide(send, await cookieOf(user), started.user_code, true)), { status: 404, body: { error: NO_DEVICE } });
});

test('logs an approval and a denial by the account\'s id alone', async (t) => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const cookie = await cookieOf(user);
    const [first, second] = [await start(send), await start(send)];
    const lines = t.mock.method(console, 'log', () => {});

    await decide(send, cookie, first.user_code, true);
    await decide(send, cookie, second.user_code, false);

    const logged = lines.mock.calls.map((each) => each.arguments[0]);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
        { event: 'device-approved', who: `user:${user.id}` },
        { event: 'device-denied', who: `user:${user.id}` },
    ]);
    assert.ok(![first.user_code, second.user_code, first.device_code].some((secret) => logged.join('\n').includes(secret)));
});
