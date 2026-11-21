import { nameOf, userKey } from './accounts.js';
import {
    BodyTooLarge, jsonResponse, log, readLimited,
} from './http.js';
import { isProject, isProtocol, isSessionId } from './project-sessions.js';
import { fromBase64Url, randomToken, toBase64Url } from './session.js';

// Snapshots: a project's web build that crossbind app preview --cloud uploads, kept in R2 for the account's own devices
// under a session of the source 'snapshot' (migrations/0002's `sessions`), and served to them alone from the snapshot
// host, behind the gate of the session's pairing key, as crossbind app preview's dev server is
// (core/crossbind/src/utils/previewSession.js). R2 keeps a snapshot's files as snapshots/<session>/<upload>/<path>.

// A snapshot lives this long after its last upload.
export const SNAPSHOT_DAYS = 30;
export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024;
export const MAX_SNAPSHOT_FILES = 500;
export const MAX_SNAPSHOTS_PER_ACCOUNT = 3;
// A snapshot just made, or one that ended and is asked for again, waits this long for an upload, and counts among the
// account's meanwhile.
const FIRST_UPLOAD_MS = 3600 * 1000;
// The archive past its files' bytes: a header of 512 bytes and at most 511 of padding a file, and its end.
const ARCHIVE_ROOM = 1024 * 1024;
const BLOCK = 512;
const PREFIX = 'snapshots/';
const MAX_BODY_BYTES = 1024;
// R2 deletes at most this many keys a call.
const DELETE_BATCH = 1000;
// What no live snapshot names is pruned once it is this old, so that an upload on its way keeps its files.
const PRUNE_AFTER_MS = 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
// A path of plain names, which a URL writes as it is; none of them . or .., and none under __crossbind/, whose paths
// this host and the crossbind app answer themselves.
const PLAIN_PATH = /^([A-Za-z0-9_@.+-]+\/)*[A-Za-z0-9_@.+-]+$/;
const OWN_PATHS = '__crossbind/';
const SESSION_PATH = '__crossbind/session';
// What the crossbind app's proxy adds to every request: an HMAC of the pairing key, as the dev server's gate takes it.
const GATE_HEADER = 'x-crossbind-preview';
const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const TYPES = Object.freeze({
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json',
    map: 'application/json',
    webmanifest: 'application/manifest+json',
    wasm: 'application/wasm',
    txt: 'text/plain; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    mp4: 'video/mp4',
    webm: 'video/webm',
});
// A file of a snapshot is the project's, never a page of this host: nothing of it runs here.
const FILE_HEADERS = Object.freeze({
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
    'referrer-policy': 'no-referrer',
});

const NO_SNAPSHOT = 'No snapshot of this account has this id.';
const PAUSED = 'Snapshots are paused in crossbind cloud; preview from this machine meanwhile, without --cloud.';
const TOO_BIG = `A snapshot holds ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB at most.`;
const TOO_MANY_FILES = `A snapshot holds ${MAX_SNAPSHOT_FILES} files at most.`;
const UNREADABLE = 'The archive could not be read: send a ustar archive of the web build\'s files, as crossbind app preview --cloud makes it.';

const utf8 = new TextEncoder();
const timestamp = (at) => new Date(at).toISOString();
const randomId = (bytes) => toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));

// A refusal of an upload, with its status and words.
class Refused extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

export const isPlainPath = (path) => typeof path === 'string' && PLAIN_PATH.test(path) && !path.startsWith(OWN_PATHS)
    && path.split('/').every((name) => name !== '.' && name !== '..');

// The archive's bytes as they come: a block taken whole, or a file's bytes handed on to its writer, never held whole.
function byteReader(stream) {
    const reader = stream.getReader();
    let held = new Uint8Array(0);
    const more = async () => {
        const { value, done } = await reader.read();
        if (done) return false;
        if (held.length === 0) {
            held = value;
        } else {
            const both = new Uint8Array(held.length + value.length);
            both.set(held);
            both.set(value, held.length);
            held = both;
        }
        return true;
    };
    // `size` bytes, each part handed to `use`.
    const consume = async (size, use) => {
        for (let left = size; left > 0;) {
            if (held.length === 0 && !(await more())) throw new Refused(400, UNREADABLE);
            const part = held.subarray(0, Math.min(left, held.length));
            held = held.subarray(part.length);
            left -= part.length;
            await use(part);
        }
    };
    return {
        // The next block, or null where the archive ends before it.
        async block() {
            while (held.length < BLOCK) {
                if (!(await more())) {
                    if (held.length === 0) return null;
                    throw new Refused(400, UNREADABLE);
                }
            }
            const block = held.subarray(0, BLOCK);
            held = held.subarray(BLOCK);
            return block;
        },
        pass: (size, writer) => consume(size, (part) => writer.write(part)),
        skip: (size) => consume(size, () => {}),
        cancel: () => reader.cancel().catch(() => {}),
    };
}

const text = (block, from, length) => new TextDecoder().decode(block.subarray(from, from + length)).replace(/\0[\s\S]*$/, '');
const octal = (value) => (/^[0-7]{1,12}$/.test(value.trim()) ? parseInt(value.trim(), 8) : null);

// An entry of a ustar archive: a regular file at a plain path, with its size. Its header's checksum holds, so that an
// archive read out of step is refused, not read as files.
function entryOf(block) {
    const sum = block.reduce((total, byte, at) => total + (at >= 148 && at < 156 ? 32 : byte), 0);
    const size = octal(text(block, 124, 12));
    if (octal(text(block, 148, 8)) !== sum || !text(block, 257, 6).startsWith('ustar') || size === null) throw new Refused(400, UNREADABLE);
    const [prefix, name] = [text(block, 345, 155), text(block, 0, 100)];
    const path = prefix ? `${prefix}/${name}` : name;
    if (!['0', ''].includes(text(block, 156, 1))) throw new Refused(400, `${JSON.stringify(path)} is not a file: a snapshot holds files alone.`);
    if (path.startsWith(OWN_PATHS)) throw new Refused(400, `${JSON.stringify(path)} is under ${OWN_PATHS}, whose paths crossbind answers itself.`);
    if (!isPlainPath(path)) throw new Refused(400, `${JSON.stringify(path)} is not a path of plain names: letters, digits and _@.+- between slashes.`);
    return { path, size };
}

async function removeKeys(bucket, keys) {
    for (let at = 0; at < keys.length; at += DELETE_BATCH) await bucket.delete(keys.slice(at, at + DELETE_BATCH));
}

async function removePrefix(bucket, prefix) {
    for (let cursor; ;) {
        const listed = await bucket.list({ prefix, cursor });
        await removeKeys(bucket, listed.objects.map((object) => object.key));
        if (!listed.truncated) return;
        cursor = listed.cursor;
    }
}

// One file's bytes into R2 as they come, through a stream of its known length, which R2 asks of a stream.
async function putFile(bucket, key, size, input) {
    const { readable, writable } = new FixedLengthStream(size);
    const putting = bucket.put(key, readable);
    putting.catch(() => {});
    const writer = writable.getWriter();
    try {
        await input.pass(size, writer);
        await writer.close();
    } catch (error) {
        await writer.abort(error).catch(() => {});
        throw error;
    }
    await putting;
}

// The snapshots in D1 and R2, each query held to its account but the host's, which the pairing key's gate holds.
export function createSnapshots(db, bucket, now = () => Date.now()) {
    return {
        // The account's snapshot of a project, made with an id and a key of the cloud's, drawn at random, or found again
        // by the project's id: { id }, or { error: 'full' } where it would make one more than MAX_SNAPSHOTS_PER_ACCOUNT
        // live. One statement counts and writes, so that snapshots asked for at once stop at the count.
        async start(userId, { projectId, projectName, protocol }) {
            const at = now();
            const row = await db.prepare(`INSERT INTO sessions (id, user_id, source, project_id, project_name, addresses, protocol, key, created_at, expires_at)
                SELECT ?1, ?2, 'snapshot', ?3, ?4, '[]', ?5, ?6, ?7, ?8
                WHERE (SELECT count(1) FROM sessions WHERE user_id = ?2 AND source = 'snapshot' AND project_id != ?3 AND expires_at > ?7) < ?9
                ON CONFLICT (user_id, project_id) WHERE source = 'snapshot' DO UPDATE SET project_name = excluded.project_name,
                protocol = excluded.protocol, expires_at = max(sessions.expires_at, excluded.expires_at)
                RETURNING id`)
                .bind(randomId(16), userId, projectId, projectName, protocol, randomToken(), timestamp(at), timestamp(at + FIRST_UPLOAD_MS), MAX_SNAPSHOTS_PER_ACCOUNT)
                .first();
            return row ? { id: row.id } : { error: 'full' };
        },

        // An upload of a live snapshot of the account, read entry by entry from `body` into R2 as it comes, and live once
        // every file is in, when the upload before it goes: { id, version, files, bytes, expiresAt }. A refusal throws
        // with its status and words, each cap checked before an entry's bytes are written; what a refused or broken upload
        // wrote is deleted before the answer, and waitUntil keeps that going for a client that left. `count` counts the
        // upload for the day, or refuses it, once the checks that read nothing have passed.
        async receive(userId, id, body, {
            declared, totalBytes, count, waitUntil,
        }) {
            const at = now();
            const row = await db.prepare("SELECT upload FROM sessions WHERE id = ? AND user_id = ? AND source = 'snapshot' AND expires_at > ?")
                .bind(id, userId, timestamp(at)).first();
            if (!row) throw new Refused(404, NO_SNAPSHOT);
            const held = await db.prepare("SELECT coalesce(sum(bytes), 0) AS held FROM sessions WHERE source = 'snapshot'").first('held');
            if (held + declared > totalBytes) throw new Refused(503, 'crossbind cloud holds as many snapshots as it can; try again tomorrow.');
            if (!body) throw new Refused(400, UNREADABLE);
            // Before a byte of the archive is read: a refusal past here stays counted.
            await count();
            const upload = randomId(12);
            const prefix = `${PREFIX}${id}/${upload}/`;
            const written = [];
            const input = byteReader(body);
            const discard = async () => {
                input.cancel();
                const cleanup = removeKeys(bucket, written);
                waitUntil(cleanup);
                await cleanup.catch((error) => log({ event: 'snapshot-cleanup-failed', who: userKey(userId), message: error.message }));
            };
            let [files, bytes, index] = [0, 0, false];
            try {
                for (;;) {
                    const block = await input.block();
                    if (block === null) throw new Refused(400, UNREADABLE);
                    if (block.every((byte) => byte === 0)) break;
                    const { path, size } = entryOf(block);
                    [files, bytes] = [files + 1, bytes + size];
                    if (files > MAX_SNAPSHOT_FILES) throw new Refused(413, TOO_MANY_FILES);
                    if (bytes > MAX_SNAPSHOT_BYTES) throw new Refused(413, TOO_BIG);
                    written.push(`${prefix}${path}`);
                    await putFile(bucket, `${prefix}${path}`, size, input);
                    await input.skip((BLOCK - (size % BLOCK)) % BLOCK);
                    index ||= path === 'index.html';
                }
                if (!index) throw new Refused(400, 'A snapshot is a web build: an index.html at its root.');
            } catch (error) {
                await discard();
                throw error instanceof Refused ? error : new Refused(400, `The archive could not be read: ${error.message}`);
            }
            input.cancel();
            // Live only while the snapshot is: one that ended meanwhile goes back through start(), which counts it.
            const done = await db.prepare(`UPDATE sessions SET upload = ?1, bytes = ?2, version = version + 1, expires_at = ?3
                WHERE id = ?4 AND user_id = ?5 AND source = 'snapshot' AND expires_at > ?6 RETURNING version, expires_at`)
                .bind(upload, bytes, timestamp(at + SNAPSHOT_DAYS * DAY_MS), id, userId, timestamp(now())).first();
            if (!done) {
                await discard();
                throw new Refused(404, NO_SNAPSHOT);
            }
            if (row.upload) waitUntil(removePrefix(bucket, `${PREFIX}${id}/${row.upload}/`));
            return {
                id, version: done.version, files, bytes, expiresAt: done.expires_at,
            };
        },

        // A live snapshot with its upload in, of an account not blocked, for the host: what its gate and its session need.
        served(id) {
            return db.prepare(`SELECT sessions.id, sessions.user_id, sessions.project_name, sessions.protocol, sessions.key, sessions.upload, sessions.version, users.login
                FROM sessions JOIN users ON users.id = sessions.user_id
                WHERE sessions.id = ? AND sessions.source = 'snapshot' AND sessions.upload IS NOT NULL AND sessions.expires_at > ? AND users.blocked = 0`)
                .bind(id, timestamp(now())).first();
        },

        // A file of a snapshot's upload, its body left out for a HEAD.
        file({ id, upload }, path, { head }) {
            const key = `${PREFIX}${id}/${upload}/${path}`;
            return head ? bucket.head(key) : bucket.get(key);
        },

        // A new key, drawn at random, for each snapshot of the account once a device that may have read the keys is
        // signed out: its gate tokens open nothing then, and a device still signed in reads the session again.
        async rekey(userId) {
            const { results } = await db.prepare("SELECT id FROM sessions WHERE user_id = ? AND source = 'snapshot'").bind(userId).all();
            if (results.length === 0) return;
            const statement = db.prepare("UPDATE sessions SET key = ? WHERE id = ? AND user_id = ? AND source = 'snapshot'");
            await db.batch(results.map(({ id }) => statement.bind(randomToken(), id, userId)));
        },

        // The ids of an account's snapshots, read before the account is deleted, whose rows go with it.
        async idsOf(userId) {
            const { results } = await db.prepare("SELECT id FROM sessions WHERE user_id = ? AND source = 'snapshot'").bind(userId).all();
            return results.map((row) => row.id);
        },

        // Every file of the snapshots named, whatever upload it is of.
        async removeFiles(ids) {
            for (const id of ids) await removePrefix(bucket, `${PREFIX}${id}/`);
        },

        // Run daily: every file no live snapshot names as its upload, once an hour old: a refused or cut upload's that its
        // cleanup missed, a replaced upload's, and an ended, blocked or deleted snapshot's.
        async prune() {
            const at = now();
            const { results } = await db.prepare("SELECT id, upload FROM sessions WHERE source = 'snapshot' AND upload IS NOT NULL AND expires_at > ?")
                .bind(timestamp(at)).all();
            const live = new Set(results.map((row) => `${PREFIX}${row.id}/${row.upload}/`));
            for (let cursor; ;) {
                const listed = await bucket.list({ prefix: PREFIX, cursor });
                const gone = listed.objects.filter((object) => object.uploaded.getTime() < at - PRUNE_AFTER_MS && !live.has(`${object.key.split('/').slice(0, 3).join('/')}/`));
                await removeKeys(bucket, gone.map((object) => object.key));
                if (!listed.truncated) return;
                cursor = listed.cursor;
            }
        },
    };
}

// An account deleted, with its snapshots' files at once: their rows go with its row (ON DELETE CASCADE), so their ids
// are read first. What a failure here leaves, the daily prune takes.
export async function deleteAccountWithSnapshots({ accounts, snapshots }, userId) {
    const ids = await snapshots.idsOf(userId);
    await accounts.deleteAccount(userId);
    try {
        await snapshots.removeFiles(ids);
    } catch (error) {
        log({ event: 'snapshot-files-left', who: userKey(userId), message: error.message });
    }
}

async function readProject(request) {
    try {
        const { project, protocol } = JSON.parse(await readLimited(request, MAX_BODY_BYTES)) ?? {};
        return isProject(project) && isProtocol(protocol) ? { projectId: project.id, projectName: project.name, protocol } : null;
    } catch (error) {
        if (error instanceof BodyTooLarge || error instanceof SyntaxError) return null;
        throw error;
    }
}

// POST /v1/snapshots, crossbind app preview --cloud's first call: the snapshot's id, made or found again.
export async function startSnapshotRoute({ request, deps, settings }, user) {
    if (!settings.snapshotsEnabled) return jsonResponse(503, { error: PAUSED });
    const project = await readProject(request);
    if (!project) return jsonResponse(400, { error: 'Send {"project": {"id", "name"}, "protocol"}.' });
    const started = await deps.snapshots.start(user.id, project);
    if (started.error) {
        return jsonResponse(429, { error: `This account keeps ${MAX_SNAPSHOTS_PER_ACCOUNT} snapshots, as many as it may: each ends ${SNAPSHOT_DAYS} days after its last upload.` });
    }
    return jsonResponse(200, { id: started.id });
}

// Today's uploads of an account and of everyone, counted exactly in the quota's Durable Object as compiles are, under
// keys of their own: R2 bills each file an upload writes, and the minute's limiter is counted at each Cloudflare location.
async function countUpload({ deps, settings }, user) {
    const counted = await deps.quota.reserve({
        key: `upload:${userKey(user.id)}`, everyoneKey: 'upload:*', limit: settings.snapshotUploadsDaily, globalLimit: settings.globalSnapshotUploadsDaily,
    });
    if (counted.ok) return;
    if (counted.reason === 'quota') throw new Refused(429, `This account has made ${settings.snapshotUploadsDaily} uploads today, as many as it may: try again tomorrow.`);
    throw new Refused(503, 'crossbind cloud has taken as many uploads today as it can; try again tomorrow.');
}

// PUT /v1/snapshots/<id>: the web build as one ustar archive with its length; ten a minute for an account, and
// SNAPSHOT_UPLOADS_DAILY a day for it and GLOBAL_SNAPSHOT_UPLOADS_DAILY for everyone.
export async function uploadSnapshotRoute({
    request, deps, settings, sessionId,
}, user) {
    if (!settings.snapshotsEnabled) return jsonResponse(503, { error: PAUSED });
    if (!isSessionId(sessionId)) return jsonResponse(404, { error: NO_SNAPSHOT });
    if (!(await deps.limits.upload.limit({ key: userKey(user.id) })).success) return jsonResponse(429, { error: 'Too many uploads for this account; try again in a minute.' });
    const declared = request.headers.get('content-length') ?? '';
    if (!/^\d{1,12}$/.test(declared)) return jsonResponse(411, { error: 'Send the archive with its Content-Length.' });
    if (Number(declared) > MAX_SNAPSHOT_BYTES + ARCHIVE_ROOM) return jsonResponse(413, { error: TOO_BIG });
    try {
        const uploaded = await deps.snapshots.receive(user.id, sessionId, request.body, {
            declared: Number(declared), totalBytes: settings.snapshotsTotalBytes, count: () => countUpload({ deps, settings }, user), waitUntil: deps.waitUntil,
        });
        log({
            event: 'snapshot-uploaded', who: userKey(user.id), files: uploaded.files, bytes: uploaded.bytes, version: uploaded.version,
        });
        return jsonResponse(200, uploaded);
    } catch (error) {
        if (!(error instanceof Refused)) throw error;
        log({ event: 'snapshot-refused', who: userKey(user.id), status: error.status });
        return jsonResponse(error.status, { error: error.message });
    }
}

const gateKey = (key) => crypto.subtle.importKey('raw', fromBase64Url(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
const isBase64url32 = (value) => typeof value === 'string' && BASE64URL_32.test(value) && toBase64Url(fromBase64Url(value)) === value;

// Whether a request carries the gate's token of the key: its HMAC of "crossbind-requests", in the one form it is written.
async function passesGate(request, key) {
    const given = request.headers.get(GATE_HEADER);
    return isBase64url32(given) && crypto.subtle.verify('HMAC', await gateKey(key), fromBase64Url(given), utf8.encode('crossbind-requests'));
}

// The session as crossbind app preview's dev server answers it (previewSession.js answerSession): the protocol, the
// session in base64url, and the key's proof over both and the device's challenge.
async function sessionAnswer(snapshot, challenge) {
    if (!isBase64url32(challenge)) return jsonResponse(400, { error: 'A session check takes a challenge of 32 bytes in base64url, 43 characters.' });
    const session = toBase64Url(utf8.encode(JSON.stringify({
        protocol: snapshot.protocol,
        project: { name: snapshot.project_name },
        account: { id: String(snapshot.user_id), name: nameOf({ id: snapshot.user_id, login: snapshot.login }) },
        session: snapshot.id,
        version: snapshot.version,
    })));
    const proof = await crypto.subtle.sign('HMAC', await gateKey(snapshot.key), utf8.encode(`crossbind-session.${snapshot.protocol}.${challenge}.${session}`));
    return jsonResponse(200, { protocol: snapshot.protocol, session, proof: toBase64Url(proof) });
}

// The snapshot host, https://<SNAPSHOTS_HOST>/<session>/<path>: GET and HEAD of a snapshot's files, and nothing of the
// API's, no page and no cookie. Behind a limiter of its own, as a snapshot loads many files at once; nothing answers
// without the gate's token, the session included, and an unknown snapshot gets the same 403, which tells nothing.
export async function handleSnapshotHost({
    request, deps, settings, network,
}) {
    if (!(await deps.limits.snapshot.limit({ key: network })).success) return jsonResponse(429, { error: 'Too many requests from this network; try again in a minute.' });
    const url = new URL(request.url);
    const [, id, ...rest] = url.pathname.split('/');
    const head = request.method === 'HEAD';
    if (!(head || request.method === 'GET') || !isSessionId(id)) return jsonResponse(404, { error: 'Not found.' });
    if (!settings.snapshotsEnabled) return jsonResponse(503, { error: 'Snapshots are paused in crossbind cloud.' });
    const snapshot = await deps.snapshots.served(id);
    if (!snapshot || !(await passesGate(request, snapshot.key))) return jsonResponse(403, { error: 'This snapshot answers the devices of its account alone.' });
    const path = rest.join('/') || 'index.html';
    if (path === SESSION_PATH) return sessionAnswer(snapshot, url.searchParams.get('challenge'));
    const object = isPlainPath(path) ? await deps.snapshots.file(snapshot, path, { head }) : null;
    if (!object) return jsonResponse(404, { error: 'Not found.' });
    const type = TYPES[path.split('.').pop().toLowerCase()] ?? 'application/octet-stream';
    return new Response(head ? null : object.body, { headers: { ...FILE_HEADERS, 'content-type': type, ...(head ? { 'content-length': String(object.size) } : {}) } });
}
