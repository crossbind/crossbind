import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import {
    createProjectSessions, isLocalAddress, DEV_SESSION_SECONDS, MAX_SESSIONS_PER_ACCOUNT,
} from '../worker/project-sessions.js';
import { createQuota } from '../worker/quota.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import { isLocalSource } from '../../../core/crossbind/src/utils/previewAddress.js';

// The sessions crossbind app preview registers for an account's devices: the CLI's token registers, renews and removes
// one, the crossbind app's lists them with their keys, and nothing of one reaches another account.

const API = 'https://api.crossbind.dev';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const MINUTE = 60 * 1000;
const LIFE_MS = DEV_SESSION_SECONDS * 1000;
// Made-up GitHub accounts: ids of ten digits, and names with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const other = { provider: 'github', subject: '8000000002', login: 'made_up_other' };
const NO_SESSION = 'No session of this account has this id.';
const unlimited = { limit: async () => ({ success: true }) };

const newId = () => randomBytes(16).toString('base64url');
const newKey = () => randomBytes(32).toString('base64url');
const devSession = (more = {}) => ({
    source: 'dev', project: { id: newId(), name: 'made-up-app' }, addresses: ['192.168.1.6:5173'], protocol: 1, key: newKey(), ...more,
});

function setup() {
    let now = NOW;
    const db = sqliteD1();
    const accounts = createAccounts(db, () => now);
    const deps = {
        limits: { api: unlimited },
        accounts,
        sessions: createProjectSessions(db, () => now),
        quota: createQuota(memoryStorage(), () => now),
        now: () => now,
    };
    const call = async (method, path, { token, body } = {}) => {
        const response = await handleRequest(new Request(`${API}${path}`, {
            method,
            headers: {
                'cf-connecting-ip': '203.0.113.7',
                ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
                ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
        }), {}, deps);
        return { status: response.status, body: response.status === 204 ? null : await response.json() };
    };
    // An account signed in on a machine with crossbind login and on a device with the crossbind app.
    const signedIn = async (identity) => {
        const { user } = await accounts.signIn(identity);
        return {
            user,
            cli: await accounts.issueToken(user.id),
            app: await accounts.issueToken(user.id, { kind: 'app', label: 'crossbind app 1.0.0 on iOS 27.1' }),
        };
    };
    return {
        db, accounts, deps, call, signedIn, advance: (ms) => { now += ms; },
    };
}

const count = async (db) => (await db.prepare('SELECT count(1) AS rows FROM sessions').first('rows'));

// A database on which a statement that reads the sessions alone waits until `together` such reads are waiting, or 50 ms
// have passed, as reads of requests sent at once may all come before any of their writes: a count read in a statement
// of its own then sees none of the others' sessions.
function racing(db, together) {
    let waiting = [];
    const release = () => {
        waiting.forEach((go) => go());
        waiting = [];
    };
    const held = (statement) => ({
        ...statement,
        bind: (...values) => held(statement.bind(...values)),
        async first(...args) {
            await new Promise((go) => {
                waiting.push(go);
                if (waiting.length >= together) release();
                else setTimeout(release, 50);
            });
            return statement.first(...args);
        },
    });
    return { ...db, prepare: (sql) => (/^\s*SELECT\b.*\bFROM sessions\b/s.test(sql) ? held(db.prepare(sql)) : db.prepare(sql)) };
}

test('registers a dev session with the CLI\'s token, and lists it with its key for the account\'s crossbind app, the newest first', async () => {
    const { call, signedIn, advance } = setup();
    const { cli, app } = await signedIn(dev);
    const [first, second] = [newId(), newId()];
    const [sentFirst, sentSecond] = [devSession(), devSession({ project: { id: newId(), name: '@made-up/second app' }, addresses: ['[fd00::6]:5174', 'made-up.local:5174'] })];

    const registered = await call('PUT', `/v1/sessions/${first}`, { token: cli, body: sentFirst });
    advance(MINUTE);
    await call('PUT', `/v1/sessions/${second}`, { token: cli, body: sentSecond });
    const listed = await call('GET', '/v1/sessions', { token: app });
    const found = await call('GET', `/v1/sessions/${first}`, { token: app });

    assert.deepEqual(registered, { status: 200, body: { id: first, expiresAt: new Date(NOW + LIFE_MS).toISOString() } });
    const asListed = (id, sent, at) => ({
        id, source: 'dev', project: sent.project, addresses: sent.addresses, protocol: 1, key: sent.key, version: 0, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + LIFE_MS).toISOString(),
    });
    assert.deepEqual(listed, { status: 200, body: { sessions: [asListed(second, sentSecond, NOW + MINUTE), asListed(first, sentFirst, NOW)] } });
    assert.deepEqual(found, { status: 200, body: asListed(first, sentFirst, NOW) });
});

test('renews a session for the run that registered it, and refuses its id to another run or account in words that name neither', async () => {
    const { call, signedIn, advance } = setup();
    const owner = await signedIn(dev);
    const stranger = await signedIn(other);
    const id = newId();
    const sent = devSession();

    await call('PUT', `/v1/sessions/${id}`, { token: owner.cli, body: sent });
    advance(5 * MINUTE);
    const renewed = await call('PUT', `/v1/sessions/${id}`, { token: owner.cli, body: { ...sent, addresses: ['10.0.0.9:5173'] } });
    const anotherRun = await call('PUT', `/v1/sessions/${id}`, { token: owner.cli, body: { ...sent, key: newKey() } });
    const anotherAccount = await call('PUT', `/v1/sessions/${id}`, { token: stranger.cli, body: sent });
    const { body: session } = await call('GET', `/v1/sessions/${id}`, { token: owner.app });

    assert.deepEqual(renewed, { status: 200, body: { id, expiresAt: new Date(NOW + 5 * MINUTE + LIFE_MS).toISOString() } });
    const taken = { status: 409, body: { error: 'This session id is in use by another run; make a new one.' } };
    assert.deepEqual(anotherRun, taken);
    assert.deepEqual(anotherAccount, taken);
    assert.deepEqual([session.addresses, session.key, session.createdAt], [['10.0.0.9:5173'], sent.key, new Date(NOW).toISOString()]);
});

test('refuses a session out of its form, and writes nothing', async () => {
    const { db, call, signedIn } = setup();
    const { cli } = await signedIn(dev);
    const key = newKey();
    // A key of 32 bytes whose last character carries bits past them: it decodes to the same bytes as another text.
    const looseKey = `${key.slice(0, 42)}${key.at(-1) === 'B' ? 'C' : 'B'}`;
    const bodies = [
        'not JSON', [], null,
        devSession({ source: 'snapshot' }), devSession({ source: undefined }),
        devSession({ project: undefined }), devSession({ project: { id: newId().slice(1), name: 'made-up-app' } }),
        ...['', 'm'.repeat(65), 'made-up\u0007app', 'made-up<app>', 'made-up‮app'].map((name) => devSession({ project: { id: newId(), name } })),
        devSession({ addresses: [] }), devSession({ addresses: '192.168.1.6:5173' }), devSession({ addresses: Array(5).fill('192.168.1.6:5173') }),
        ...['8.8.8.8:5173', '127.0.0.1:5173', 'localhost:5173', '[::1]:5173', '[fe80::1]:5173', '[2001:db8::1]:5173', 'made-up.example:5173',
            '192.168.1.6', '192.168.1.6:0', '192.168.1.6:65536', '192.168.1.6:05173', '192.168.001.6:5173', 'MADE-UP.local:5173', '[FD00::1]:5173',
            'made-up.local:5173/x', 'user@192.168.1.6:5173'].map((address) => devSession({ addresses: [address] })),
        ...[0, 1.5, 1_000_000, '1'].map((protocol) => devSession({ protocol })),
        ...[key.slice(1), `${key}A`, looseKey, `${key}=`, `${key.slice(0, 42)}+`].map((each) => devSession({ key: each })),
    ];
    const statuses = [];
    for (const body of bodies) statuses.push((await call('PUT', `/v1/sessions/${newId()}`, { token: cli, body })).status);
    const ids = [];
    for (const id of [newId().slice(1), `${newId()}A`, `${newId().slice(1)}.`, `${newId().slice(1)}+`]) ids.push(await call('PUT', `/v1/sessions/${encodeURIComponent(id)}`, { token: cli, body: devSession() }));

    assert.deepEqual(statuses, bodies.map(() => 400));
    assert.deepEqual(ids.map(({ status, body }) => [status, body.error]), ids.map(() => [400, 'A session\'s id is 16 random bytes in base64url.']));
    assert.equal(await count(db), 0);
});

test(`takes ${MAX_SESSIONS_PER_ACCOUNT} live sessions of an account and refuses one more, while renewing any of them; ended sessions and another account's count for nothing`, async () => {
    const { call, signedIn, advance } = setup();
    const owner = await signedIn(dev);
    const stranger = await signedIn(other);
    const ten = Array.from({ length: MAX_SESSIONS_PER_ACCOUNT }, () => [newId(), devSession()]);

    const statuses = [];
    for (const [id, body] of ten) statuses.push((await call('PUT', `/v1/sessions/${id}`, { token: owner.cli, body })).status);
    const eleventh = await call('PUT', `/v1/sessions/${newId()}`, { token: owner.cli, body: devSession() });
    const renewed = await call('PUT', `/v1/sessions/${ten[0][0]}`, { token: owner.cli, body: ten[0][1] });
    const strangers = await call('PUT', `/v1/sessions/${newId()}`, { token: stranger.cli, body: devSession() });
    advance(LIFE_MS);
    const afterThem = await call('PUT', `/v1/sessions/${newId()}`, { token: owner.cli, body: devSession() });

    assert.deepEqual(statuses, ten.map(() => 200));
    assert.deepEqual(eleventh, { status: 429, body: { error: `This account has ${MAX_SESSIONS_PER_ACCOUNT} previews running, as many as it may: stop one first.` } });
    assert.equal(renewed.status, 200);
    assert.equal(strangers.status, 200);
    // The first, renewed, is still live: nine have ended.
    assert.equal(afterThem.status, 200);
});

test(`registers ${MAX_SESSIONS_PER_ACCOUNT} of ${MAX_SESSIONS_PER_ACCOUNT + 1} sessions sent at once, though every read of the sessions came before any write, as one statement counts and writes`, async () => {
    const {
        db, deps, call, signedIn,
    } = setup();
    const { cli } = await signedIn(dev);
    deps.sessions = createProjectSessions(racing(db, MAX_SESSIONS_PER_ACCOUNT + 1), () => NOW);

    const answers = await Promise.all(Array.from({ length: MAX_SESSIONS_PER_ACCOUNT + 1 }, () => call('PUT', `/v1/sessions/${newId()}`, { token: cli, body: devSession() })));

    assert.deepEqual(answers.map(({ status }) => status).sort(), [...Array(MAX_SESSIONS_PER_ACCOUNT).fill(200), 429].sort());
    assert.equal(await count(db), MAX_SESSIONS_PER_ACCOUNT);
});

test('shows an account\'s session to no other account and to no token of the CLI\'s, and lets the crossbind app\'s token register or remove none', async () => {
    const { call, signedIn, advance } = setup();
    const owner = await signedIn(dev);
    const stranger = await signedIn(other);
    const [id, ended] = [newId(), newId()];
    await call('PUT', `/v1/sessions/${ended}`, { token: owner.cli, body: devSession() });
    advance(LIFE_MS);
    await call('PUT', `/v1/sessions/${id}`, { token: owner.cli, body: devSession() });

    const strangerList = await call('GET', '/v1/sessions', { token: stranger.app });
    const strangerFinds = await call('GET', `/v1/sessions/${id}`, { token: stranger.app });
    const endedFound = await call('GET', `/v1/sessions/${ended}`, { token: owner.app });
    const unknown = await call('GET', `/v1/sessions/${newId()}`, { token: owner.app });
    const strangerRemoves = await call('DELETE', `/v1/sessions/${id}`, { token: stranger.cli });
    const cliLists = await call('GET', '/v1/sessions', { token: owner.cli });
    const cliFinds = await call('GET', `/v1/sessions/${id}`, { token: owner.cli });
    const appRegisters = await call('PUT', `/v1/sessions/${newId()}`, { token: owner.app, body: devSession() });
    const appRemoves = await call('DELETE', `/v1/sessions/${id}`, { token: owner.app });
    const signedOut = await call('GET', '/v1/sessions');
    const listed = await call('GET', '/v1/sessions', { token: owner.app });

    assert.deepEqual(strangerList, { status: 200, body: { sessions: [] } });
    const none = { status: 404, body: { error: NO_SESSION } };
    assert.deepEqual([strangerFinds, endedFound, unknown, strangerRemoves], [none, none, none, none]);
    const refused = { status: 403, body: { error: 'This token cannot be used here.' } };
    assert.deepEqual([cliLists, cliFinds, appRegisters, appRemoves], [refused, refused, refused, refused]);
    assert.equal(signedOut.status, 401);
    assert.deepEqual(listed.body.sessions.map((session) => session.id), [id]);
});

test('lists no session ten minutes after its last renewal, and keeps one renewed', async () => {
    const { call, signedIn, advance } = setup();
    const { cli, app } = await signedIn(dev);
    const [lapsed, renewed] = [[newId(), devSession()], [newId(), devSession()]];
    for (const [id, body] of [lapsed, renewed]) await call('PUT', `/v1/sessions/${id}`, { token: cli, body });

    advance(5 * MINUTE);
    await call('PUT', `/v1/sessions/${renewed[0]}`, { token: cli, body: renewed[1] });
    advance(5 * MINUTE);
    const listed = await call('GET', '/v1/sessions', { token: app });
    const found = await call('GET', `/v1/sessions/${lapsed[0]}`, { token: app });

    assert.deepEqual(listed.body.sessions.map((session) => session.id), [renewed[0]]);
    assert.equal(found.status, 404);
});

test('removes a session as its preview stops, and answers 404 once it is gone', async () => {
    const { db, call, signedIn } = setup();
    const { cli, app } = await signedIn(dev);
    const id = newId();
    await call('PUT', `/v1/sessions/${id}`, { token: cli, body: devSession() });

    const removed = await call('DELETE', `/v1/sessions/${id}`, { token: cli });
    const again = await call('DELETE', `/v1/sessions/${id}`, { token: cli });
    const listed = await call('GET', '/v1/sessions', { token: app });

    assert.deepEqual([removed.status, again], [204, { status: 404, body: { error: NO_SESSION } }]);
    assert.deepEqual(listed.body.sessions, []);
    assert.equal(await count(db), 0);
});

test('deletes an account\'s sessions with it, and refuses a blocked account\'s tokens on every session route', async () => {
    const { db, call, signedIn } = setup();
    const leaving = await signedIn(dev);
    const blocked = await signedIn(other);
    const [id, blockedId] = [newId(), newId()];
    await call('PUT', `/v1/sessions/${id}`, { token: leaving.cli, body: devSession() });
    await call('PUT', `/v1/sessions/${blockedId}`, { token: blocked.cli, body: devSession() });

    const deleted = await call('DELETE', '/v1/account', { token: leaving.cli });
    await db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(blocked.user.id).run();
    const answers = [
        await call('PUT', `/v1/sessions/${blockedId}`, { token: blocked.cli, body: devSession() }),
        await call('DELETE', `/v1/sessions/${blockedId}`, { token: blocked.cli }),
        await call('GET', '/v1/sessions', { token: blocked.app }),
        await call('GET', `/v1/sessions/${blockedId}`, { token: blocked.app }),
    ];

    assert.equal(deleted.status, 204);
    assert.deepEqual((await db.prepare('SELECT id FROM sessions').all()).results.map((row) => row.id), [blockedId]);
    assert.deepEqual(answers, answers.map(() => ({ status: 403, body: { error: 'This account may not use crossbind cloud.' } })));
});

test('prunes the sessions past their life, and keeps the live ones', async () => {
    const { db, deps, call, signedIn, advance } = setup();
    const { cli } = await signedIn(dev);
    const [ending, live] = [newId(), newId()];
    await call('PUT', `/v1/sessions/${ending}`, { token: cli, body: devSession() });
    advance(9 * MINUTE);
    await call('PUT', `/v1/sessions/${live}`, { token: cli, body: devSession() });
    advance(MINUTE + 1);

    await deps.sessions.prune();

    assert.deepEqual((await db.prepare('SELECT id FROM sessions').all()).results.map((row) => row.id), [live]);
});

test('takes a dev server\'s address as crossbind app preview\'s own rule does, in the one form a URL writes it', () => {
    const hosts = [
        '10.0.0.2', '172.16.0.1', '172.31.255.255', '172.32.0.1', '192.168.1.6', '192.169.0.1', '100.64.0.1', '100.128.0.1', '169.254.1.2',
        '127.0.0.1', '8.8.8.8', '0.0.0.0', '255.255.255.255', 'fd00::1', 'fc12:3456::1', 'fe80::1', '::1', '2001:db8::1', '::ffff:c0a8:106',
        'made-up.local', 'made-up.example', 'localhost',
    ];
    const asSent = (host) => `${host.includes(':') ? `[${host}]` : host}:5173`;

    assert.deepEqual(hosts.map((host) => isLocalAddress(asSent(host))), hosts.map((host) => isLocalSource(host)));
    assert.deepEqual(['192.168.001.6:5173', 'MADE-UP.local:5173', '[FD00::1]:5173', '[fd00:0::1]:5173'].map(isLocalAddress), [false, false, false, false]);
});

test('logs nothing of a session: no id, key, address or project', async (t) => {
    const { call, signedIn } = setup();
    const { cli, app } = await signedIn(dev);
    const lines = [];
    t.mock.method(console, 'log', (line) => lines.push(line));
    const id = newId();

    await call('PUT', `/v1/sessions/${id}`, { token: cli, body: devSession() });
    await call('GET', '/v1/sessions', { token: app });
    await call('GET', `/v1/sessions/${id}`, { token: app });
    await call('DELETE', `/v1/sessions/${id}`, { token: cli });

    assert.deepEqual(lines, []);
});
