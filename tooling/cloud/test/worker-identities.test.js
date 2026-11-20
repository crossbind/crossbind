import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, OWN_IDS_FROM } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { PENDING_COOKIE, SESSION_COOKIE, signSession } from '../worker/session.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import {
    APPLE_ENV, SUB, apple, both, codeFor, github,
} from './support/providers.mjs';

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
    ...APPLE_ENV,
};
// The made-up GitHub account the stand-in signs in.
const DEV = { id: 8000000001, login: 'made_up_dev' };
const OWN = [OWN_IDS_FROM + 1, OWN_IDS_FROM + 2, OWN_IDS_FROM + 3];

function setup() {
    let now = NOW;
    const db = sqliteD1();
    const draws = OWN[Symbol.iterator]();
    const accounts = createAccounts(db, () => now, () => draws.next().value);
    const deps = {
        limits: { api: { limit: async () => ({ success: true }) } },
        accounts,
        quota: { remaining: async ({ limit }) => limit },
        fetcher: both(github({ now: NOW, person: DEV }), apple({ now: NOW, subject: SUB }).fetcher),
        now: () => now,
    };
    const send = (method, path, { origin, cookie, form } = {}) => handleRequest(new Request(`${API}${path}`, {
        method,
        headers: {
            ...(origin === undefined ? {} : { origin }),
            ...(cookie ? { cookie } : {}),
            ...(form === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
        },
        body: form === undefined ? undefined : new URLSearchParams(form).toString(),
    }), env, deps);
    return {
        db, accounts, send, advance: (ms) => { now += ms; },
    };
}

// A browser of its own: the cookies the Worker sets, sent back with each request.
function browser(send) {
    const jar = new Map();
    const take = (response) => {
        response.headers.getSetCookie().forEach((cookie) => {
            const [name, value] = cookie.split(';')[0].split(/=(.*)/s);
            if (/; Max-Age=0;/.test(cookie)) jar.delete(name);
            else jar.set(name, value);
        });
        return response;
    };
    const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    return {
        jar,
        get: async (path) => take(await send('GET', path, { cookie: cookie() })),
        post: async (path, form = {}, origin = API) => take(await send('POST', path, { cookie: cookie(), form, origin })),
        // A sign-in through the provider's page: its start, then the provider's answer at the callback it names.
        async signIn(provider, query = '') {
            const asked = new URL((await this.get(`/account/login/${provider}${query}`)).headers.get('location'));
            const back = new URL(asked.searchParams.get('redirect_uri'));
            return this.get(`${back.pathname}?code=${codeFor(asked)}&state=${asked.searchParams.get('state')}`);
        },
    };
}

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const pageOf = async (person) => (await person.get('/login')).text();
const QUESTION = (identity) => `<p>No crossbind account signs in with this ${identity} yet.</p>\n<form method="post" action="/account/new"><button type="submit">Make a new account</button></form>`;

test('asks a first sign-in with GitHub or with Apple before it makes an account, and makes none while it waits', async () => {
    const { db, send } = setup();
    const [first, second] = [browser(send), browser(send)];

    const withGitHub = await first.signIn('github');
    const withApple = await second.signIn('apple', '?next=playground');
    const pending = withGitHub.headers.getSetCookie().find((cookie) => cookie.startsWith(`${PENDING_COOKIE}=`));

    assert.deepEqual([withGitHub.headers.get('location'), withApple.headers.get('location')], [`${API}/login`, `${API}/login?next=playground`]);
    assert.ok(![first, second].some((person) => person.jar.has(SESSION_COOKIE)));
    assert.match(pending, /; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
    assert.ok((await pageOf(first)).includes(QUESTION('GitHub account')));
    assert.ok((await pageOf(second)).includes(QUESTION('Apple ID')));
    assert.deepEqual(await rows(db, 'SELECT (SELECT count(1) FROM users) AS users, (SELECT count(1) FROM identities) AS identities'), [{ users: 0, identities: 0 }]);
});

test('makes the account on "Make a new account", signs it in, and goes where the sign-in was to return', async () => {
    const { db, send } = setup();
    const [first, second] = [browser(send), browser(send)];
    await first.signIn('github');
    await second.signIn('apple', '?next=playground');

    const madeWithGitHub = await first.post('/account/new');
    const madeWithApple = await second.post('/account/new');

    assert.deepEqual([madeWithGitHub.status, madeWithGitHub.headers.get('location')], [303, `${API}/login#login=ok`]);
    assert.deepEqual([madeWithApple.status, madeWithApple.headers.get('location')], [303, `${SITE}/playground/#login=ok`]);
    assert.ok([first, second].every((person) => person.jar.has(SESSION_COOKIE) && !person.jar.has(PENDING_COOKIE)));
    assert.deepEqual(await rows(db, 'SELECT id, login FROM users ORDER BY id'), [{ id: OWN[0], login: 'made_up_dev' }, { id: OWN[1], login: '' }]);
    assert.deepEqual(await rows(db, 'SELECT provider, user_id FROM identities ORDER BY user_id'), [{ provider: 'github', user_id: OWN[0] }, { provider: 'apple', user_id: OWN[1] }]);
    const page = await pageOf(first);
    assert.ok(page.includes('Signed in as <strong>made_up_dev</strong>.') && !page.includes('A new crossbind account?'));
});

test('makes no account from a pending cookie it did not seal, one over ten minutes old, or none: the page says the question waited', async () => {
    const { db, send, advance } = setup();
    // An account of today, whose GitHub account a pending cookie written by hand names.
    await db.batch([
        db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (583231, 'octocat', ?1, ?1)").bind(new Date(NOW).toISOString()),
        db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', '583231', 583231, ?1)").bind(new Date(NOW).toISOString()),
    ]);
    // Unexpired when it is sent, so that its seal alone refuses it.
    const handMade = Buffer.from(JSON.stringify({
        provider: 'github', subject: '583231', login: 'octocat', next: 'account', exp: NOW + 60 * MINUTE,
    })).toString('base64url');
    const asSession = await signSession({ id: '583231', name: 'octocat' }, env.SESSION_SECRET, NOW);
    const late = browser(send);
    await late.signIn('apple');
    advance(10 * MINUTE + 1);

    const answers = [
        await send('POST', '/account/new', { origin: API }),
        await send('POST', '/account/new', { origin: API, cookie: `${PENDING_COOKIE}=${handMade}.${'A'.repeat(43)}` }),
        await send('POST', '/account/new', { origin: API, cookie: `${PENDING_COOKIE}=${asSession}` }),
        await late.post('/account/new'),
    ];

    assert.deepEqual(answers.map((response) => [response.status, response.headers.get('location'), response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`))]),
        Array(4).fill([303, `${API}/login#waited`, false]));
    assert.deepEqual(await rows(db, 'SELECT id FROM users'), [{ id: 583231 }]);
});

test('signs a pending identity in to the account it has by now, and makes no second one', async () => {
    const { db, send } = setup();
    const [waiting, quicker] = [browser(send), browser(send)];
    await waiting.signIn('github');
    await quicker.signIn('github');
    await quicker.post('/account/new');

    const answer = await waiting.post('/account/new');

    assert.equal(answer.headers.get('location'), `${API}/login#login=ok`);
    assert.deepEqual(await rows(db, 'SELECT id FROM users'), [{ id: OWN[0] }]);
    assert.ok((await pageOf(waiting)).includes('Signed in as <strong>made_up_dev</strong>.'));
});
