import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    createAccounts, randomAccountId, DEVICE_REF_LENGTH, MAX_TOKENS_PER_USER, OWN_IDS_BELOW, OWN_IDS_FROM, TOKEN_IDLE_DAYS,
} from '../worker/accounts.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const AT = new Date(NOW).toISOString();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
// An account made before identities, under its GitHub id, and that GitHub account as a sign-in hands it over.
const octocat = { id: '583231', login: 'octocat' };
const github = { provider: 'github', subject: '583231', login: 'octocat' };
// A made-up GitHub account that crossbind does not know yet.
const madeUp = { provider: 'github', subject: '8000000002', login: 'made_up_two' };
// Ids of crossbind's own, which the tests draw in turn.
const OWN = [OWN_IDS_FROM + 1, OWN_IDS_FROM + 2, OWN_IDS_FROM + 3];

function setup({ draws = OWN } = {}) {
    let now = NOW;
    const db = sqliteD1();
    const next = draws[Symbol.iterator]();
    return { db, accounts: createAccounts(db, () => now, () => next.next().value), advance: (ms) => { now += ms; } };
}

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
// An account's row alone, as the code before identities made one under its GitHub id.
const rowAlone = (db, { id, login }) => db.prepare('INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)').bind(id, login, AT);
// An account made before identities, with the identity migrations/0002 gave every account of then.
const accountOfToday = (db, { id, login }) => db.batch([
    rowAlone(db, { id, login }),
    db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', ?1, ?2, ?3)").bind(String(id), Number(id), AT),
]);
const signedInAs = (id, login, blocked = false) => ({ user: { id: String(id), login, blocked } });

test('makes an account of crossbind\'s own at a GitHub account\'s first sign-in, and keeps its name current', async () => {
    const { db, accounts, advance } = setup();

    const first = await accounts.signIn(github);
    advance(MINUTE);
    const again = await accounts.signIn({ ...github, login: 'octocat-renamed' });

    assert.deepEqual([first, again], [signedInAs(OWN[0], 'octocat'), signedInAs(OWN[0], 'octocat-renamed')]);
    assert.deepEqual(await rows(db, 'SELECT * FROM users'), [{
        id: OWN[0], login: 'octocat-renamed', created_at: '2026-10-08T12:00:00.000Z', last_login_at: '2026-10-08T12:01:00.000Z', blocked: 0, signed_out_at: null,
    }]);
    assert.deepEqual(await rows(db, 'SELECT * FROM identities'), [{
        provider: 'github', subject: '583231', user_id: OWN[0], created_at: '2026-10-08T12:00:00.000Z', unlinked_at: null,
    }]);
});

test('signs an account made before identities in as itself, by its identity and never by a GitHub id', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);
    // An account of crossbind's own, and one a rollback to the code before identities made under its GitHub id.
    await accounts.signIn(madeUp);
    await rowAlone(db, { id: madeUp.subject, login: madeUp.login }).run();

    assert.deepEqual(await accounts.signIn(github), signedInAs(octocat.id, 'octocat'));
    assert.deepEqual(await accounts.signIn(madeUp), signedInAs(OWN[0], 'made_up_two'));
    assert.deepEqual(await rows(db, 'SELECT subject, user_id FROM identities ORDER BY subject'), [
        { subject: '583231', user_id: 583231 },
        { subject: '8000000002', user_id: OWN[0] },
    ]);
});

test('reports a blocked account at sign-in and when asked', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);
    await db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(583231).run();

    assert.deepEqual(await accounts.signIn(github), signedInAs(octocat.id, 'octocat', true));
    assert.deepEqual(await accounts.standing('583231'), {
        exists: true, blocked: true, login: 'octocat', signedOutAt: null,
    });
    assert.deepEqual(await accounts.standing('1'), {
        exists: false, blocked: false, login: '', signedOutAt: null,
    });
});

test('draws a new account\'s id again while an account, or a deleted account\'s identity or seconds, name it', async () => {
    const [live, held, spent] = [OWN_IDS_FROM + 7, OWN_IDS_FROM + 8, OWN_IDS_FROM + 9];
    const { db, accounts } = setup({ draws: [live, OWN[0], held, OWN[1], spent, OWN[2]] });
    const identity = (subject, id) => db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', ?, ?, ?)").bind(subject, id, AT).run();
    await db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, 'made_up_live', ?2, ?2)").bind(live, AT).run();
    await identity('8000000001', live);
    await identity('8000000009', held);
    await db.prepare("INSERT INTO build_usage (user_id, month, image, seconds) VALUES (?, '2026-10', 'web', 60)").bind(spent).run();

    const made = [];
    for (const subject of ['8000000003', '8000000004', '8000000005']) made.push(await accounts.signIn({ provider: 'github', subject, login: 'made_up_dev' }));

    assert.deepEqual(made, OWN.map((id) => signedInAs(id, 'made_up_dev')));
    assert.deepEqual(await rows(db, 'SELECT id, login FROM users ORDER BY id'), [...OWN.map((id) => ({ id, login: 'made_up_dev' })), { id: live, login: 'made_up_live' }]);
    assert.deepEqual(await rows(db, 'SELECT subject, user_id FROM identities ORDER BY subject'), [
        { subject: '8000000001', user_id: live },
        { subject: '8000000003', user_id: OWN[0] },
        { subject: '8000000004', user_id: OWN[1] },
        { subject: '8000000005', user_id: OWN[2] },
        { subject: '8000000009', user_id: held },
    ]);
});

test('makes no account after three ids drawn are taken', async () => {
    const live = OWN_IDS_FROM + 7;
    const { db, accounts } = setup({ draws: [live, live, live, OWN[0]] });
    await rowAlone(db, { id: live, login: 'made_up_live' }).run();

    await assert.rejects(accounts.signIn(github), /no account could be made for this github sign-in/);
    assert.deepEqual(await rows(db, 'SELECT id FROM users'), [{ id: live }]);
});

test('draws ids of crossbind\'s own evenly, from 2^40 up to and not including 2^53, each exact in JavaScript', async (t) => {
    const ids = Array.from({ length: 10_000 }, () => randomAccountId());
    const { user } = await createAccounts(sqliteD1(), () => NOW).signIn(github);

    assert.ok(ids.every((id) => Number.isSafeInteger(id) && id >= OWN_IDS_FROM && id < OWN_IDS_BELOW));
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.some((id) => id >= 2 ** 52) && ids.some((id) => id < 2 ** 52));
    assert.ok(Number(user.id) >= OWN_IDS_FROM && Number(user.id) < OWN_IDS_BELOW, user.id);
    // The words drawn: below 2^40 again, the highest id, 2^40 - 1 again, and 2^40.
    const words = [[0, 5], [2 ** 32 - 1, 2 ** 32 - 1], [2 ** 19 - 1, 2 ** 32 - 1], [2 ** 19, 0]];
    t.mock.method(crypto, 'getRandomValues', (array) => {
        array.set(words.shift());
        return array;
    });
    assert.deepEqual([randomAccountId(), randomAccountId()], [OWN_IDS_BELOW - 1, OWN_IDS_FROM]);
});

test('makes one account when two first sign-ins of one GitHub account meet, the later signing in to the other\'s', async () => {
    const db = sqliteD1();
    const other = OWN_IDS_FROM + 5;
    let met = false;
    // The other sign-in makes the account between this one's look-up and its INSERT.
    const meeting = {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
            if (!met) {
                met = true;
                await db.batch([
                    db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, 'octocat', ?2, ?2)").bind(other, AT),
                    db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', '583231', ?, ?)").bind(other, AT),
                ]);
            }
            return db.batch(statements);
        },
    };

    assert.deepEqual(await createAccounts(meeting, () => NOW, () => OWN[0]).signIn(github), signedInAs(other, 'octocat'));
    assert.deepEqual(await rows(db, 'SELECT id FROM users'), [{ id: other }]);
    assert.deepEqual(await rows(db, 'SELECT subject, user_id FROM identities'), [{ subject: '583231', user_id: other }]);
});

test('brings an account deleted this month back under its id while its seconds hold its identity, and frees one without seconds at once', async () => {
    const { accounts } = setup();
    const { user: spent } = await accounts.signIn(github);
    const { user: idle } = await accounts.signIn(madeUp);
    await accounts.addBuildSeconds(spent.id, NOW, 'web', 600);
    await accounts.deleteAccount(spent.id);
    await accounts.deleteAccount(idle.id);

    const back = await accounts.signIn(github);
    const fresh = await accounts.signIn(madeUp);

    assert.deepEqual(back, signedInAs(OWN[0], 'octocat'));
    assert.equal((await accounts.buildBudget(spent.id, NOW)).mine, 600);
    assert.deepEqual(fresh, signedInAs(OWN[2], 'made_up_two'));
});

test('signs an identity unlinked from an account with build seconds this month in to nothing until the 1st, then makes it an account', async () => {
    const { db, accounts, advance } = setup({ draws: [OWN[1]] });
    // An account that unlinked its GitHub account this month, signing in with its Apple ID since.
    await db.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, '', ?2, ?2)").bind(OWN[0], AT).run();
    await db.prepare(`INSERT INTO identities (provider, subject, user_id, created_at, unlinked_at)
        VALUES ('apple', '000123.made-up.0456', ?1, ?2, NULL), ('github', '583231', ?1, ?2, ?2)`).bind(OWN[0], AT).run();
    await accounts.addBuildSeconds(String(OWN[0]), NOW, 'web', 60);

    const held = await accounts.signIn(github);
    const whileHeld = await rows(db, 'SELECT id FROM users');
    advance(Date.parse('2026-11-01T00:00:00Z') - NOW);
    const free = await accounts.signIn(github);

    assert.deepEqual(held, { freeFrom: '2026-11-01' });
    assert.deepEqual(whileHeld, [{ id: OWN[0] }]);
    assert.deepEqual(free, signedInAs(OWN[1], 'octocat'));
    assert.deepEqual(await rows(db, 'SELECT provider, user_id, unlinked_at FROM identities ORDER BY provider'), [
        { provider: 'apple', user_id: OWN[0], unlinked_at: null },
        { provider: 'github', user_id: OWN[1], unlinked_at: null },
    ]);
});

test('issues a token it keeps only as a hash, and finds the account by it', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);

    const token = await accounts.issueToken(octocat.id);

    assert.match(token, /^cbt_[A-Za-z0-9_-]{43}$/);
    const [stored] = await rows(db, 'SELECT hash FROM tokens');
    assert.match(stored.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(await accounts.userOfToken(token), { ...octocat, blocked: false, kind: 'cli' });
});

test('reads a token\'s kind, the CLI\'s for every token it issues', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);
    const app = await accounts.issueToken(octocat.id);
    await db.prepare("UPDATE tokens SET kind = 'app'").run();
    const cli = await accounts.issueToken(octocat.id);

    assert.deepEqual(await accounts.userOfToken(cli), { ...octocat, blocked: false, kind: 'cli' });
    assert.deepEqual(await accounts.userOfToken(app), { ...octocat, blocked: false, kind: 'app' });
});

test('finds no account for an unknown, malformed or revoked token', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);
    const token = await accounts.issueToken(octocat.id);

    await accounts.revokeToken(token);

    assert.equal(await accounts.userOfToken(token), null);
    assert.equal(await accounts.userOfToken(`cbt_${'A'.repeat(43)}`), null);
    assert.equal(await accounts.userOfToken('not-a-token'), null);
    assert.equal(await accounts.userOfToken(undefined), null);
});

test('signs one account out everywhere, every token and the cookies made before that moment, and no other', async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    await accountOfToday(db, { id: '1', login: 'mojombo' });
    const mine = [await accounts.issueToken(octocat.id), await accounts.issueToken(octocat.id)];
    const theirs = await accounts.issueToken('1');
    advance(MINUTE);

    await accounts.signOutEverywhere(octocat.id);

    assert.deepEqual(await Promise.all(mine.map((token) => accounts.userOfToken(token))), [null, null]);
    assert.equal((await accounts.userOfToken(theirs)).login, 'mojombo');
    assert.deepEqual([(await accounts.standing(octocat.id)).signedOutAt, (await accounts.standing('1')).signedOutAt], ['2026-10-08T12:01:00.000Z', null]);
});

test('lists an account\'s devices by their last use, each by the start of its token\'s hash, and signs out its own alone', async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    await accountOfToday(db, { id: '1', login: 'mojombo' });
    const older = await accounts.issueToken(octocat.id);
    advance(DAY);
    const newer = await accounts.issueToken(octocat.id);
    const theirs = await accounts.issueToken('1');
    const refOf = (token) => createHash('sha256').update(token).digest('hex').slice(0, DEVICE_REF_LENGTH);

    const devices = await accounts.devices(octocat.id);
    const outcomes = [await accounts.revokeDevice(octocat.id, refOf(theirs)), await accounts.revokeDevice(octocat.id, refOf(older))];

    assert.deepEqual(devices, [
        { ref: refOf(newer), kind: 'cli', label: 'crossbind CLI', createdAt: '2026-10-09T12:00:00.000Z', lastUsedAt: '2026-10-09T12:00:00.000Z' },
        { ref: refOf(older), kind: 'cli', label: 'crossbind CLI', createdAt: AT, lastUsedAt: AT },
    ]);
    assert.deepEqual(outcomes, [false, true]);
    assert.deepEqual(await Promise.all([older, newer, theirs].map(async (token) => (await accounts.userOfToken(token))?.login ?? null)), [null, 'octocat', 'mojombo']);
});

test(`keeps the ${MAX_TOKENS_PER_USER} most recently used tokens of an account`, async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    const tokens = [];
    for (let count = 0; count <= MAX_TOKENS_PER_USER; count += 1) {
        tokens.push(await accounts.issueToken(octocat.id));
        advance(MINUTE);
    }

    assert.equal((await rows(db, 'SELECT hash FROM tokens')).length, MAX_TOKENS_PER_USER);
    assert.equal(await accounts.userOfToken(tokens[0]), null);
    assert.notEqual(await accounts.userOfToken(tokens[1]), null);
});

test('notes when a token was last used, at most once an hour', async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    const token = await accounts.issueToken(octocat.id);
    const lastUsed = async () => (await rows(db, 'SELECT last_used_at FROM tokens'))[0].last_used_at;

    advance(30 * MINUTE);
    await accounts.userOfToken(token);
    const early = await lastUsed();
    advance(60 * MINUTE);
    await accounts.userOfToken(token);

    assert.equal(early, '2026-10-08T12:00:00.000Z');
    assert.equal(await lastUsed(), '2026-10-08T13:30:00.000Z');
});

test(`forgets a token unused for ${TOKEN_IDLE_DAYS} days, and keeps one in use`, async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    const used = await accounts.issueToken(octocat.id);
    const idle = await accounts.issueToken(octocat.id);

    advance((TOKEN_IDLE_DAYS - 1) * DAY);
    await accounts.userOfToken(used);
    advance(2 * DAY);

    assert.notEqual(await accounts.userOfToken(used), null);
    assert.equal(await accounts.userOfToken(idle), null);
    assert.equal((await rows(db, 'SELECT hash FROM tokens')).length, 1);
});

test('adds a runner\'s seconds to its user, image and month, and to everyone\'s month and day', async () => {
    const { accounts } = setup();
    const nextDay = NOW + DAY;

    await accounts.addBuildSeconds(octocat.id, NOW, 'web', 30);
    await accounts.addBuildSeconds(octocat.id, NOW, 'web', 12.5);
    await accounts.addBuildSeconds(octocat.id, nextDay, 'android', 60);
    await accounts.addBuildSeconds('1', NOW, 'web', 100);

    assert.deepEqual(await accounts.buildSeconds(octocat.id, '2026-10'), { web: 42.5, android: 60 });
    assert.deepEqual(await accounts.buildBudget(octocat.id, NOW), { mine: 102.5, everyone: 202.5, today: 142.5 });
    assert.deepEqual(await accounts.buildBudget(octocat.id, nextDay), { mine: 102.5, everyone: 202.5, today: 60 });
    assert.deepEqual(await accounts.buildBudget('2', Date.parse('2026-11-01T00:00:00Z')), { mine: 0, everyone: 0, today: 0 });
});

test('deletes an account and every token of it, keeping only the month\'s seconds under the bare id', async () => {
    const { db, accounts } = setup();
    await accountOfToday(db, octocat);
    const token = await accounts.issueToken(octocat.id);
    await accounts.addBuildSeconds(octocat.id, NOW, 'web', 60);
    await accounts.addBuildSeconds(octocat.id, Date.parse('2026-08-08T12:00:00Z'), 'web', 30);

    await accounts.deleteAccount(octocat.id);

    assert.equal(await accounts.userOfToken(token), null);
    assert.deepEqual(await rows(db, 'SELECT * FROM users'), []);
    assert.deepEqual(await rows(db, 'SELECT user_id, month, seconds FROM build_usage'), [{ user_id: 583231, month: '2026-10', seconds: 60 }]);
});

test('keeps a blocked account as its bare id, so deleting it does not lift the block, and its refused sign-in writes nothing', async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    await db.prepare('UPDATE users SET blocked = 1').run();

    await accounts.deleteAccount(octocat.id);
    const kept = await rows(db, 'SELECT id, login, last_login_at, blocked FROM users');
    advance(MINUTE);
    const again = await accounts.signIn(github);

    assert.deepEqual(kept, [{ id: 583231, login: '', last_login_at: AT, blocked: 1 }]);
    assert.equal(again.user.blocked, true);
    assert.deepEqual(await rows(db, 'SELECT id, login, last_login_at, blocked FROM users'), kept);
});

test('prunes tokens unused for 90 days, seconds older than three months, and a deleted account\'s seconds once its month ends', async () => {
    const { db, accounts, advance } = setup();
    await accountOfToday(db, octocat);
    await accountOfToday(db, { id: '1', login: 'mojombo' });
    const stale = await accounts.issueToken(octocat.id);
    advance(91 * DAY);
    const fresh = await accounts.issueToken(octocat.id);
    const insert = (id, month, seconds) => db.prepare('INSERT INTO build_usage (user_id, month, image, seconds) VALUES (?, ?, ?, ?)').bind(id, month, 'web', seconds).run();
    await insert(583231, '2026-08', 10);
    await insert(583231, '2026-10', 20);
    await insert(583231, '2027-01', 30);
    await insert(2, '2026-12', 40);
    await insert(2, '2027-01', 50);

    await accounts.prune();

    assert.equal((await rows(db, 'SELECT hash FROM tokens')).length, 1);
    assert.notEqual(await accounts.userOfToken(fresh), null);
    assert.equal(await accounts.userOfToken(stale), null);
    assert.deepEqual(await rows(db, 'SELECT user_id, month FROM build_usage ORDER BY user_id, month'), [
        { user_id: 2, month: '2027-01' },
        { user_id: 583231, month: '2026-10' },
        { user_id: 583231, month: '2027-01' },
    ]);
});

test('adds up the build seconds of one month by toolchain image', async () => {
    const { db, accounts } = setup();
    const insert = (month, image, seconds) => db.prepare('INSERT INTO build_usage (user_id, month, image, seconds) VALUES (?, ?, ?, ?)').bind(583231, month, image, seconds).run();
    await insert('2026-10', 'web', 125.5);
    await insert('2026-10', 'android', 60);
    await insert('2026-09', 'web', 3000);

    assert.deepEqual(await accounts.buildSeconds(octocat.id, '2026-10'), { web: 125.5, android: 60 });
    assert.deepEqual(await accounts.buildSeconds('1', '2026-10'), {});
});
