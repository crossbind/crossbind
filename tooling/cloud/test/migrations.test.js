import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createAccounts } from '../worker/accounts.js';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const migration = (name) => fs.readFileSync(new URL(name, MIGRATIONS), 'utf8');
const IDENTITIES = '0002_identities_and_sessions.sql';
// Where ids of crossbind's own start, above every GitHub id.
const OWN_IDS_FROM = 2 ** 40;
const NOW = Date.parse('2026-11-20T10:00:00Z');
const AT = new Date(NOW).toISOString();
// Made-up accounts: ids of ten digits, and names with an underscore, which no GitHub login has.
const dev = { id: '8000000001', login: 'made_up_dev' };

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const rowsOf = (db, sql) => db.prepare(sql).all().map((row) => ({ ...row }));
const github = (id, createdAt) => ({ provider: 'github', subject: String(id), user_id: id, created_at: createdAt, unlinked_at: null });
// An account's row alone, as the code before identities made one under its GitHub id; on a database as 0002 left it,
// its trigger gives the row its identity.
const rowAlone = (db, { id, login }) => db.prepare('INSERT INTO users (id, login, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)').bind(id, login, AT);
// That account with the identity 0002 gave it.
const accountOfToday = (db, { id, login }) => db.batch([
    rowAlone(db, { id, login }),
    db.prepare("INSERT INTO identities (provider, subject, user_id, created_at) VALUES ('github', ?1, ?2, ?3)").bind(String(id), Number(id), AT),
]);
// A database as 0002 left it, for the tests of what 0002 did.
const SECOND_MIGRATION_ONLY = { before: '0003' };

// A database as 0001 leaves it, as every deployed one was before 0002.
function databaseBefore() {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(migration('0001_accounts.sql'));
    return db;
}

test('gives every account, and every account deleted this month that has seconds, its GitHub identity under its id', () => {
    const db = databaseBefore();
    db.exec(`INSERT INTO users (id, login, created_at, last_login_at, blocked) VALUES
            (8000000001, 'made_up_dev', '2025-01-02T00:00:00.000Z', '2026-11-01T00:00:00.000Z', 0),
            (8000000002, 'made_up_two', '2025-03-04T00:00:00.000Z', '2026-11-02T00:00:00.000Z', 0),
            (8000000003, '', '2025-05-06T00:00:00.000Z', '2026-10-03T00:00:00.000Z', 1);
        INSERT INTO tokens (hash, user_id, created_at, last_used_at) VALUES
            ('aa', 8000000001, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
            ('bb', 8000000002, '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z');
        INSERT INTO build_usage (user_id, month, image, seconds) VALUES
            (8000000001, '2026-09', 'web', 30), (8000000001, '2026-11', 'web', 120), (8000000009, '2026-11', 'android', 600);`);
    const before = new Date().toISOString();

    db.exec(migration(IDENTITIES));

    const after = new Date().toISOString();
    const identities = rowsOf(db, 'SELECT * FROM identities ORDER BY user_id');
    const migratedAt = identities.at(-1).created_at;
    assert.ok(before <= migratedAt && migratedAt <= after, `${migratedAt} is not the time the migration ran`);
    assert.deepEqual(identities, [
        github(8000000001, '2025-01-02T00:00:00.000Z'),
        github(8000000002, '2025-03-04T00:00:00.000Z'),
        github(8000000003, '2025-05-06T00:00:00.000Z'),
        github(8000000009, migratedAt),
    ]);
    assert.deepEqual(rowsOf(db, 'SELECT hash, kind, label FROM tokens ORDER BY hash'), [
        { hash: 'aa', kind: 'cli', label: 'crossbind CLI' },
        { hash: 'bb', kind: 'cli', label: 'crossbind CLI' },
    ]);
    assert.deepEqual(rowsOf(db, `SELECT (SELECT count(*) FROM users WHERE signed_out_at IS NOT NULL) AS signedOut,
        (SELECT count(*) FROM device_codes) AS deviceCodes, (SELECT count(*) FROM sessions) AS sessions`), [{ signedOut: 0, deviceCodes: 0, sessions: 0 }]);
    assert.deepEqual(rowsOf(db, 'PRAGMA foreign_key_check'), []);
});

test('gives an account made under a GitHub id its identity, and an id of crossbind\'s own none', async () => {
    const db = sqliteD1(':memory:', SECOND_MIGRATION_ONLY);
    const insert = (id) => db.prepare('INSERT INTO users (id, login, created_at, last_login_at) VALUES (?, ?, ?, ?)').bind(id, '', AT, AT).run();

    for (const id of [8000000001, OWN_IDS_FROM - 1, OWN_IDS_FROM, Number.MAX_SAFE_INTEGER]) await insert(id);

    assert.deepEqual(await rows(db, 'SELECT * FROM identities ORDER BY user_id'), [github(8000000001, AT), github(OWN_IDS_FROM - 1, AT)]);
});

test('signs an account made before it in as itself through that identity, a deleted account that signs in again this month included', async () => {
    const db = sqliteD1();
    const accounts = createAccounts(db, () => NOW);
    const identity = { provider: 'github', subject: dev.id, login: dev.login };
    await accountOfToday(db, dev);
    await accounts.signIn(identity);
    await accounts.addBuildSeconds(dev.id, NOW, 'web', 600);
    await accounts.deleteAccount(dev.id);

    assert.deepEqual(await accounts.signIn(identity), { user: { ...dev, blocked: false } });
    const token = await accounts.issueToken(dev.id);

    assert.deepEqual(await accounts.userOfToken(token), { ...dev, blocked: false, kind: 'cli' });
    assert.deepEqual(await rows(db, 'SELECT kind, label FROM tokens'), [{ kind: 'cli', label: 'crossbind CLI' }]);
    assert.deepEqual(await rows(db, 'SELECT * FROM identities'), [github(8000000001, AT)]);
    assert.equal((await accounts.buildBudget(dev.id, NOW)).mine, 600);
});

test('takes an account\'s sessions and the device codes it approved with its row, and refuses either for no account', async () => {
    const db = sqliteD1();
    const accounts = createAccounts(db, () => NOW);
    await accountOfToday(db, dev);
    const session = (id, userId) => db.prepare(`INSERT INTO sessions (id, user_id, source, project_id, project_name, addresses, protocol, key, created_at, expires_at)
        VALUES (?, ?, 'snapshot', 'made-up-project', 'made-up-app', '[]', 1, 'made-up-key', ?, ?)`).bind(id, userId, AT, AT).run();
    const deviceCode = (hash, userCode, userId) => db.prepare(`INSERT INTO device_codes (hash, user_code, client, label, created_at, expires_at, user_id)
        VALUES (?, ?, 'app', 'crossbind app 1.0.0, iOS 27.1', ?, ?, ?)`).bind(hash, userCode, AT, AT, userId).run();
    await session('of-the-account', dev.id);
    await deviceCode('approved', 'NPCCCNQN', dev.id);
    await deviceCode('waiting', 'BCDFGHJK', null);

    await assert.rejects(session('of-no-account', '8000000099'), /FOREIGN KEY constraint failed/);
    await assert.rejects(deviceCode('of-no-account', 'LMNPQRST', '8000000099'), /FOREIGN KEY constraint failed/);
    await accounts.deleteAccount(dev.id);

    assert.deepEqual(await rows(db, 'SELECT id FROM sessions'), []);
    assert.deepEqual(await rows(db, 'SELECT hash, state FROM device_codes'), [{ hash: 'waiting', state: 'pending' }]);
});

test('holds one linked identity of each provider to an account, and one snapshot of a project to an account', async () => {
    const db = sqliteD1();
    const [mine, theirs] = [OWN_IDS_FROM + 1, OWN_IDS_FROM + 2];
    for (const id of [mine, theirs]) await db.prepare('INSERT INTO users (id, login, created_at, last_login_at) VALUES (?, ?, ?, ?)').bind(id, '', AT, AT).run();
    const identity = (provider, subject, userId, unlinkedAt = null) => db.prepare('INSERT INTO identities (provider, subject, user_id, created_at, unlinked_at) VALUES (?, ?, ?, ?, ?)')
        .bind(provider, subject, userId, AT, unlinkedAt).run();
    const session = (id, userId, source) => db.prepare(`INSERT INTO sessions (id, user_id, source, project_id, project_name, addresses, protocol, key, created_at, expires_at)
        VALUES (?, ?, ?, 'made-up-project', 'made-up-app', '[]', 1, 'made-up-key', ?, ?)`).bind(id, userId, source, AT, AT).run();

    await identity('github', '8000000001', mine);
    await identity('apple', '000123.made-up.0456', mine);
    await identity('github', '8000000002', mine, AT);
    await session('dev-1', mine, 'dev');
    await session('dev-2', mine, 'dev');
    await session('snapshot', mine, 'snapshot');
    await session('their-snapshot', theirs, 'snapshot');

    await assert.rejects(identity('github', '8000000003', mine), /UNIQUE constraint failed/);
    await assert.rejects(identity('github', '8000000001', theirs), /UNIQUE constraint failed/);
    await assert.rejects(session('second-snapshot', mine, 'snapshot'), /UNIQUE constraint failed/);
    assert.deepEqual(await rows(db, 'SELECT count(*) AS identities, (SELECT count(*) FROM sessions) AS sessions FROM identities'), [{ identities: 3, sessions: 4 }]);
});

test('takes a deleted account\'s identities with its row, or with the prune of its last seconds, and never a live or blocked account\'s', async () => {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    const holders = async () => (await rows(db, 'SELECT user_id FROM identities ORDER BY user_id')).map((row) => row.user_id);
    const [idle, spent, live, blocked, late] = ['8000000001', '8000000002', '8000000003', '8000000004', '8000000005'];
    for (const id of [idle, spent, live, blocked, late]) await accountOfToday(db, { id, login: `made_up_${id.at(-1)}` });
    await accounts.addBuildSeconds(spent, NOW, 'web', 600);
    await accounts.addBuildSeconds(live, Date.parse('2026-07-10T10:00:00Z'), 'web', 10);
    await db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(blocked).run();

    for (const id of [idle, spent, blocked]) await accounts.deleteAccount(id);
    const afterDeletion = await holders();
    const { user: back } = await accounts.signIn({ provider: 'github', subject: spent, login: 'made_up_2' });
    const monthSpent = (await accounts.buildBudget(spent, now)).mine;
    await accounts.deleteAccount(spent);
    // An account deleted as the month ends, whose runner is metered once more, into the next month.
    now = Date.parse('2026-11-30T23:59:00Z');
    await accounts.addBuildSeconds(late, now, 'web', 60);
    await accounts.deleteAccount(late);
    await accounts.addBuildSeconds(late, Date.parse('2026-12-01T00:00:30Z'), 'web', 30);
    now = Date.parse('2026-12-02T03:17:00Z');
    await accounts.prune();

    assert.deepEqual(afterDeletion, [8000000002, 8000000003, 8000000004, 8000000005]);
    assert.deepEqual(back, { id: spent, login: 'made_up_2', blocked: false });
    assert.equal(monthSpent, 600);
    assert.deepEqual(await holders(), [8000000003, 8000000004, 8000000005]);
});

// What a later migration would run to take 0002 back.
const UNDO = [
    'DROP TRIGGER users_github_identity',
    'DROP TRIGGER users_deleted_identities',
    'DROP TRIGGER build_usage_gone_identities',
    'DROP TABLE sessions',
    'DROP TABLE device_codes',
    'DROP TABLE identities',
    'ALTER TABLE tokens DROP COLUMN label',
    'ALTER TABLE tokens DROP COLUMN kind',
    'ALTER TABLE users DROP COLUMN signed_out_at',
];
const SCHEMA = 'SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY name';

test('only adds: dropping what it added leaves the schema before it, with its accounts and tokens', async () => {
    const db = sqliteD1(':memory:', SECOND_MIGRATION_ONLY);
    const accounts = createAccounts(db, () => NOW);
    await rowAlone(db, dev).run();
    await accounts.issueToken(dev.id);

    for (const statement of UNDO) await db.prepare(statement).run();
    await accounts.issueToken(dev.id);

    assert.deepEqual(await rows(db, SCHEMA), rowsOf(databaseBefore(), SCHEMA));
    // A token made before the undo and one made after it, read as the code before identities read them.
    assert.deepEqual(await rows(db, 'SELECT users.id, users.login, users.blocked FROM tokens JOIN users ON users.id = tokens.user_id'), [
        { id: 8000000001, login: 'made_up_dev', blocked: 0 },
        { id: 8000000001, login: 'made_up_dev', blocked: 0 },
    ]);
});

test('leaves no trigger that gives an account made under a GitHub id an identity, and the rest as 0002 left it', async () => {
    const db = sqliteD1();
    const before = sqliteD1(':memory:', SECOND_MIGRATION_ONLY);

    await rowAlone(db, dev).run();

    assert.deepEqual(await rows(db, 'SELECT * FROM identities'), []);
    assert.deepEqual(await rows(db, SCHEMA), (await rows(before, SCHEMA)).filter((row) => row.name !== 'users_github_identity'));
});
