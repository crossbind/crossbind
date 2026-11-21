import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAccounts } from '../worker/accounts.js';
import { handleRequest } from '../worker/api.js';
import { createProjectSessions, MAX_SESSIONS_PER_ACCOUNT } from '../worker/project-sessions.js';
import { createQuota } from '../worker/quota.js';
import { signSession, SESSION_COOKIE } from '../worker/session.js';
import {
    createSnapshots, INDEXES_KEPT, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_FILES, MAX_SNAPSHOTS_PER_ACCOUNT, SNAPSHOT_DAYS,
} from '../worker/snapshots.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';
import { archiveOf, memoryBucket } from './support/bucket.mjs';
import { gateToken, provenText } from '../../../core/crossbind/src/utils/previewSession.js';
import { archiveLength, archiveStream, webBuildFiles } from '../../../core/crossbind/src/utils/snapshotArchive.js';

// Snapshots crossbind app preview --cloud uploads: the CLI's token makes one and uploads to it as a stream, the cloud
// keeps it within its caps in a bucket, lists it for the account's crossbind app, and serves it from a host of its own to
// the device that holds its key alone.

const API = 'https://api.crossbind.dev';
const HOST = 'https://snapshots.crossbind.dev';
const NOW = Date.parse('2026-11-21T10:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const env = Object.freeze({
    SNAPSHOTS_ENABLED: 'true', SNAPSHOTS_HOST: 'snapshots.crossbind.dev', SNAPSHOTS_TOTAL_GB: '20', SESSION_SECRET: 'a-made-up-secret-of-more-than-32-characters',
});
// Made-up GitHub accounts: ids of ten digits, and names with an underscore, which no GitHub login has.
const dev = { provider: 'github', subject: '8000000001', login: 'made_up_dev' };
const other = { provider: 'github', subject: '8000000002', login: 'made_up_other' };
const PAGE = '<!doctype html><title>made-up</title><script type="module" src="/assets/app.js"></script>';
const SCRIPT = 'console.log("made up");';
const BUILD = [['index.html', PAGE], ['assets/app.js', SCRIPT], ['crossbind.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])]];
const BUILD_BYTES = PAGE.length + SCRIPT.length + 8;
const NO_SNAPSHOT = 'No snapshot of this account has this id.';
const ONLY_ITS_DEVICES = 'This snapshot answers the devices of its account alone.';
const FULL = `This account keeps ${MAX_SNAPSHOTS_PER_ACCOUNT} snapshots, as many as it may: each ends ${SNAPSHOT_DAYS} days after its last upload.`;
const UNTAKEN = 'crossbind cloud could not take this upload; try again in a moment.';
const unlimited = { limit: async () => ({ success: true }) };

const newId = () => randomBytes(16).toString('base64url');
const project = (name = 'made-up-app') => ({ id: newId(), name });

// A limiter that takes `limit` requests of each key, as a minute's would.
function counted(limit) {
    const seen = new Map();
    return {
        seen,
        limit: async ({ key }) => {
            seen.set(key, (seen.get(key) ?? 0) + 1);
            return { success: seen.get(key) <= limit };
        },
    };
}

// A database on which a statement that reads the sessions alone waits until `together` such reads are waiting, or 50 ms
// have passed, as reads of requests sent at once may all come before any of their writes.
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

function setup({
    environment = env, uploads = Infinity, hostRequests = Infinity, race,
} = {}) {
    let now = NOW;
    const db = sqliteD1();
    const bucket = memoryBucket(() => now);
    const storage = memoryStorage();
    const accounts = createAccounts(db, () => now);
    const pending = [];
    const limits = { api: unlimited, upload: counted(uploads), snapshot: counted(hostRequests) };
    const deps = {
        limits,
        accounts,
        quota: createQuota(storage, () => now),
        sessions: createProjectSessions(db, () => now),
        snapshots: createSnapshots(race ? racing(db, race) : db, bucket, () => now),
        waitUntil: (promise) => { pending.push(promise); },
        now: () => now,
    };
    const answerOf = async (response) => {
        const text = await response.text();
        return { status: response.status, headers: response.headers, body: response.headers.get('content-type') === 'application/json' && text ? JSON.parse(text) : text };
    };
    // A route of the API, with a JSON body, an archive with its length, or a form of the account's page with its cookie.
    const call = async (method, path, {
        token, body, archive, length, form, cookie,
    } = {}) => {
        const headers = { 'cf-connecting-ip': '203.0.113.7', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) };
        let sent;
        if (archive !== undefined) {
            sent = archive;
            Object.assign(headers, { 'content-type': 'application/x-tar', ...(length === null ? {} : { 'content-length': String(length ?? archive.length) }) });
        } else if (body !== undefined) {
            sent = JSON.stringify(body);
            Object.assign(headers, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(sent)) });
        } else if (form !== undefined) {
            sent = new URLSearchParams(form).toString();
            Object.assign(headers, { 'content-type': 'application/x-www-form-urlencoded', origin: API, cookie });
        }
        return answerOf(await handleRequest(new Request(`${API}${path}`, {
            method, headers, body: sent, duplex: 'half',
        }), environment, deps));
    };
    // The snapshot host, asked as the crossbind app's proxy asks it: with the gate's token of the key it holds.
    const host = async (path, { key, method = 'GET', headers = {} } = {}) => answerOf(await handleRequest(new Request(`${HOST}${path}`, {
        method, headers: { 'cf-connecting-ip': '203.0.113.7', ...(key === undefined ? {} : { 'x-crossbind-preview': gateToken(key) }), ...headers },
    }), environment, deps));
    // An account signed in on a machine with crossbind login and on a device with the crossbind app.
    const signedIn = async (identity) => {
        const { user } = await accounts.signIn(identity);
        return {
            user,
            cli: await accounts.issueToken(user.id),
            app: await accounts.issueToken(user.id, { kind: 'app', label: 'crossbind app 1.0.0 on iOS 27.1' }),
        };
    };
    // A snapshot made for `of` and uploaded: its id, and the key its account's app reads.
    const uploaded = async (of, entries = BUILD, made = project()) => {
        const { body } = await call('POST', '/v1/snapshots', { token: of.cli, body: { project: made, protocol: 1 } });
        const answer = await call('PUT', `/v1/snapshots/${body.id}`, { token: of.cli, archive: archiveOf(entries) });
        const listed = await call('GET', `/v1/sessions/${body.id}`, { token: of.app });
        return {
            id: body.id, key: listed.body.key, answer, project: made,
        };
    };
    const objects = (prefix = 'snapshots/') => [...bucket.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    return {
        db, bucket, storage, accounts, deps, limits, call, host, signedIn, uploaded, objects, settle: () => Promise.all(pending.splice(0)), advance: (ms) => { now += ms; },
    };
}

const start = (call, owner, made = project()) => call('POST', '/v1/snapshots', { token: owner.cli, body: { project: made, protocol: 1 } });

test('makes a snapshot for the CLI\'s token, finds it again for the same project, and lists it for the account\'s crossbind app once its first upload is in', async () => {
    const { call, signedIn } = setup();
    const owner = await signedIn(dev);
    const made = project();

    const first = await start(call, owner, made);
    const again = await start(call, owner, made);
    const before = await call('GET', '/v1/sessions', { token: owner.app });
    const put = await call('PUT', `/v1/snapshots/${first.body.id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    const listed = await call('GET', '/v1/sessions', { token: owner.app });
    const found = await call('GET', `/v1/sessions/${first.body.id}`, { token: owner.app });

    assert.equal(first.status, 200);
    assert.match(first.body.id, /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(again.body, first.body);
    assert.deepEqual(before.body, { sessions: [] });
    const expiresAt = new Date(NOW + SNAPSHOT_DAYS * DAY).toISOString();
    assert.deepEqual([put.status, put.body], [200, {
        id: first.body.id, version: 1, files: 3, bytes: BUILD_BYTES, expiresAt,
    }]);
    const [session] = listed.body.sessions;
    assert.deepEqual({ ...session, key: undefined }, {
        id: first.body.id, source: 'snapshot', project: made, addresses: [], protocol: 1, key: undefined, version: 1, createdAt: new Date(NOW).toISOString(), expiresAt,
    });
    assert.match(session.key, /^[A-Za-z0-9_-]{43}$/);
    assert.deepEqual(found.body, session);
});

test('takes the archive crossbind app preview --cloud writes of a web build, read as it is sent, and serves each file as it was', async () => {
    const {
        call, host, signedIn,
    } = setup();
    const owner = await signedIn(dev);
    const build = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cloud-build-'));
    // A path past a header's 100 characters, which the archive cuts at a slash, and an empty file.
    const contents = {
        'index.html': PAGE, 'assets/app.js': SCRIPT.repeat(40), [`assets/${'d'.repeat(60)}/${'f'.repeat(47)}.js`]: 'long', 'empty.txt': '',
    };
    try {
        Object.entries(contents).forEach(([name, text]) => {
            fs.mkdirSync(path.dirname(path.join(build, name)), { recursive: true });
            fs.writeFileSync(path.join(build, name), text);
        });
        const files = webBuildFiles(build);
        const { body: { id } } = await start(call, owner);

        const put = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveStream(files), length: archiveLength(files) });
        const { key } = (await call('GET', `/v1/sessions/${id}`, { token: owner.app })).body;
        const served = [];
        for (const name of Object.keys(contents)) served.push((await host(`/${id}/${name}`, { key })).body);

        assert.deepEqual([put.status, put.body.files, put.body.bytes], [200, 4, Object.values(contents).reduce((sum, each) => sum + each.length, 0)]);
        assert.deepEqual(served, Object.values(contents));
    } finally {
        fs.rmSync(build, { recursive: true, force: true });
    }
});

test('serves a snapshot\'s files from its host to the device that holds its key alone, as files of nothing that runs there', async () => {
    const { host, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);

    const page = await host(`/${id}/`, { key });
    const script = await host(`/${id}/assets/app.js`, { key });
    const wasm = await host(`/${id}/crossbind.wasm`, { key, method: 'HEAD' });
    const missing = await host(`/${id}/assets/none.js`, { key });

    assert.deepEqual([page.status, page.body, page.headers.get('content-type')], [200, PAGE, 'text/html; charset=utf-8']);
    assert.deepEqual(['content-security-policy', 'x-content-type-options', 'cache-control', 'referrer-policy'].map((name) => page.headers.get(name)),
        ["sandbox; default-src 'none'", 'nosniff', 'no-store', 'no-referrer']);
    assert.deepEqual([script.status, script.body, script.headers.get('content-type')], [200, SCRIPT, 'text/javascript; charset=utf-8']);
    assert.deepEqual([wasm.status, wasm.body, wasm.headers.get('content-type'), wasm.headers.get('content-length')], [200, '', 'application/wasm', '8']);
    assert.equal(missing.status, 404);
});

test('types a file by the table\'s own entries alone: an extension that names what Object.prototype holds is served as bytes', async () => {
    const { host, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const names = ['constructor', 'made-up.constructor', 'made-up.__proto__'];
    const { id, key } = await uploaded(owner, [['index.html', PAGE], ...names.map((name) => [name, 'made up'])]);

    const types = await Promise.all(names.map(async (name) => (await host(`/${id}/${name}`, { key })).headers.get('content-type')));

    assert.deepEqual(types, names.map(() => 'application/octet-stream'));
});

test('answers nothing without the gate\'s token of the snapshot\'s key, the session included, and the same 403 for a snapshot that is not there, or not yet', async () => {
    const {
        call, db, host, signedIn, uploaded,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    const challenge = randomBytes(32).toString('base64url');
    const token = gateToken(key);
    // The token's last character with a bit set that its 32 bytes leave unused: the same bytes in another form.
    const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const otherForm = `${token.slice(0, 42)}${BASE64URL[BASE64URL.indexOf(token.at(-1)) | 1]}`;
    const { body: { id: waiting } } = await start(call, owner);
    const waitingKey = await db.prepare('SELECT key FROM sessions WHERE id = ?').bind(waiting).first('key');

    const refused = [
        await host(`/${id}/index.html`),
        await host(`/${id}/index.html`, { key: randomBytes(32).toString('base64url') }),
        await host(`/${id}/__crossbind/session?challenge=${challenge}`),
        await host(`/${id}/index.html`, { headers: { 'x-crossbind-preview': key } }),
        await host(`/${id}/index.html`, { headers: { 'x-crossbind-preview': otherForm } }),
        await host(`/${newId()}/index.html`, { key }),
        await host(`/${waiting}/index.html`, { key: waitingKey }),
    ];

    assert.notEqual(otherForm, token);
    assert.deepEqual(Buffer.from(otherForm, 'base64url'), Buffer.from(token, 'base64url'));
    assert.deepEqual(refused.map(({ status, body }) => [status, body.error]), refused.map(() => [403, ONLY_ITS_DEVICES]));
});

test('answers the session with the proof phase 2\'s provenText makes with the key, over the account and the snapshot, which the device verifies', async () => {
    const { host, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const { id, key, project: made } = await uploaded(owner);
    const challenge = randomBytes(32).toString('base64url');

    const answer = await host(`/${id}/__crossbind/session?challenge=${challenge}`, { key });
    const badChallenge = await host(`/${id}/__crossbind/session?challenge=${challenge.slice(1)}`, { key });

    const { protocol, session, proof } = answer.body;
    assert.equal(answer.status, 200);
    assert.equal(proof, createHmac('sha256', Buffer.from(key, 'base64url')).update(provenText(protocol, challenge, session)).digest('base64url'));
    assert.deepEqual(JSON.parse(Buffer.from(session, 'base64url').toString()), {
        protocol: 1, project: { name: made.name }, account: { id: owner.user.id, name: 'made_up_dev' }, session: id, version: 1,
    });
    assert.equal(badChallenge.status, 400);
});

test('answers nothing of the API\'s on the snapshot host, no page and no cookie, and the API\'s host answers no snapshot', async () => {
    const { call, host, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);

    const onHost = [];
    for (const path of ['/v1/account', '/v1/sessions', '/playground/session', '/login', '/device', '/account.js', '/account/delete', '/']) {
        onHost.push(await host(path, { headers: { authorization: `Bearer ${owner.app}`, cookie: `${SESSION_COOKIE}=made-up` } }));
    }
    const posted = await host(`/${id}/index.html`, { key, method: 'POST' });
    const onApi = await call('GET', `/${id}/index.html`);

    assert.deepEqual(onHost.map(({ status }) => status), onHost.map(() => 404));
    assert.ok(onHost.every(({ headers }) => headers.get('set-cookie') === null));
    assert.equal(posted.status, 404);
    assert.equal(onApi.status, 404);
});

test('holds the snapshot host to a limiter of its own, for a network, apart from the API\'s', async () => {
    const context = setup({ hostRequests: 2 });
    const owner = await context.signedIn(dev);
    const { id, key } = await context.uploaded(owner);
    // The API's limiter refuses everything from here on; the host does not ask it.
    context.deps.limits.api = { limit: async () => ({ success: false }) };

    const answers = [];
    for (let at = 0; at < 3; at += 1) answers.push((await context.host(`/${id}/index.html`, { key })).status);

    assert.deepEqual(answers, [200, 200, 429]);
    assert.deepEqual([...context.limits.snapshot.seen], [['203.0.113.7', 3]]);
});

test(`refuses an upload past ${MAX_SNAPSHOT_FILES} files or ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB with 413, writing none of it, and the live upload stays`, async () => {
    const {
        call, host, signedIn, uploaded, objects,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    const live = objects();
    const many = [['index.html', PAGE], ...Array.from({ length: MAX_SNAPSHOT_FILES }, (_, at) => [`f${at}.js`, '1'])];
    const big = [['index.html', PAGE], ['a.bin', new Uint8Array(MAX_SNAPSHOT_BYTES - 100)], ['b.bin', new Uint8Array(200)]];
    // Declared past the cap and the archive's room: nothing of it is read.
    let pulled = 0;
    const neverRead = new ReadableStream({ pull: () => { pulled += 1; } }, { highWaterMark: 0 });

    const tooMany = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(many) });
    const tooBig = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(big) });
    const declared = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: neverRead, length: MAX_SNAPSHOT_BYTES + 2 * 1024 * 1024 });

    assert.deepEqual([tooMany.status, tooMany.body.error], [413, `A snapshot holds ${MAX_SNAPSHOT_FILES} files at most.`]);
    assert.deepEqual([tooBig.status, tooBig.body.error], [413, 'A snapshot holds 50 MB at most.']);
    assert.deepEqual([declared.status, declared.body.error, pulled], [413, 'A snapshot holds 50 MB at most.', 0]);
    assert.deepEqual(objects(), live);
    assert.equal((await host(`/${id}/index.html`, { key })).body, PAGE);
    assert.equal((await call('GET', `/v1/sessions/${id}`, { token: owner.app })).body.version, 1);
});

test(`takes a snapshot just under the caps: ${MAX_SNAPSHOT_FILES} files, and ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB of files`, async () => {
    const { call, signedIn } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);
    const many = [['index.html', PAGE], ...Array.from({ length: MAX_SNAPSHOT_FILES - 1 }, (_, at) => [`f${at}.js`, '1'])];
    const big = [['index.html', PAGE], ['a.bin', new Uint8Array(MAX_SNAPSHOT_BYTES - PAGE.length)]];

    const files = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(many) });
    const bytes = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(big) });

    assert.deepEqual([files.status, files.body.files], [200, MAX_SNAPSHOT_FILES]);
    assert.deepEqual([bytes.status, bytes.body.bytes, bytes.body.version], [200, MAX_SNAPSHOT_BYTES, 2]);
});

test('refuses an archive out of its form with 400 and its words, and leaves nothing of it', async () => {
    const { call, signedIn, objects } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);
    const page = ['index.html', PAGE];
    const unreadable = 'The archive could not be read: send a ustar archive of the web build\'s files, as crossbind app preview --cloud makes it.';
    const plain = (path) => `${JSON.stringify(path)} is not a path of plain names: letters, digits and _@.+- between slashes.`;
    const cases = [
        [[['assets/app.js', 'x']], 'A snapshot is a web build: an index.html at its root.'],
        [[page, ['link.js', '', { type: '2' }]], '"link.js" is not a file: a snapshot holds files alone.'],
        [[page, ['assets', '', { type: '5' }]], '"assets" is not a file: a snapshot holds files alone.'],
        [[page, ['../up.js', 'x']], plain('../up.js')],
        [[page, ['assets/./x.js', 'x']], plain('assets/./x.js')],
        [[page, ['/rooted.js', 'x']], plain('/rooted.js')],
        [[page, ['a b.js', 'x']], plain('a b.js')],
        [[page, ['__crossbind/session', 'x']], '"__crossbind/session" is under __crossbind/, whose paths crossbind answers itself.'],
        [[page, ['x.js', 'x', { checksum: 1 }]], unreadable],
        [[page, ['x.js', 'x', { magic: 'other\0' }]], unreadable],
    ];

    const answers = [];
    for (const [entries, words] of cases) answers.push([await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(entries) }), words]);
    const unended = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([page], { end: false }) });
    const empty = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: new Uint8Array(0) });

    assert.deepEqual(answers.map(([answer]) => [answer.status, answer.body.error]), answers.map(([, words]) => [400, words]));
    assert.deepEqual([unended.status, unended.body.error], [400, unreadable]);
    assert.deepEqual([empty.status, empty.body.error], [400, unreadable]);
    assert.deepEqual(objects(), []);
    assert.deepEqual((await call('GET', '/v1/sessions', { token: owner.app })).body, { sessions: [] });
});

test('leaves nothing of an upload cut half way, its cleanup kept going by waitUntil, and the live upload stays', async () => {
    const {
        call, host, signedIn, uploaded, objects, settle,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    const live = objects();
    const archive = archiveOf([['index.html', PAGE], ['a.js', '1'], ['b.js', new Uint8Array(4096)]]);
    // Two files in, the third half way.
    const cut = new ReadableStream({
        start(controller) {
            controller.enqueue(archive.subarray(0, 5 * 512 + 1024));
            controller.error(new Error('Network connection lost.'));
        },
    });

    const answer = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: cut, length: archive.length });
    await settle();

    assert.deepEqual([answer.status, answer.body.error], [503, UNTAKEN]);
    assert.deepEqual(objects(), live);
    assert.equal((await host(`/${id}/index.html`, { key })).status, 200);
});

test('answers a failure that is no refusal, as R2 failing the archive\'s put, with 503 in crossbind\'s words: its own words are logged, not sent, and nothing of the upload is kept', async (t) => {
    const {
        call, bucket, signedIn, objects, settle,
    } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);
    const lines = [];
    t.mock.method(console, 'log', (line) => lines.push(line));
    // R2 takes the archive's bytes, then fails its put.
    const { put } = bucket;
    t.mock.method(bucket, 'put', async (key, value) => {
        if (!key.endsWith('/archive.tar')) return put(key, value);
        await new Response(value).arrayBuffer();
        throw new Error('made-up R2 failure: words of its own');
    });

    const answer = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    await settle();

    assert.deepEqual([answer.status, answer.body], [503, { error: UNTAKEN }]);
    assert.deepEqual(objects(), []);
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [
        { event: 'snapshot-upload-failed', who: `user:${owner.user.id}`, message: 'made-up R2 failure: words of its own' },
        { event: 'snapshot-refused', who: `user:${owner.user.id}`, status: 503 },
    ]);
});

test('makes a new upload live whole, its version risen, and deletes the one before it', async () => {
    const {
        call, host, signedIn, uploaded, objects, settle,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);

    const second = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([['index.html', '<!doctype html><title>second</title>']]) });
    await settle();

    assert.deepEqual([second.status, second.body.version, second.body.files], [200, 2, 1]);
    assert.deepEqual(objects().map((key) => key.split('/').pop()), ['archive.tar', 'index.json']);
    assert.equal((await host(`/${id}/index.html`, { key })).body, '<!doctype html><title>second</title>');
    assert.equal((await host(`/${id}/assets/app.js`, { key })).status, 404);
    assert.equal((await call('GET', `/v1/sessions/${id}`, { token: owner.app })).body.version, 2);
});

test('keeps an upload as its archive, one object as it was sent with what follows its end, its index beside it, and serves each file as a range of it, an empty one with no read', async (t) => {
    const {
        call, host, signedIn, bucket, objects,
    } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);
    const sent = Buffer.concat([archiveOf([['index.html', PAGE], ['assets/app.js', SCRIPT], ['empty.txt', '']]), Buffer.from('made-up bytes past the end')]);

    const put = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: sent });
    const { key } = (await call('GET', `/v1/sessions/${id}`, { token: owner.app })).body;
    const reads = [];
    const { get } = bucket;
    t.mock.method(bucket, 'get', (name, options) => {
        reads.push(`${name.split('/').pop()}${options?.range ? ` ${options.range.offset}+${options.range.length}` : ''}`);
        return get(name, options);
    });
    const served = await Promise.all(['index.html', 'assets/app.js', 'empty.txt'].map((path) => host(`/${id}/${path}`, { key })));
    const head = await host(`/${id}/assets/app.js`, { key, method: 'HEAD' });

    const [archive, index] = objects();
    assert.deepEqual([put.status, put.body.files, put.body.bytes], [200, 3, PAGE.length + SCRIPT.length]);
    assert.deepEqual([archive.split('/').pop(), index.split('/').pop()], ['archive.tar', 'index.json']);
    assert.ok(Buffer.from(bucket.objects.get(archive).bytes).equals(sent));
    // Each file's bytes follow its header, a block, and start a block: at 512, 1536 and 2560 here.
    assert.deepEqual(JSON.parse(Buffer.from(bucket.objects.get(index).bytes).toString()), [['index.html', 512, PAGE.length], ['assets/app.js', 1536, SCRIPT.length], ['empty.txt', 2560, 0]]);
    assert.deepEqual(served.map(({ status, body }) => [status, body]), [[200, PAGE], [200, SCRIPT], [200, '']]);
    assert.deepEqual([head.status, head.body, head.headers.get('content-length')], [200, '', String(SCRIPT.length)]);
    // The index once, then a ranged read of the archive for each file with bytes: none for the empty one or the HEAD.
    assert.deepEqual(reads.sort(), [`archive.tar 1536+${SCRIPT.length}`, `archive.tar 512+${PAGE.length}`, 'index.json']);
});

test('reads an upload\'s index from R2 once in an isolate, and answers alike from another isolate, which reads it once more, and from a new upload\'s own index', async (t) => {
    const context = setup();
    const {
        call, host, signedIn, uploaded, bucket, db,
    } = context;
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    let indexReads = 0;
    const { get } = bucket;
    t.mock.method(bucket, 'get', (name, options) => {
        if (name.endsWith('/index.json')) indexReads += 1;
        return get(name, options);
    });

    const here = [await host(`/${id}/index.html`, { key }), await host(`/${id}/assets/app.js`, { key }), await host(`/${id}/index.html`, { key })];
    // Another isolate, which keeps no index yet.
    context.deps.snapshots = createSnapshots(db, bucket, () => NOW, new Map());
    const elsewhere = await host(`/${id}/assets/app.js`, { key });
    const second = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([['index.html', '<!doctype html><title>second</title>']]) });
    const renewed = await host(`/${id}/index.html`, { key });

    assert.deepEqual(here.map(({ body }) => body), [PAGE, SCRIPT, PAGE]);
    assert.equal(elsewhere.body, SCRIPT);
    assert.deepEqual([second.status, renewed.body], [200, '<!doctype html><title>second</title>']);
    assert.equal(indexReads, 3);
});

test('finds a file by its upload\'s index\'s own entries alone: no name Object.prototype holds is a file of it', async () => {
    const { host, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner, [['index.html', PAGE], ['__proto__', 'made up']]);

    const asked = [];
    for (const path of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        const { status, body } = await host(`/${id}/${path}`, { key });
        asked.push([path, status, status === 200 ? body : body.error]);
    }

    assert.deepEqual(asked, [['__proto__', 200, 'made up'], ['constructor', 404, 'Not found.'], ['toString', 404, 'Not found.'], ['hasOwnProperty', 404, 'Not found.']]);
});

test(`keeps the indexes of ${INDEXES_KEPT} uploads at most in an isolate, the least lately used going first`, async (t) => {
    const { bucket, db } = setup();
    const kept = new Map();
    const snapshots = createSnapshots(db, bucket, () => NOW, kept);
    let reads = 0;
    const { get } = bucket;
    t.mock.method(bucket, 'get', (name, options) => {
        reads += 1;
        return get(name, options);
    });
    const ask = (at) => snapshots.file({ id: 'IRVUB8Fpwuh0lT_7NkiJ8Q', upload: `madeup${at}` }, 'index.html', { head: true });
    const prefix = (at) => `snapshots/IRVUB8Fpwuh0lT_7NkiJ8Q/madeup${at}/`;

    for (let at = 0; at <= INDEXES_KEPT; at += 1) await ask(at);
    await ask(1);
    const readsBefore = reads;
    await ask(0);

    assert.equal(kept.size, INDEXES_KEPT);
    assert.deepEqual([readsBefore, reads], [INDEXES_KEPT + 1, INDEXES_KEPT + 2]);
    assert.deepEqual([kept.has(prefix(0)), kept.has(prefix(1)), kept.has(prefix(2))], [true, true, false]);
});

test('aborts the archive\'s put at a refusal, so that nothing of the upload is kept and nothing is cleaned up', async (t) => {
    const {
        call, signedIn, uploaded, bucket, objects, settle,
    } = setup();
    const owner = await signedIn(dev);
    const { id } = await uploaded(owner);
    await settle();
    const live = objects();
    const deleted = [];
    const { delete: remove, put } = bucket;
    t.mock.method(bucket, 'delete', (keys) => {
        deleted.push(keys);
        return remove(keys);
    });
    // How each archive's put ended: an aborted one fails, a finished one is kept.
    const puts = [];
    t.mock.method(bucket, 'put', (name, value) => {
        const putting = put(name, value);
        if (name.endsWith('/archive.tar')) putting.then(() => puts.push('kept'), () => puts.push('aborted'));
        return putting;
    });
    const files = (count) => Array.from({ length: count }, (_, at) => [at === 0 ? 'index.html' : `f${at}.js`, 'made up']);

    const refused = [
        await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(files(MAX_SNAPSHOT_FILES + 1)) }),
        await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([['index.html', PAGE]], { end: false }) }),
        await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([['assets/app.js', SCRIPT]]) }),
    ];
    await settle();

    assert.deepEqual(refused.map(({ status }) => status), [413, 400, 400]);
    assert.deepEqual(puts, ['aborted', 'aborted', 'aborted']);
    assert.deepEqual(objects(), live);
    assert.deepEqual(deleted, []);
});

test('deletes an upload\'s archive and index when its index cannot be kept or its UPDATE fails, and answers 503', async (t) => {
    const context = setup();
    const {
        call, signedIn, uploaded, bucket, db, objects, settle,
    } = context;
    const owner = await signedIn(dev);
    const { id } = await uploaded(owner);
    await settle();
    const live = objects();
    const { put } = bucket;
    const failing = t.mock.method(bucket, 'put', async (name, value) => {
        if (name.endsWith('/index.json')) throw new Error('made-up R2 failure of the index');
        return put(name, value);
    });

    const indexFailed = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    await settle();
    const afterIndex = objects();
    failing.mock.restore();
    // A database that fails the UPDATE making an upload live.
    context.deps.snapshots = createSnapshots({
        ...db,
        prepare: (sql) => (sql.startsWith('UPDATE sessions SET upload') ? { bind: () => ({ first: async () => { throw new Error('made-up D1 failure'); } }) } : db.prepare(sql)),
    }, bucket, () => NOW);
    const updateFailed = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    await settle();

    assert.deepEqual([indexFailed.status, indexFailed.body.error, updateFailed.status], [503, UNTAKEN, 503]);
    assert.deepEqual([afterIndex, objects()], [live, live]);
});

test('answers 503 when R2 fails the archive\'s put before it reads a byte, the writes that wait on it ended rather than left waiting', { timeout: 5000 }, async (t) => {
    const {
        call, signedIn, bucket, objects,
    } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);
    const { put } = bucket;
    t.mock.method(bucket, 'put', async (name, value) => {
        if (name.endsWith('/archive.tar')) throw new Error('made-up R2 failure before a byte');
        return put(name, value);
    });

    const answer = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });

    assert.deepEqual([answer.status, answer.body.error], [503, UNTAKEN]);
    assert.deepEqual(objects(), []);
});

test('answers 404 for each file of an upload of the layout before, a file an object and no index, until the next upload replaces it', async () => {
    const {
        call, host, signedIn, uploaded, bucket, db,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    // The layout before: each file an object of its own, and no index.
    await bucket.put(`snapshots/${id}/layoutbefore/index.html`, PAGE);
    await db.prepare('UPDATE sessions SET upload = ? WHERE id = ?').bind('layoutbefore', id).run();

    const before = await host(`/${id}/index.html`, { key });
    const next = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    const after = await host(`/${id}/index.html`, { key });

    assert.deepEqual([before.status, next.status, after.status, after.body], [404, 200, 200, PAGE]);
});

test(`keeps ${MAX_SNAPSHOTS_PER_ACCOUNT} snapshots an account and refuses a fourth project's, which one that ended, or waited an hour for its upload in vain, makes room for`, async () => {
    const {
        call, signedIn, uploaded, advance,
    } = setup();
    const owner = await signedIn(dev);
    const kept = [];
    for (let at = 0; at < MAX_SNAPSHOTS_PER_ACCOUNT; at += 1) kept.push(await uploaded(owner));

    const refused = await start(call, owner, project('fourth'));
    const again = await start(call, owner, kept[0].project);
    advance(SNAPSHOT_DAYS * DAY + MINUTE);
    const afterEnd = await start(call, owner, project('fourth'));
    await start(call, owner, project('fifth'));
    await start(call, owner, project('sixth'));
    const waiting = await start(call, owner, project('seventh'));
    advance(HOUR + MINUTE);
    const afterWait = await start(call, owner, project('seventh'));

    assert.deepEqual([refused.status, refused.body.error], [429, FULL]);
    assert.deepEqual(again.body, { id: kept[0].id });
    assert.equal(afterEnd.status, 200);
    assert.deepEqual([waiting.status, waiting.body.error], [429, FULL]);
    assert.equal(afterWait.status, 200);
});

test(`makes ${MAX_SNAPSHOTS_PER_ACCOUNT} of ${MAX_SNAPSHOTS_PER_ACCOUNT + 2} snapshots asked for at once, though every read of the sessions came before any write, as one statement counts and writes`, async () => {
    const { call, signedIn } = setup({ race: MAX_SNAPSHOTS_PER_ACCOUNT + 2 });
    const owner = await signedIn(dev);

    const answers = await Promise.all(Array.from({ length: MAX_SNAPSHOTS_PER_ACCOUNT + 2 }, (_, at) => start(call, owner, project(`p${at}`))));

    assert.deepEqual(answers.map(({ status }) => status).sort(), [200, 200, 200, 429, 429]);
});

test('serves and lists a snapshot that ended no more, and refuses an upload to it, which goes back through the start that counts it', async () => {
    const {
        call, host, signedIn, uploaded, advance,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key, project: made } = await uploaded(owner);
    advance(SNAPSHOT_DAYS * DAY + MINUTE);

    // An archive that counts how often it is read: the upload to a snapshot that ended reads none of it.
    const bytes = archiveOf(BUILD);
    let pulled = 0;
    const counted = new ReadableStream({
        pull(controller) {
            pulled += 1;
            controller.enqueue(bytes);
            controller.close();
        },
    }, { highWaterMark: 0 });

    const served = await host(`/${id}/index.html`, { key });
    const listed = await call('GET', '/v1/sessions', { token: owner.app });
    const lapsed = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: counted, length: bytes.length });
    const restarted = await start(call, owner, made);
    const again = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });

    assert.equal(served.status, 403);
    assert.deepEqual(listed.body, { sessions: [] });
    assert.deepEqual([lapsed.status, lapsed.body.error, pulled], [404, NO_SNAPSHOT, 0]);
    assert.deepEqual(restarted.body, { id });
    assert.deepEqual([again.status, again.body.version], [200, 2]);
});

test('takes ten uploads a minute for an account, and refuses the eleventh with 429', async () => {
    const { call, signedIn } = setup({ uploads: 10 });
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);

    const answers = [];
    for (let at = 0; at < 11; at += 1) answers.push(await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) }));

    assert.deepEqual(answers.map(({ status }) => status), [...Array(10).fill(200), 429]);
    assert.equal(answers[10].body.error, 'Too many uploads for this account; try again in a minute.');
});

test('counts the uploads of an account and of everyone by the day, exactly, before a byte of the archive is read: after the checks that read nothing, and a refusal past them stays counted', async () => {
    const {
        call, signedIn, objects, storage, advance, settle,
    } = setup({
        environment: {
            ...env, SNAPSHOT_UPLOADS_DAILY: '3', GLOBAL_SNAPSHOT_UPLOADS_DAILY: '4', SNAPSHOTS_TOTAL_GB: String(1 / 1024),
        },
    });
    const owner = await signedIn(dev);
    const another = await signedIn(other);
    const { body: { id } } = await start(call, owner);
    const { body: { id: theirs } } = await start(call, another);
    const put = (who, to, archive = archiveOf(BUILD), length = undefined) => call('PUT', `/v1/snapshots/${to}`, { token: who.cli, archive, length });
    // Archives that count how often they are read: an upload refused for its count reads none of them.
    const archive = archiveOf(BUILD);
    let pulled = 0;
    const counting = () => new ReadableStream({
        pull(controller) {
            pulled += 1;
            controller.enqueue(archive);
            controller.close();
        },
    }, { highWaterMark: 0 });

    const uncounted = [
        await put(owner, newId()),
        await put(owner, id, archiveOf(BUILD), null),
        await put(owner, id, counting(), MAX_SNAPSHOT_BYTES * 2),
        await put(owner, id, counting(), 2 * 1024 * 1024),
    ];
    const counted = [await put(owner, id, archiveOf(BUILD, { end: false })), await put(owner, id), await put(owner, id)];
    await settle();
    const kept = objects(`snapshots/${id}/`);
    const past = await put(owner, id, counting(), archive.length);
    const afterPast = objects(`snapshots/${id}/`);
    const theirsTaken = await put(another, theirs);
    const everyonesPast = await put(another, theirs, counting(), archive.length);
    advance(DAY);
    const nextDay = await put(owner, id);

    assert.deepEqual(uncounted.map(({ status }) => status), [404, 411, 413, 503]);
    assert.deepEqual(counted.map(({ status }) => status), [400, 200, 200]);
    assert.deepEqual([past.status, past.body.error], [429, 'This account has made 3 uploads today, as many as it may: try again tomorrow.']);
    assert.deepEqual([theirsTaken.status, everyonesPast.status, everyonesPast.body.error], [200, 503, 'crossbind cloud has taken as many uploads today as it can; try again tomorrow.']);
    assert.equal(pulled, 0);
    assert.deepEqual([kept.length, afterPast], [2, kept]);
    assert.equal(nextDay.status, 200);
    // Counts of their own, apart from the compiles' (`user:<id>` and `*`), which an upload leaves as they were.
    assert.deepEqual(Object.fromEntries(storage.data), {
        [`2026-11-21|upload:user:${owner.user.id}`]: 3,
        [`2026-11-21|upload:user:${another.user.id}`]: 1,
        '2026-11-21|upload:*': 4,
        [`2026-11-22|upload:user:${owner.user.id}`]: 1,
        '2026-11-22|upload:*': 1,
    });
});

test('answers 503 for snapshots paused, uploads and the host alike, and lists none meanwhile', async () => {
    const context = setup();
    const owner = await context.signedIn(dev);
    const { id, key } = await context.uploaded(owner);
    const paused = setup({ environment: { ...env, SNAPSHOTS_ENABLED: 'false' } });
    Object.assign(paused.deps, { accounts: context.accounts, sessions: context.deps.sessions, snapshots: context.deps.snapshots });

    const made = await start(paused.call, owner);
    const put = await paused.call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    const served = await paused.host(`/${id}/index.html`, { key });
    const listed = await paused.call('GET', '/v1/sessions', { token: owner.app });
    const found = await paused.call('GET', `/v1/sessions/${id}`, { token: owner.app });

    const words = 'Snapshots are paused in crossbind cloud; preview from this machine meanwhile, without --cloud.';
    assert.deepEqual([made.status, made.body.error, put.status, put.body.error], [503, words, 503, words]);
    assert.deepEqual([served.status, served.body.error], [503, 'Snapshots are paused in crossbind cloud.']);
    assert.deepEqual([listed.body, found.status], [{ sessions: [] }, 404]);
});

test('answers 503 for an upload past what every snapshot together may hold, and writes none of it', async () => {
    const archive = archiveOf(BUILD);
    // Room for the first upload's archive, and not for a second beside the first's files.
    const { call, signedIn, objects } = setup({ environment: { ...env, SNAPSHOTS_TOTAL_GB: String((archive.length + BUILD_BYTES / 2) / 1024 ** 3) } });
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);

    const first = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive });
    const kept = objects();
    const second = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive });

    assert.equal(first.status, 200);
    assert.deepEqual([second.status, second.body.error], [503, 'crossbind cloud holds as many snapshots as it can; try again tomorrow.']);
    assert.deepEqual(objects(), kept);
});

test('asks for the archive\'s length, and for a project and protocol of their form', async () => {
    const { call, signedIn } = setup();
    const owner = await signedIn(dev);
    const { body: { id } } = await start(call, owner);

    const lengthless = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: new ReadableStream({ start: (controller) => controller.close() }), length: null });
    const forms = [];
    for (const body of [{}, { project: project(), protocol: 0 }, { project: { id: 'short', name: 'x' }, protocol: 1 }, { project: project('a#b'), protocol: 1 }, { project: project('a'.repeat(65)), protocol: 1 }]) {
        forms.push((await call('POST', '/v1/snapshots', { token: owner.cli, body })).status);
    }

    assert.deepEqual([lengthless.status, lengthless.body.error], [411, 'Send the archive with its Content-Length.']);
    assert.deepEqual(forms, [400, 400, 400, 400, 400]);
});

test('keeps a snapshot of one account from any other: its upload, its listing and its id', async () => {
    const { call, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const stranger = await signedIn(other);
    const { id, project: made } = await uploaded(owner);

    const put = await call('PUT', `/v1/snapshots/${id}`, { token: stranger.cli, archive: archiveOf(BUILD) });
    const listed = await call('GET', '/v1/sessions', { token: stranger.app });
    const found = await call('GET', `/v1/sessions/${id}`, { token: stranger.app });
    const theirs = await start(call, stranger, made);

    assert.deepEqual([put.status, put.body.error], [404, NO_SNAPSHOT]);
    assert.deepEqual(listed.body, { sessions: [] });
    assert.equal(found.status, 404);
    assert.notEqual(theirs.body.id, id);
});

test('leaves a snapshot alone on a dev session\'s routes, and counts it among no dev previews', async () => {
    const { call, signedIn, uploaded } = setup();
    const owner = await signedIn(dev);
    const kept = [];
    for (let at = 0; at < MAX_SNAPSHOTS_PER_ACCOUNT; at += 1) kept.push(await uploaded(owner));
    const devSession = () => ({
        source: 'dev', project: project(), addresses: ['192.168.1.6:5173'], protocol: 1, key: randomBytes(32).toString('base64url'),
    });

    const put = await call('PUT', `/v1/sessions/${kept[0].id}`, { token: owner.cli, body: devSession() });
    const removed = await call('DELETE', `/v1/sessions/${kept[0].id}`, { token: owner.cli });
    const registered = [];
    for (let at = 0; at < MAX_SESSIONS_PER_ACCOUNT; at += 1) registered.push((await call('PUT', `/v1/sessions/${newId()}`, { token: owner.cli, body: devSession() })).status);
    const listed = await call('GET', '/v1/sessions', { token: owner.app });

    assert.equal(put.status, 409);
    assert.equal(removed.status, 404);
    assert.deepEqual(registered, Array(MAX_SESSIONS_PER_ACCOUNT).fill(200));
    assert.deepEqual(listed.body.sessions.map(({ source }) => source).sort(), [...Array(MAX_SESSIONS_PER_ACCOUNT).fill('dev'), ...Array(MAX_SNAPSHOTS_PER_ACCOUNT).fill('snapshot')]);
});

test('deletes an account\'s snapshots with it, their files at once, from the CLI and from the account\'s page', async () => {
    const {
        call, db, signedIn, uploaded, objects,
    } = setup();
    const owner = await signedIn(dev);
    const paged = await signedIn(other);
    const kept = await uploaded(await signedIn({ provider: 'github', subject: '8000000003', login: 'made_up_third' }));
    await uploaded(owner);
    await uploaded(owner);
    await uploaded(paged);
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: paged.user.id, name: 'made_up_other' }, env.SESSION_SECRET, NOW)}`;

    const byCli = await call('DELETE', '/v1/account', { token: owner.cli });
    const byPage = await call('POST', '/account/delete', { form: { confirm: 'yes' }, cookie });

    assert.deepEqual([byCli.status, byPage.status], [204, 303]);
    assert.deepEqual([...new Set(objects().map((key) => key.split('/')[1]))], [kept.id]);
    assert.equal(await db.prepare("SELECT count(1) AS rows FROM sessions WHERE source = 'snapshot'").first('rows'), 1);
});

test('gives each snapshot of the account a new key when a crossbind app is signed out, by its token or on the account\'s page: the old key\'s token gets 403, and a device still signed in reads the new one and opens; a CLI\'s sign-out leaves the keys', async () => {
    const {
        call, host, signedIn, uploaded, accounts,
    } = setup();
    const owner = await signedIn(dev);
    const tablet = await accounts.issueToken(owner.user.id, { kind: 'app', label: 'crossbind app 1.0.0 on iPadOS 27.1' });
    const phone = await accounts.issueToken(owner.user.id, { kind: 'app', label: 'crossbind app 1.0.0 on Android 17' });
    const laptop = await accounts.issueToken(owner.user.id);
    const first = await uploaded(owner);
    const second = await uploaded(owner);
    const keysOf = async (token) => Promise.all([first, second].map(async ({ id }) => (await call('GET', `/v1/sessions/${id}`, { token })).body.key));
    const opens = async (key) => (await host(`/${first.id}/index.html`, { key })).status;
    const refOf = async (label) => (await accounts.devices(owner.user.id)).find((device) => device.label === label).ref;
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: owner.user.id, name: 'made_up_dev' }, env.SESSION_SECRET, NOW)}`;

    const cliByToken = await call('DELETE', '/v1/token', { token: laptop });
    const cliOnPage = await call('POST', '/account/tokens/revoke', { form: { ref: await refOf('crossbind CLI') }, cookie });
    const afterClis = await keysOf(phone);
    const appByToken = await call('DELETE', '/v1/token', { token: owner.app });
    const afterApp = await keysOf(phone);
    const openedAfterApp = [await opens(first.key), await opens(afterApp[0])];
    const appOnPage = await call('POST', '/account/tokens/revoke', { form: { ref: await refOf('crossbind app 1.0.0 on Android 17') }, cookie });
    const afterPage = await keysOf(tablet);
    const openedAfterPage = [await opens(afterApp[0]), await opens(afterPage[0])];

    assert.deepEqual([cliByToken.status, cliOnPage.status, appByToken.status, appOnPage.status], [204, 303, 204, 303]);
    assert.deepEqual(afterClis, [first.key, second.key]);
    assert.equal(new Set([first.key, second.key, ...afterApp, ...afterPage]).size, 6);
    assert.ok([...afterApp, ...afterPage].every((key) => /^[A-Za-z0-9_-]{43}$/.test(key)));
    assert.deepEqual([openedAfterApp, openedAfterPage], [[403, 200], [403, 200]]);
});

test('gives each snapshot of the account a new key at Sign out everywhere, by the CLI or on the account\'s page: the old key\'s token gets 403, and a device signed in again reads the new one and opens', async () => {
    const {
        call, host, signedIn, uploaded, accounts, advance,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    const keyOf = async (token) => (await call('GET', `/v1/sessions/${id}`, { token })).body.key;
    const opens = async (gateKey) => (await host(`/${id}/index.html`, { key: gateKey })).status;
    const signedInAgain = () => accounts.issueToken(owner.user.id, { kind: 'app', label: 'crossbind app 1.0.0 on iOS 27.1' });

    const byCli = await call('DELETE', '/v1/tokens', { token: owner.cli });
    const afterCli = await keyOf(await signedInAgain());
    const openedAfterCli = [await opens(key), await opens(afterCli)];
    advance(MINUTE);
    const cookie = `${SESSION_COOKIE}=${await signSession({ id: owner.user.id, name: 'made_up_dev' }, env.SESSION_SECRET, NOW + MINUTE)}`;
    const onPage = await call('POST', '/account/logout-everywhere', { form: {}, cookie });
    const afterPage = await keyOf(await signedInAgain());
    const openedAfterPage = [await opens(afterCli), await opens(afterPage)];

    assert.deepEqual([byCli.status, onPage.status], [204, 303]);
    assert.equal(new Set([key, afterCli, afterPage]).size, 3);
    assert.deepEqual([openedAfterCli, openedAfterPage], [[403, 200], [403, 200]]);
});

test('prunes every file no live snapshot names once an hour old: a cleanup\'s leftover, a replaced upload\'s, an ended one\'s and a blocked account\'s', async () => {
    const context = setup();
    const {
        bucket, call, db, signedIn, uploaded, objects, advance,
    } = context;
    const owner = await signedIn(dev);
    const blocked = await signedIn(other);
    const live = await uploaded(owner);
    const ending = await uploaded(owner, BUILD, project('ending'));
    const ofBlocked = await uploaded(blocked);
    const first = await db.prepare('SELECT upload FROM sessions WHERE id = ?').bind(live.id).first('upload');
    await bucket.put(`snapshots/${live.id}/leftover0001/x.js`, new Uint8Array(1));
    // The README's block: the account's row blocked, its sessions deleted.
    await db.batch([db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(blocked.user.id), db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(blocked.user.id)]);
    advance(SNAPSHOT_DAYS * DAY - HOUR);
    // A new upload, whose waitUntil that deletes the one before is never kept going: the prune takes it.
    context.deps.waitUntil = () => {};
    await call('PUT', `/v1/snapshots/${live.id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    const second = await db.prepare('SELECT upload FROM sessions WHERE id = ?').bind(live.id).first('upload');
    advance(2 * HOUR);
    // An upload on its way: written a moment ago, named by no row yet.
    await bucket.put(`snapshots/${live.id}/onitsway0001/index.html`, new Uint8Array(1));

    await context.deps.snapshots.prune();

    assert.notEqual(first, second);
    assert.deepEqual(objects(`snapshots/${ending.id}/`), []);
    assert.deepEqual(objects(`snapshots/${ofBlocked.id}/`), []);
    assert.deepEqual(objects(`snapshots/${live.id}/`), [`snapshots/${live.id}/${second}/archive.tar`, `snapshots/${live.id}/${second}/index.json`, `snapshots/${live.id}/onitsway0001/index.html`].sort());
});

test('serves a blocked account\'s snapshot to no device, and refuses its uploads', async () => {
    const {
        call, db, host, signedIn, uploaded,
    } = setup();
    const owner = await signedIn(dev);
    const { id, key } = await uploaded(owner);
    await db.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(owner.user.id).run();

    const served = await host(`/${id}/index.html`, { key });
    const put = await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });

    assert.deepEqual([served.status, served.body.error], [403, ONLY_ITS_DEVICES]);
    assert.deepEqual([put.status, put.body.error], [403, 'This account may not use crossbind cloud.']);
});

test('logs a snapshot\'s upload and refusal by the account\'s id and counts alone: no path, key, session or name', async (t) => {
    const { call, host, signedIn } = setup();
    const owner = await signedIn(dev);
    const lines = [];
    t.mock.method(console, 'log', (line) => lines.push(line));
    const made = project('made-up-logged');

    const { body: { id } } = await start(call, owner, made);
    await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf(BUILD) });
    await call('PUT', `/v1/snapshots/${id}`, { token: owner.cli, archive: archiveOf([['secret-path.js', 'x']]) });
    const { key } = (await call('GET', `/v1/sessions/${id}`, { token: owner.app })).body;
    await host(`/${id}/index.html`, { key });

    assert.deepEqual(lines.map((line) => JSON.parse(line)), [
        {
            event: 'snapshot-uploaded', who: `user:${owner.user.id}`, files: 3, bytes: BUILD_BYTES, version: 1,
        },
        { event: 'snapshot-refused', who: `user:${owner.user.id}`, status: 400 },
    ]);
    assert.ok(lines.every((line) => ![id, key, made.id, made.name, 'secret-path', 'index.html'].some((secret) => line.includes(secret))));
});
