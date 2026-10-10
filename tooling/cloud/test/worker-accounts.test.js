import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, MAX_TOKENS_PER_USER, TOKEN_IDLE_DAYS } from '../worker/accounts.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const octocat = { id: '583231', login: 'octocat' };

function setup() {
    let now = NOW;
    const db = sqliteD1();
    return { db, accounts: createAccounts(db, () => now), advance: (ms) => { now += ms; } };
}

const rows = async (db, sql) => (await db.prepare(sql).all()).results;

test('records a GitHub account at its first sign-in and keeps its name current', async () => {
    const { db, accounts, advance } = setup();

    assert.deepEqual(await accounts.signIn(octocat), { ...octocat, blocked: false });
    advance(MINUTE);
    await accounts.signIn({ ...octocat, login: 'octocat-renamed' });

    assert.deepEqual(await rows(db, 'SELECT * FROM users'), [{
        id: 583231, login: 'octocat-renamed', created_at: '2026-10-08T12:00:00.000Z', last_login_at: '2026-10-08T12:01:00.000Z', blocked: 0,
    }]);
});

test('reports a blocked account at sign-in and when asked', async () => {
    const { db, accounts } = setup();
    await accounts.signIn(octocat);
    await db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(583231).run();

    assert.deepEqual(await accounts.signIn(octocat), { ...octocat, blocked: true });
    assert.deepEqual(await accounts.standing('583231'), { exists: true, blocked: true });
    assert.deepEqual(await accounts.standing('1'), { exists: false, blocked: false });
});

test('issues a token it keeps only as a hash, and finds the account by it', async () => {
    const { db, accounts } = setup();
    await accounts.signIn(octocat);

    const token = await accounts.issueToken(octocat.id);

    assert.match(token, /^cbt_[A-Za-z0-9_-]{43}$/);
    const [stored] = await rows(db, 'SELECT hash FROM tokens');
    assert.match(stored.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(await accounts.userOfToken(token), { ...octocat, blocked: false });
});

test('finds no account for an unknown, malformed or revoked token', async () => {
    const { accounts } = setup();
    await accounts.signIn(octocat);
    const token = await accounts.issueToken(octocat.id);

    await accounts.revokeToken(token);

    assert.equal(await accounts.userOfToken(token), null);
    assert.equal(await accounts.userOfToken(`cbt_${'A'.repeat(43)}`), null);
    assert.equal(await accounts.userOfToken('not-a-token'), null);
    assert.equal(await accounts.userOfToken(undefined), null);
});

test('revokes every token of one account and no other', async () => {
    const { accounts } = setup();
    await accounts.signIn(octocat);
    await accounts.signIn({ id: '1', login: 'mojombo' });
    const mine = [await accounts.issueToken(octocat.id), await accounts.issueToken(octocat.id)];
    const theirs = await accounts.issueToken('1');

    await accounts.revokeTokens(octocat.id);

    assert.deepEqual(await Promise.all(mine.map((token) => accounts.userOfToken(token))), [null, null]);
    assert.equal((await accounts.userOfToken(theirs)).login, 'mojombo');
});

test(`keeps the ${MAX_TOKENS_PER_USER} most recently used tokens of an account`, async () => {
    const { db, accounts, advance } = setup();
    await accounts.signIn(octocat);
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
    await accounts.signIn(octocat);
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
    await accounts.signIn(octocat);
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
    await accounts.signIn(octocat);
    const token = await accounts.issueToken(octocat.id);
    await accounts.addBuildSeconds(octocat.id, NOW, 'web', 60);
    await accounts.addBuildSeconds(octocat.id, Date.parse('2026-08-08T12:00:00Z'), 'web', 30);

    await accounts.deleteAccount(octocat.id);

    assert.equal(await accounts.userOfToken(token), null);
    assert.deepEqual(await rows(db, 'SELECT * FROM users'), []);
    assert.deepEqual(await rows(db, 'SELECT user_id, month, seconds FROM build_usage'), [{ user_id: 583231, month: '2026-10', seconds: 60 }]);
});

test('keeps a blocked account as its bare id, so deleting it does not lift the block', async () => {
    const { db, accounts } = setup();
    await accounts.signIn(octocat);
    await db.prepare('UPDATE users SET blocked = 1').run();

    await accounts.deleteAccount(octocat.id);
    const kept = await rows(db, 'SELECT id, login, blocked FROM users');
    const again = await accounts.signIn(octocat);

    assert.deepEqual(kept, [{ id: 583231, login: '', blocked: 1 }]);
    assert.equal(again.blocked, true);
});

test('prunes tokens unused for 90 days, seconds older than three months, and a deleted account\'s seconds once its month ends', async () => {
    const { db, accounts, advance } = setup();
    await accounts.signIn(octocat);
    await accounts.signIn({ id: '1', login: 'mojombo' });
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
