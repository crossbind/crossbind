import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccounts, DEVICE_REF_LENGTH } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { STATE_COOKIE } from '../worker/oauth.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const API = 'https://api.crossbind.dev';
const SITE = 'https://crossbind.dev';
const NOW = Date.parse('2026-11-20T10:00:00Z');
const MINUTE = 60 * 1000;
const env = {
    SESSION_SECRET: 'a-session-secret-of-at-least-32-characters',
    GITHUB_CLIENT_ID: 'gh-id',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    PLAYGROUND_URL: `${SITE}/playground/`,
    ALLOWED_ORIGINS: SITE,
    MIN_GITHUB_ACCOUNT_DAYS: '30',
    ANONYMOUS_DAILY: '5',
    USER_DAILY: '100',
};
// Made-up GitHub accounts: ids of ten digits, and names with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const two = { provider: 'github', subject: '8000000002', login: 'made_up_two' };
const POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self' https://crossbind.dev; frame-ancestors 'none'; base-uri 'none'";

function setup({ environment = env } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    const deps = {
        limits: { api: { limit: async () => ({ success: true }) } },
        accounts,
        quota: { remaining: async ({ limit }) => limit },
        fetcher: async (url) => { throw new Error(`nothing outside is reached: ${url}`); },
        now: () => now,
    };
    const send = (method, path, { origin, cookie, form } = {}) => handleRequest(new Request(`${API}${path}`, {
        method,
        headers: {
            ...(origin === undefined ? {} : { origin }),
            ...(cookie === undefined ? {} : { cookie }),
            ...(form === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        },
        body: form === undefined ? undefined : new URLSearchParams(form).toString(),
    }), environment, deps);
    return {
        db, accounts, send, advance: (ms) => { now += ms; },
    };
}

// The cookie a sign-in sets in a browser at `madeAt`.
const cookieOf = async (user, madeAt) => `${SESSION_COOKIE}=${await signSession({ id: user.id, name: user.login }, env.SESSION_SECRET, madeAt)}`;
const refOf = (token) => createHash('sha256').update(token).digest('hex').slice(0, DEVICE_REF_LENGTH);
const signsIn = async (send, cookie) => (await (await send('GET', '/login', { cookie })).text()).includes('Signed in as');
const clearsCookie = (response) => response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=; Max-Age=0`));

test('serves the account\'s page with its policy, and to a browser signed out a sign-in with GitHub', async () => {
    const { send } = setup();
    const unset = setup({ environment: { ...env, GITHUB_CLIENT_SECRET: '' } });

    const response = await send('GET', '/login');
    const html = await response.text();
    const [style, script] = [await send('GET', '/account.css'), await send('GET', '/account.js')];

    assert.equal(response.status, 200);
    assert.deepEqual(Object.fromEntries(['content-type', 'content-security-policy', 'referrer-policy', 'x-content-type-options', 'cache-control']
        .map((name) => [name, response.headers.get(name)])), {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': POLICY,
        'referrer-policy': 'same-origin',
        'x-content-type-options': 'nosniff',
        'cache-control': 'no-store',
    });
    assert.ok(html.includes('<a class="button" href="/account/login/github">Sign in with GitHub</a>'));
    assert.ok(!html.includes('Signed in as') && !html.includes('<form'));
    assert.ok(html.includes('<link rel="stylesheet" href="/account.css">') && html.includes('<script src="/account.js" defer></script>'));
    assert.ok(!html.includes('<script>') && !html.includes('<style') && !html.includes('style='), 'nothing inline, which the policy would block');
    assert.deepEqual([style.status, style.headers.get('content-type'), script.status, script.headers.get('content-type')], [200, 'text/css; charset=utf-8', 200, 'text/javascript; charset=utf-8']);
    const unsetHtml = await (await unset.send('GET', '/login')).text();
    assert.ok(unsetHtml.includes('Signing in is not set up.') && !unsetHtml.includes('/account/login/github'));
});

test('shows a signed-in account its name and devices, each with a form that signs it out, every value escaped', async () => {
    const { db, accounts, send, advance } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    await db.prepare('UPDATE tokens SET label = ?').bind('crossbind app <1.0>, "iOS"').run();
    advance(MINUTE);
    const { user: idle } = await accounts.signIn(two);

    const html = await (await send('GET', '/login', { cookie: await cookieOf(user, NOW + MINUTE) })).text();
    const idleHtml = await (await send('GET', '/login', { cookie: await cookieOf(idle, NOW + MINUTE) })).text();

    assert.ok(html.includes('Signed in as <strong>made_up_dev</strong>.'));
    assert.ok(html.includes(`<input type="hidden" name="ref" value="${refOf(token)}">`));
    assert.ok(html.includes('<span>crossbind app &#60;1.0&#62;, &#34;iOS&#34;</span>') && !html.includes('<1.0>'));
    assert.ok(html.includes('signed in 2026-11-20, last used 2026-11-20'));
    for (const action of ['/account/logout', '/account/tokens/revoke', '/account/logout-everywhere', '/account/delete']) {
        assert.ok(html.includes(`<form method="post" action="${action}">`), action);
    }
    assert.ok(html.includes('<input type="checkbox" name="confirm" value="yes" required>'));
    assert.ok(idleHtml.includes('Signed in as <strong>made_up_two</strong>.') && idleHtml.includes('<p>No device is signed in.</p>'));
});

test('renders a notice for each result a sign-in or a form sends the page back with, hidden until the address names it', async () => {
    const { send } = setup();

    const html = await (await send('GET', '/login')).text();

    assert.deepEqual([...html.matchAll(/<p class="notice" data-notice="([^"]+)" hidden>([^<]+)<\/p>/g)].map(([, key, words]) => [key, words]), [
        ['login=ok', 'Signed in.'],
        ['login=failed', 'Signing in did not work; try again.'],
        ['login=cancelled', 'Signing in was cancelled.'],
        ['login=too-new', 'This GitHub account is too new; accounts can sign in 30 days after they were created.'],
        ['login=blocked', 'This account may not use crossbind cloud.'],
        ['signed-out-everywhere', 'Every device and every browser is signed out of the account, this one included.'],
        ['waited', 'That sign-in waited over ten minutes for an answer; sign in again.'],
        ['deleted', 'Your crossbind account is deleted, and every device is signed out of it.'],
    ]);
});

test('takes a form from the account\'s own page alone: crossbind.dev, another site, no Origin and Origin: null get 403 and change nothing', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    const cookie = await cookieOf(user, NOW);
    const forms = {
        '/account/logout': {}, '/account/tokens/revoke': { ref: refOf(token) }, '/account/logout-everywhere': {}, '/account/delete': { confirm: 'yes' }, '/account/new': {},
    };

    const answers = [];
    for (const [path, form] of Object.entries(forms)) {
        for (const origin of [SITE, 'https://evil.example', 'http://api.crossbind.dev', undefined, 'null']) {
            const response = await send('POST', path, { origin, cookie, form });
            const error = response.headers.get('content-type')?.startsWith('application/json') ? (await response.json()).error : null;
            answers.push({
                path, origin: origin ?? 'none', status: response.status, error, cookie: response.headers.get('set-cookie'),
            });
        }
    }

    assert.equal(answers.length, 25);
    assert.deepEqual(answers.filter((answer) => answer.status !== 403 || answer.cookie !== null || answer.error !== 'This is accepted from the account\'s page only.'), []);
    assert.deepEqual(await accounts.standing(user.id), {
        exists: true, blocked: false, login: 'made_up_dev', name: 'made_up_dev', signedOutAt: null,
    });
    assert.equal((await accounts.userOfToken(token)).login, 'made_up_dev');
    assert.equal(await signsIn(send, cookie), true);
});

test('signs a device out from the page\'s form, and no device of another account', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const { user: other } = await accounts.signIn(two);
    const [revoked, kept, theirs] = [await accounts.issueToken(user.id), await accounts.issueToken(user.id), await accounts.issueToken(other.id)];
    const cookie = await cookieOf(user, NOW);
    const revoke = (ref) => send('POST', '/account/tokens/revoke', { origin: API, cookie, form: { ref } });

    const answers = [await revoke(refOf(theirs)), await revoke(refOf(revoked)), await revoke('not-a-device')];

    assert.deepEqual(answers.map((response) => [response.status, response.headers.get('location')]), [[303, `${API}/login`], [303, `${API}/login`], [400, null]]);
    assert.deepEqual(await Promise.all([revoked, kept, theirs].map(async (token) => (await accounts.userOfToken(token))?.login ?? null)), [null, 'made_up_dev', 'made_up_two']);
    assert.equal(await signsIn(send, cookie), true);
});

test('signs out everywhere from the page: every token, this browser and every cookie made before, not one made after', async () => {
    const { accounts, send, advance } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    const earlier = await cookieOf(user, NOW - 60 * MINUTE);
    const here = await cookieOf(user, NOW);
    advance(MINUTE);

    const response = await send('POST', '/account/logout-everywhere', { origin: API, cookie: here });
    advance(MINUTE);
    const later = await cookieOf(user, NOW + 2 * MINUTE);
    const session = async (cookie) => (await (await send('GET', '/playground/session', { origin: SITE, cookie })).json()).user;

    assert.deepEqual([response.status, response.headers.get('location'), clearsCookie(response)], [303, `${API}/login#signed-out-everywhere`, true]);
    assert.deepEqual([await signsIn(send, earlier), await signsIn(send, here), await signsIn(send, later)], [false, false, true]);
    assert.deepEqual([await session(here), await session(later)], [null, { name: 'made_up_dev' }]);
    assert.equal(await accounts.userOfToken(token), null);
});

test('deletes the account from its page once its box is ticked, and signs this browser out', async () => {
    const { db, accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    const cookie = await cookieOf(user, NOW);
    const remove = (form) => send('POST', '/account/delete', { origin: API, cookie, form });

    const unticked = await remove({});
    const keptAfterIt = (await accounts.standing(user.id)).exists;
    const response = await remove({ confirm: 'yes' });

    assert.deepEqual([unticked.status, (await unticked.json()).error, keptAfterIt], [400, 'Tick the box to delete the account.', true]);
    assert.deepEqual([response.status, response.headers.get('location'), clearsCookie(response)], [303, `${API}/login#deleted`, true]);
    assert.equal(await db.prepare('SELECT count(1) AS users FROM users').first('users'), 0);
    assert.equal(await accounts.userOfToken(token), null);
    assert.equal(await signsIn(send, cookie), false);
});

test('sends a form posted without a cookie that counts back to the page, and changes nothing', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    const forms = [['/account/tokens/revoke', { ref: refOf(token) }], ['/account/logout-everywhere', {}], ['/account/delete', { confirm: 'yes' }]];

    const answers = [];
    for (const [path, form] of forms) {
        for (const cookie of [undefined, `${SESSION_COOKIE}=made.up`]) {
            const response = await send('POST', path, { origin: API, cookie, form });
            answers.push([response.status, response.headers.get('location')]);
        }
    }

    assert.deepEqual(answers, Array(6).fill([303, `${API}/login`]));
    assert.equal((await accounts.userOfToken(token)).login, 'made_up_dev');
    assert.deepEqual(await accounts.standing(user.id), {
        exists: true, blocked: false, login: 'made_up_dev', name: 'made_up_dev', signedOutAt: null,
    });
});

test('signs this browser out from the page', async () => {
    const { send } = setup();

    const response = await send('POST', '/account/logout', { origin: API });

    assert.deepEqual([response.status, response.headers.get('location'), clearsCookie(response)], [303, `${API}/login`, true]);
});

test('starts a sign-in with GitHub from a link, through the callback GitHub knows, back to the account\'s page or to the playground alone', async () => {
    const { send } = setup();

    const started = {};
    for (const query of ['', '?next=playground', '?next=account', `?next=${encodeURIComponent('https://evil.example/')}`]) {
        const response = await send('GET', `/account/login/github${query}`);
        const location = new URL(response.headers.get('location'));
        const state = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${STATE_COOKIE}=`)).split(';')[0].slice(STATE_COOKIE.length + 1);
        started[query || 'none'] = [response.status, `${location.origin}${location.pathname}`, location.searchParams.get('redirect_uri'), state.split('.')[2]];
    }

    const github = (next) => [302, 'https://github.com/login/oauth/authorize', `${API}/playground/callback/github`, next];
    assert.deepEqual(started, {
        none: github('account'),
        '?next=playground': github('playground'),
        '?next=account': github('account'),
        [`?next=${encodeURIComponent('https://evil.example/')}`]: github('account'),
    });
});

test('logs what the page did by the account\'s id alone: no token, device reference or cookie', async (t) => {
    const { accounts, send, advance } = setup();
    const { user } = await accounts.signIn(dev);
    const token = await accounts.issueToken(user.id);
    const cookie = await cookieOf(user, NOW);
    const lines = t.mock.method(console, 'log', () => {});

    await send('POST', '/account/tokens/revoke', { origin: API, cookie, form: { ref: refOf(token) } });
    await send('POST', '/account/logout-everywhere', { origin: API, cookie });
    advance(MINUTE);
    await send('POST', '/account/delete', { origin: API, cookie: await cookieOf(user, NOW + MINUTE), form: { confirm: 'yes' } });

    const logged = lines.mock.calls.map((each) => each.arguments[0]);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
        { event: 'token-revoked', who: `user:${user.id}`, all: false },
        { event: 'token-revoked', who: `user:${user.id}`, all: true },
        { event: 'account-deleted', who: `user:${user.id}` },
    ]);
    assert.ok(![token, refOf(token), cookie.split('=')[1]].some((secret) => logged.join('\n').includes(secret)));
});

test('answers 404 to any other path or method under /account/, a preflight included, with no CORS', async () => {
    const { send } = setup();

    const answers = [
        await send('GET', '/account/delete'),
        await send('OPTIONS', '/account/delete', { origin: SITE }),
        await send('GET', '/account/login/gitlab'),
        await send('POST', '/account/unlink', { origin: API }),
        await send('POST', '/login', { origin: API }),
    ];

    assert.deepEqual(answers.map((response) => [response.status, response.headers.get('access-control-allow-origin')]), Array(5).fill([404, null]));
});

test('refuses a form body too large to be one of the page\'s', async () => {
    const { accounts, send } = setup();
    const { user } = await accounts.signIn(dev);

    const response = await send('POST', '/account/tokens/revoke', { origin: API, cookie: await cookieOf(user, NOW), form: { ref: 'a'.repeat(2048) } });

    assert.equal(response.status, 413);
});
