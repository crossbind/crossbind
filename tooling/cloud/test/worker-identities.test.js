import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildsOpenOn, createAccounts, OWN_IDS_FROM } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { STATE_COOKIE } from '../worker/oauth.js';
import { PENDING_COOKIE, SESSION_COOKIE, signSession } from '../worker/session.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import {
    APPLE_ENV, OTHER_SUB, SUB, apple, both, codeFor, github,
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

function setup({ person = DEV, ageDays = 400 } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const draws = OWN[Symbol.iterator]();
    const accounts = createAccounts(db, () => now, () => draws.next().value);
    const deps = {
        limits: { api: { limit: async () => ({ success: true }) } },
        accounts,
        quota: { remaining: async ({ limit }) => limit },
        fetcher: both(github({ now: NOW, person, ageDays }), apple({ now: NOW, subject: SUB }).fetcher),
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
        // The provider's answer at the callback the start named.
        answer(started) {
            const asked = new URL(started.headers.get('location'));
            const back = new URL(asked.searchParams.get('redirect_uri'));
            return this.get(`${back.pathname}?code=${codeFor(asked)}&state=${asked.searchParams.get('state')}`);
        },
        // A sign-in through the provider's page: its start, a link, then the provider's answer.
        async signIn(provider, query = '') {
            return this.answer(await this.get(`/account/login/${provider}${query}`));
        },
        // A link through the provider's page: its start, a form of the account's page, then the provider's answer.
        async link(provider) {
            return this.answer(await this.post(`/account/link/${provider}`));
        },
    };
}

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const pageOf = async (person) => (await person.get('/login')).text();
// The notice the page shows once, from the cookie a sign-in or a form left.
const noticeOf = async (person) => (await pageOf(person)).split('<p class="notice" role="status">')[1]?.split('</p>')[0] ?? null;
const AT = new Date(NOW).toISOString();
// Accounts as the rows hold them: an id, its GitHub name or none, and its identities as [provider, subject, unlinked_at].
async function account(db, id, login, identities, { blocked = 0 } = {}) {
    await db.prepare('INSERT INTO users (id, login, created_at, last_login_at, blocked) VALUES (?1, ?2, ?3, ?3, ?4)').bind(id, login, AT, blocked).run();
    for (const [provider, subject, unlinkedAt = null] of identities) {
        await db.prepare('INSERT INTO identities (provider, subject, user_id, created_at, unlinked_at) VALUES (?, ?, ?, ?, ?)').bind(provider, subject, id, AT, unlinkedAt).run();
    }
}
// A browser signed in to an account, with the cookie a sign-in sets.
async function signedInTo(send, id, name) {
    const person = browser(send);
    person.jar.set(SESSION_COOKIE, await signSession({ id: String(id), name }, env.SESSION_SECRET, NOW));
    return person;
}
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

test('links an Apple ID to an account signed in with GitHub, from a form of its page, and the account then signs in with either', async () => {
    const { db, send } = setup();
    const person = browser(send);
    await person.signIn('github');
    await person.post('/account/new');
    const before = await pageOf(person);

    const started = await person.post('/account/link/apple');
    const [, , next, provider, purpose] = person.jar.get(STATE_COOKIE).split('.');
    const landed = await person.answer(started);
    const notice = await noticeOf(person);
    const other = browser(send);
    const signedIn = await other.signIn('apple');

    assert.ok(before.includes('<li><span>GitHub account <strong>made_up_dev</strong></span></li>'));
    assert.ok(before.includes('<form method="post" action="/account/link/apple"><button type="submit">Link an Apple ID</button></form>'));
    assert.deepEqual([started.status, new URL(started.headers.get('location')).origin, next, provider, purpose], [302, 'https://appleid.apple.com', 'account', 'apple', `link:${OWN[0]}`]);
    assert.deepEqual([landed.status, landed.headers.get('location')], [302, `${API}/login`]);
    assert.equal(notice, 'The Apple ID is linked: it signs in to this account too.');
    assert.deepEqual(await rows(db, 'SELECT provider, user_id FROM identities ORDER BY provider'), [{ provider: 'apple', user_id: OWN[0] }, { provider: 'github', user_id: OWN[0] }]);
    assert.equal(signedIn.headers.get('location'), `${API}/login#login=ok`);
    const after = await pageOf(other);
    assert.ok(after.includes('Signed in as <strong>made_up_dev</strong>.') && after.includes('<input type="hidden" name="provider" value="apple"><button type="submit">Unlink</button>'));
});

test('starts a link signed in alone, and answers it with a redirect: no address with a state reaches a page', async () => {
    const { db, send } = setup();
    await account(db, OWN[0], 'made_up_dev', [['github', '8000000001']]);
    const signedOut = browser(send);
    const person = await signedInTo(send, OWN[0], 'made_up_dev');

    const refused = await signedOut.post('/account/link/apple');
    const started = await person.post('/account/link/apple');

    assert.deepEqual([refused.status, refused.headers.get('location')], [303, `${API}/login`]);
    assert.deepEqual([started.status, started.headers.get('content-type'), await started.text()], [302, null, '']);
    assert.ok(!signedOut.jar.has(STATE_COOKIE) && person.jar.has(STATE_COOKIE));
});

test('links nothing on a plain sign-in while signed in, and links only to the account its start named while this browser signs it in', async () => {
    const { db, send } = setup();
    await account(db, OWN[0], 'made_up_dev', [['github', '8000000001']]);
    await account(db, OWN[1], 'made_up_two', [['github', '8000000002']]);
    const plain = await signedInTo(send, OWN[0], 'made_up_dev');
    const signedOutMeanwhile = await signedInTo(send, OWN[0], 'made_up_dev');
    const switched = await signedInTo(send, OWN[0], 'made_up_dev');

    await plain.signIn('apple');
    const asked = await pageOf(plain);
    const startedOut = await signedOutMeanwhile.post('/account/link/apple');
    await signedOutMeanwhile.post('/account/logout');
    await signedOutMeanwhile.answer(startedOut);
    const startedSwitched = await switched.post('/account/link/apple');
    switched.jar.set(SESSION_COOKIE, await signSession({ id: String(OWN[1]), name: 'made_up_two' }, env.SESSION_SECRET, NOW));
    await switched.answer(startedSwitched);

    assert.ok(asked.includes('<h2>Link this Apple ID?</h2>') && asked.includes('<form method="post" action="/account/link-pending"><button type="submit">Link it to this account</button></form>'));
    assert.deepEqual([await noticeOf(signedOutMeanwhile), await noticeOf(switched)], ['Linking did not work; try again.', 'Linking did not work; try again.']);
    assert.deepEqual(await rows(db, 'SELECT provider, subject, user_id FROM identities WHERE provider = \'apple\''), []);
});

test('refuses each link the account\'s rules refuse, with words that say why and when', async () => {
    // The account signed in, OWN[0], and another, OWN[1], each as [id, GitHub name, identities, flags]; the provider the
    // signed-in account links; the words its page then shows.
    const THIRD_SUB = '000123.made0up0apple0id0third000.0999';
    const mine = (identities, login = '') => [OWN[0], login, identities];
    const cases = {
        'signs in to another account': [[mine([['github', '583231']], 'octocat'), [OWN[1], '', [['apple', SUB]]]], 'apple',
            `This Apple ID already signs in to another crossbind account (Apple account …${String(OWN[1]).slice(-4)}). To link it here, sign in with it and delete that account, then link it again.`],
        'one of Apple\'s linked here': [[mine([['github', '583231'], ['apple', OTHER_SUB]], 'octocat')], 'apple', 'This account already has an Apple ID linked: unlink it first.'],
        'one of GitHub\'s linked here': [[mine([['apple', OTHER_SUB], ['github', '583231']], 'octocat')], 'github', 'This account already has a GitHub account linked (octocat): unlink it first.'],
        'unlinked from another this month': [[mine([['apple', OTHER_SUB]]), [OWN[1], '', [['apple', THIRD_SUB], ['github', '8000000001', AT]]]], 'github',
            'This GitHub account belonged to another crossbind account this month: it can be linked here from 1 December 2026.'],
        'left by an account deleted with seconds': [[mine([['apple', OTHER_SUB]]), [OWN[1], 'made_up_dev', [['github', '8000000001']], { deleted: true }]], 'github',
            'This GitHub account belonged to another crossbind account this month: it can be linked here from 1 December 2026.'],
        'its account blocked': [[mine([['apple', OTHER_SUB]]), [OWN[1], 'made_up_dev', [['github', '8000000001']], { blocked: 1 }]], 'github', 'This GitHub account may not use crossbind cloud.'],
        'already this account\'s': [[mine([['github', '8000000001'], ['apple', OTHER_SUB]], 'made_up_dev')], 'github', 'This GitHub account already signs in to this account.'],
    };

    const said = {};
    for (const [name, [rowsOf, provider, , options]] of Object.entries(cases)) {
        const { db, accounts, send } = setup(options);
        for (const [id, login, identities, { deleted = false, blocked = 0 } = {}] of rowsOf) {
            await account(db, id, login, identities, { blocked });
            if (deleted) {
                await accounts.addBuildSeconds(String(id), NOW, 'web', 60);
                await accounts.deleteAccount(String(id));
            }
        }
        const person = await signedInTo(send, OWN[0], 'made_up_dev');
        await person.link(provider);
        said[name] = await noticeOf(person);
    }

    assert.deepEqual(said, Object.fromEntries(Object.entries(cases).map(([name, [, , words]]) => [name, words])));
});

test('makes a GitHub account younger than 30 days a new account at its first sign-in, asked on the page, and links one to an Apple ID\'s account, each new until the earlier of its own 30 days and that GitHub account\'s', async () => {
    const madeOnPage = setup({ ageDays: 3 });
    const first = browser(madeOnPage.send);
    await first.signIn('github');
    const made = await first.post('/account/new');
    const linkedOnPage = setup({ ageDays: 3 });
    await account(linkedOnPage.db, OWN[0], '', [['apple', OTHER_SUB]]);
    const person = await signedInTo(linkedOnPage.send, OWN[0], `Apple account …${String(OWN[0]).slice(-4)}`);
    await person.link('github');
    const madeThreeDaysAgo = new Date(NOW - 3 * 24 * 3600 * 1000).toISOString();

    assert.equal(made.headers.get('location'), `${API}/login#login=ok`);
    assert.equal(await noticeOf(person), 'The GitHub account is linked: it signs in to this account too.');
    for (const { db, accounts } of [madeOnPage, linkedOnPage]) {
        assert.deepEqual(await rows(db, "SELECT user_id, github_created_at FROM identities WHERE provider = 'github'"), [{ user_id: OWN[0], github_created_at: madeThreeDaysAgo }]);
        assert.equal(buildsOpenOn(await accounts.standing(String(OWN[0])), 30, NOW), '2026-12-17');
    }
});

test('unlinks from the page, never the last: free at once, or held until the 1st with build seconds this month, and linked back', async () => {
    const free = setup();
    await account(free.db, OWN[0], 'made_up_dev', [['github', '8000000001'], ['apple', SUB]]);
    const freeing = await signedInTo(free.send, OWN[0], 'made_up_dev');
    const held = setup();
    await account(held.db, OWN[0], 'made_up_dev', [['github', '8000000001'], ['apple', SUB]]);
    await held.accounts.addBuildSeconds(String(OWN[0]), NOW, 'web', 60);
    const holding = await signedInTo(held.send, OWN[0], 'made_up_dev');

    const unlinked = await freeing.post('/account/unlink', { provider: 'github' });
    const freed = await noticeOf(freeing);
    const last = await freeing.post('/account/unlink', { provider: 'apple' });
    const unknown = await freeing.post('/account/unlink', { provider: 'gitlab' });
    await holding.post('/account/unlink', { provider: 'github' });
    const kept = await noticeOf(holding);
    const elsewhere = browser(held.send);
    await elsewhere.signIn('github');
    const refused = await noticeOf(elsewhere);
    await holding.link('github');
    const back = await noticeOf(holding);

    assert.deepEqual([unlinked.status, unlinked.headers.get('location')], [303, `${API}/login`]);
    assert.equal(freed, 'The GitHub account is unlinked: it no longer signs in to this account.');
    assert.ok((await pageOf(freeing)).includes(`Signed in as <strong>Apple account …${String(OWN[0]).slice(-4)}</strong>.`));
    assert.deepEqual([last.status, (await last.json()).error], [409, 'This is the only way into your account: link another first, or delete the account.']);
    assert.deepEqual([unknown.status, (await unknown.json()).error], [400, 'Unlink a sign-in from the list on the account\'s page.']);
    assert.equal(kept, 'The GitHub account is unlinked. As this account has cloud build minutes this month, it signs in to nothing until 1 December 2026, and can be linked back here before then.');
    assert.equal(refused, 'This GitHub account was unlinked from a crossbind account this month: it signs in again from 1 December 2026, and can be linked back to that account now.');
    assert.equal(back, 'The GitHub account is linked: it signs in to this account too.');
    assert.ok((await pageOf(holding)).includes('Signed in as <strong>made_up_dev</strong>.'));
    assert.deepEqual(await rows(held.db, 'SELECT provider, user_id, unlinked_at FROM identities ORDER BY provider'), [
        { provider: 'apple', user_id: OWN[0], unlinked_at: null }, { provider: 'github', user_id: OWN[0], unlinked_at: null },
    ]);
});

test('links the identity a first sign-in confirmed once its person signs in with the account they have: the question\'s other answer', async () => {
    const { db, send } = setup();
    await account(db, OWN[0], 'made_up_dev', [['github', '8000000001']]);
    const person = browser(send);

    await person.signIn('apple');
    const asked = await pageOf(person);
    await person.signIn('github');
    const linking = await pageOf(person);
    const linked = await person.post('/account/link-pending');
    const notice = await noticeOf(person);
    const none = await person.post('/account/link-pending');

    assert.ok(asked.includes('<a class="button" href="/account/login/github">I have an account with GitHub: sign in with it to link this Apple ID</a>'));
    assert.ok(linking.includes('Signed in as <strong>made_up_dev</strong>.') && linking.includes('<h2>Link this Apple ID?</h2>'));
    assert.deepEqual([linked.status, linked.headers.get('location'), person.jar.has(PENDING_COOKIE)], [303, `${API}/login`, false]);
    assert.equal(notice, 'The Apple ID is linked: it signs in to this account too.');
    assert.equal(none.headers.get('location'), `${API}/login#waited`);
    assert.deepEqual(await rows(db, 'SELECT provider, user_id FROM identities ORDER BY provider'), [{ provider: 'apple', user_id: OWN[0] }, { provider: 'github', user_id: OWN[0] }]);
});

test('logs a link and an unlinking by the account\'s id and the provider alone, never the identity', async (t) => {
    const { db, send } = setup();
    await account(db, OWN[0], 'made_up_dev', [['github', '8000000001']]);
    const person = await signedInTo(send, OWN[0], 'made_up_dev');
    const lines = t.mock.method(console, 'log', () => {});

    await person.link('apple');
    await person.post('/account/unlink', { provider: 'apple' });

    const logged = lines.mock.calls.map((each) => each.arguments[0]);
    assert.deepEqual(logged.map((line) => JSON.parse(line)), [
        { event: 'identity-linked', who: `user:${OWN[0]}`, provider: 'apple' },
        { event: 'identity-unlinked', who: `user:${OWN[0]}`, provider: 'apple' },
    ]);
    assert.ok(!logged.join('\n').includes(SUB));
});
