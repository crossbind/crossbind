// crossbind cloud as crossbind app preview and the crossbind app ask it, on this machine and for one run alone: made-up
// accounts and their tokens, the device sign-in, whose codes the run approves for an account and a number of its
// choosing, each account's sessions with their keys, a snapshot crossbind app preview --cloud uploads, served from a
// snapshot host of its own behind the gate of its key, and a compile; and servers that answer a session's check as the
// run tells them, on the run machine's own address. Each call is recorded. A home of the run's own, whose credentials
// sign crossbind app preview in, keeps this machine's own sign-in out of it.
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNTS = Object.freeze({
    main: Object.freeze({ id: '1099511627777', name: 'made-up-e2e' }),
    empty: Object.freeze({ id: '1099511627778', name: 'empty-e2e' }),
    other: Object.freeze({ id: '1099511627779', name: 'other-e2e' }),
});
export const CLI_TOKEN = `cbt_${'e'.repeat(43)}`;
export const COMPILED = Object.freeze({ loader: 'export default {};', wasm: 'AGFzbQEAAAA=', imports: [], log: '' });
const MISMATCH = 'The number did not match, and the code no longer works; start again.';
const SESSION_PATH = /^\/v1\/sessions\/([A-Za-z0-9_-]{22})$/;
const SNAPSHOT_PATH = /^\/v1\/snapshots\/([A-Za-z0-9_-]{22})$/;
const BLOCK = 512;
const TYPES = {
    html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', wasm: 'application/wasm', svg: 'image/svg+xml', mp4: 'video/mp4',
};

export const newId = () => randomBytes(16).toString('base64url');
export const newKey = () => randomBytes(32).toString('base64url');
export const gateToken = (key) => createHmac('sha256', Buffer.from(key, 'base64url')).update('crossbind-requests').digest('base64url');
const proofOf = (key, protocol, challenge, sent) => createHmac('sha256', Buffer.from(key, 'base64url')).update(`crossbind-session.${protocol}.${challenge}.${sent}`).digest('base64url');

function listen(server, port, host) {
    return new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, host, () => done(server.address().port));
    });
}

function bodyOf(asked) {
    return new Promise((done) => {
        const chunks = [];
        asked.on('data', (chunk) => chunks.push(chunk));
        asked.on('end', () => done(Buffer.concat(chunks)));
    });
}

const json = (answer, status, body, headers = {}) => answer.writeHead(status, { 'content-type': 'application/json', ...headers })
    .end(body === undefined ? undefined : JSON.stringify(body));

// The regular files of a ustar archive, as crossbind app preview --cloud writes one (utils/snapshotArchive.js).
function filesOfArchive(archive) {
    const files = new Map();
    for (let at = 0; at + BLOCK <= archive.length;) {
        const header = archive.subarray(at, at + BLOCK);
        if (header.every((byte) => byte === 0)) break;
        const text = (from, length) => header.subarray(from, from + length).toString('utf8').replace(/\0[\s\S]*$/, '');
        const path = [text(345, 155), text(0, 100)].filter(Boolean).join('/');
        const size = Number.parseInt(text(124, 12).trim(), 8);
        at += BLOCK;
        if ((text(156, 1) || '0') === '0') files.set(path, archive.subarray(at, at + size));
        at += Math.ceil(size / BLOCK) * BLOCK;
    }
    return files;
}

// A file as the snapshot host answers it: one byte range as 206, a range past the end as 416, a HEAD with its length; as
// a file of nothing that runs there, which the app's proxy passes on without that policy.
function answerFile(asked, answer, body, path) {
    const headers = {
        'content-type': TYPES[path.split('.').pop()] ?? 'application/octet-stream',
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
    };
    const range = /^bytes=(\d*)-(\d*)$/.exec(asked.headers.range ?? '');
    if (range && (range[1] !== '' || range[2] !== '') && body.length > 0) {
        const start = range[1] === '' ? Math.max(0, body.length - Number(range[2])) : Number(range[1]);
        const end = range[1] === '' || range[2] === '' ? body.length - 1 : Math.min(Number(range[2]), body.length - 1);
        if (start >= body.length) {
            answer.writeHead(416, { ...headers, 'content-range': `bytes */${body.length}` }).end();
            return 416;
        }
        answer.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${body.length}` }).end(asked.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
        return 206;
    }
    answer.writeHead(200, { ...headers, 'content-length': String(body.length) }).end(asked.method === 'HEAD' ? undefined : body);
    return 200;
}

// What a check of a session answers: the protocol, the session in base64url, and the key's proof over both and the
// challenge, as crossbind app preview's dev server answers it (core/crossbind/src/utils/previewSession.js).
export function sessionAnswer({ key, protocol, challenge, session, sent = Buffer.from(JSON.stringify(session)).toString('base64url') }) {
    return { protocol, session: sent, proof: proofOf(key, protocol, challenge, sent) };
}

export async function standInCloud({ apiPort, snapshotsPort }) {
    const calls = [];
    const approvals = [];
    const codes = new Map();
    const tokens = new Map([[CLI_TOKEN, { account: ACCOUNTS.main, kind: 'cli' }]]);
    const sessions = new Map();
    // Every token and key it made or took, for the run to look for where none may be.
    const secrets = new Set([CLI_TOKEN]);
    const kept = (secret) => {
        secrets.add(secret);
        return secret;
    };
    const settings = { page: null };
    // The readings of a session the run holds the answer of until it lets them go, by the session's id.
    const held = new Map();
    let api = '';
    const listed = (account) => [...sessions.values()].filter((session) => session.account.id === account.id && (session.source === 'dev' || session.version > 0))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const shown = ({ account, files, ...session }) => session;

    const routes = {
        'POST /v1/device/authorize': (asked, answer) => {
            const deviceCode = randomBytes(32).toString('base64url');
            codes.set(deviceCode, { approval: approvals.shift() ?? null, polls: 0 });
            json(answer, 200, {
                device_code: deviceCode, user_code: 'NPCC-CNQN', verification_uri: settings.page ?? `${api}/device`, expires_in: 600, interval: 1,
            });
        },
        'POST /v1/device/token': (asked, answer, { device_code: deviceCode, match }) => {
            const code = codes.get(deviceCode);
            if (!code) return json(answer, 400, { error: 'invalid_grant', error_description: 'No sign-in has this code; start again.' });
            code.polls += 1;
            if (!code.approval || code.polls === 1) return json(answer, 400, { error: 'authorization_pending', error_description: 'The code waits to be approved on the page.' });
            if (match === undefined) return json(answer, 400, { error: 'matching_required', error_description: 'The code is approved: send the number the page shows.' });
            codes.delete(deviceCode);
            if (match !== code.approval.match) return json(answer, 400, { error: 'access_denied', error_description: MISMATCH });
            const token = kept(`cbt_${randomBytes(32).toString('base64url')}`);
            tokens.set(token, { account: code.approval.account, kind: 'app' });
            return json(answer, 200, { access_token: token, token_type: 'Bearer', account: code.approval.account });
        },
    };

    const signedIn = (asked, answer, kinds) => {
        const token = /^Bearer (.+)$/.exec(asked.headers.authorization ?? '')?.[1];
        const held = tokens.get(token);
        if (!held) {
            json(answer, 401, { error: 'Sign in with crossbind login.' });
            return null;
        }
        if (!kinds.includes(held.kind)) {
            json(answer, 403, { error: 'This token cannot be used here.' });
            return null;
        }
        return { ...held, token };
    };

    function answerApi(asked, answer, text, isLetGo = false) {
        if (isLetGo) held.delete(SESSION_PATH.exec(new URL(asked.url, 'http://cloud').pathname)?.[1]);
        const { pathname } = new URL(asked.url, 'http://cloud');
        const route = routes[`${asked.method} ${pathname}`];
        if (route) return route(asked, answer, text.length > 0 ? JSON.parse(text) : {});
        const session = SESSION_PATH.exec(pathname)?.[1];
        const snapshot = SNAPSHOT_PATH.exec(pathname)?.[1];
        const call = `${asked.method} ${pathname.replace(/[A-Za-z0-9_-]{22}$/, '<id>')}`;
        const cli = ['cli'];
        const app = ['app'];
        const every = ['cli', 'app'];
        if (call === 'GET /v1/account') {
            const held = signedIn(asked, answer, every);
            return held && json(answer, 200, held.account);
        }
        if (call === 'PUT /v1/sessions/<id>') {
            const held = signedIn(asked, answer, cli);
            if (!held) return null;
            const known = sessions.get(session);
            const registered = JSON.parse(text);
            kept(registered.key);
            sessions.set(session, { ...registered, id: session, account: held.account, createdAt: known?.createdAt ?? new Date().toISOString() });
            return json(answer, 200, { id: session, expiresAt: new Date(Date.now() + 600_000).toISOString() });
        }
        if (call === 'DELETE /v1/sessions/<id>') {
            const held = signedIn(asked, answer, cli);
            if (!held) return null;
            return sessions.delete(session) ? answer.writeHead(204).end() : json(answer, 404, { error: 'No session of this account has this id.' });
        }
        if (call === 'GET /v1/sessions') {
            const held = signedIn(asked, answer, app);
            return held && json(answer, 200, { sessions: listed(held.account).map(shown) });
        }
        if (call === 'GET /v1/sessions/<id>') {
            const holding = held.get(session);
            if (holding) return holding.then(() => answerApi(asked, answer, text, true));
            const caller = signedIn(asked, answer, app);
            if (!caller) return null;
            const found = listed(caller.account).find(({ id }) => id === session);
            return found ? json(answer, 200, shown(found)) : json(answer, 404, { error: 'No session of this account has this id.' });
        }
        if (call === 'POST /v1/snapshots') {
            const held = signedIn(asked, answer, cli);
            if (!held) return null;
            const { project, protocol } = JSON.parse(text);
            const known = [...sessions.values()].find((each) => each.source === 'snapshot' && each.account.id === held.account.id && each.project.id === project.id);
            const id = known?.id ?? newId();
            if (!known) {
                sessions.set(id, {
                    id, source: 'snapshot', account: held.account, project, addresses: [], protocol, key: kept(newKey()), version: 0, createdAt: new Date().toISOString(), files: new Map(),
                });
            }
            return json(answer, 200, { id });
        }
        if (call === 'PUT /v1/snapshots/<id>') {
            const held = signedIn(asked, answer, cli);
            const found = held && sessions.get(snapshot);
            if (!found || found.account.id !== held.account.id) return held && json(answer, 404, { error: 'No snapshot of this account has this id.' });
            found.files = filesOfArchive(text);
            found.version += 1;
            const bytes = [...found.files.values()].reduce((sum, file) => sum + file.length, 0);
            return json(answer, 200, {
                id: snapshot, version: found.version, files: found.files.size, bytes, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            });
        }
        if (call === 'DELETE /v1/snapshots/<id>') {
            const held = signedIn(asked, answer, every);
            const found = held && sessions.get(snapshot);
            if (!found || found.source !== 'snapshot' || found.account.id !== held.account.id) return held && json(answer, 404, { error: 'No snapshot of this account has this id.' });
            sessions.delete(snapshot);
            return answer.writeHead(204).end();
        }
        if (call === 'DELETE /v1/token') {
            const held = signedIn(asked, answer, every);
            if (!held) return null;
            tokens.delete(held.token);
            // A crossbind app signed out may have read the snapshots' keys: they change, as the cloud's do.
            if (held.kind === 'app') {
                listed(held.account).filter(({ source }) => source === 'snapshot').forEach((found) => {
                    found.key = kept(newKey());
                });
            }
            return answer.writeHead(204).end();
        }
        if (call === 'DELETE /v1/account') {
            const held = signedIn(asked, answer, every);
            if (!held) return null;
            for (const [id, found] of sessions) if (found.account.id === held.account.id) sessions.delete(id);
            for (const [token, kept] of tokens) if (kept.account.id === held.account.id && token !== CLI_TOKEN) tokens.delete(token);
            return answer.writeHead(204).end();
        }
        if (call === 'POST /playground/compile') {
            const held = signedIn(asked, answer, app);
            return held && json(answer, 200, COMPILED);
        }
        return json(answer, 404, { error: 'Not found.' });
    }

    const apiServer = createServer(async (asked, answer) => {
        const text = await bodyOf(asked);
        const isArchive = asked.method === 'PUT' && SNAPSHOT_PATH.test(asked.url);
        calls.push({
            host: 'api', call: `${asked.method} ${asked.url}`, authorization: asked.headers.authorization, body: isArchive || text.length === 0 ? undefined : JSON.parse(text.toString('utf8')),
        });
        answerApi(asked, answer, isArchive ? text : text.toString('utf8'));
    });

    // The snapshot host: nothing answers without the gate's token, the session's check among it.
    const snapshotServer = createServer(async (asked, answer) => {
        await bodyOf(asked);
        const url = new URL(asked.url, 'http://snapshots');
        const [, id, ...rest] = url.pathname.split('/');
        const found = sessions.get(id);
        const path = rest.join('/') || 'index.html';
        const call = { host: 'snapshots', call: `${asked.method} ${asked.url}`, gate: asked.headers['x-crossbind-preview'], range: asked.headers.range };
        calls.push(call);
        if (!found || found.source !== 'snapshot' || found.version === 0 || asked.headers['x-crossbind-preview'] !== gateToken(found.key)) {
            call.status = 403;
            return json(answer, 403, { error: 'This snapshot answers the devices of its account alone.' });
        }
        if (path === '__crossbind/session') {
            call.status = 200;
            const session = {
                protocol: found.protocol, project: { name: found.project.name }, account: found.account, session: found.id, version: found.version,
            };
            return json(answer, 200, sessionAnswer({
                key: found.key, protocol: found.protocol, challenge: url.searchParams.get('challenge'), session,
            }));
        }
        const file = found.files.get(path);
        if (!file) {
            call.status = 404;
            return json(answer, 404, { error: 'Not found.' });
        }
        call.status = answerFile(asked, answer, file, path);
        return call.status;
    });

    await listen(apiServer, apiPort, '127.0.0.1');
    await listen(snapshotServer, snapshotsPort, '127.0.0.1');
    api = `http://127.0.0.1:${apiPort}`;
    const home = mkdtempSync(join(tmpdir(), 'crossbind-e2e-home-'));
    mkdirSync(join(home, '.crossbind'));
    writeFileSync(join(home, '.crossbind', 'credentials.json'), JSON.stringify({ [api]: { token: CLI_TOKEN, login: ACCOUNTS.main.name } }));
    return {
        calls,
        sessions,
        // The next device code is approved for this account, with this number on its page.
        approve: (account, match) => approvals.push({ account, match }),
        // A session of an account's list, as crossbind app preview would register it.
        list(account, session) {
            const id = newId();
            sessions.set(id, {
                id, account, createdAt: new Date().toISOString(), project: { id: newId(), name: 'e2e project' }, protocol: 1, key: newKey(), ...session,
            });
            kept(sessions.get(id).key);
            return sessions.get(id);
        },
        // A new key for a snapshot, as a sign-out of a device makes one.
        rekey(id) {
            sessions.get(id).key = kept(newKey());
        },
        // A snapshot of a project's files, as crossbind app preview --cloud makes one, at version 1; a higher version of
        // it, as an upload again makes one; and its removal.
        snapshot(account, project, files) {
            const id = newId();
            sessions.set(id, {
                id, source: 'snapshot', account, project, addresses: [], protocol: 1, key: kept(newKey()), version: 1, createdAt: new Date().toISOString(),
                files: new Map(Object.entries(files).map(([path, body]) => [path, Buffer.from(body)])),
            });
            return sessions.get(id);
        },
        raise(id) {
            sessions.get(id).version += 1;
        },
        remove(id) {
            sessions.delete(id);
        },
        // The app's tokens taken back, as a sign-out elsewhere does: its next call gets 401.
        revokeApps() {
            for (const [token, kept] of tokens) if (kept.kind === 'app') tokens.delete(token);
        },
        // The next readings of this session wait until the function given back lets them go.
        hold(id) {
            let release;
            held.set(id, new Promise((done) => { release = done; }));
            return release;
        },
        // The device page the next sign-in names.
        pageAt(page) {
            settings.page = page;
        },
        snapshotOf: (account) => [...sessions.values()].find((each) => each.source === 'snapshot' && each.account.id === account.id && each.version > 0),
        // The tokens it gave or took, the sessions' keys and each key's gate's token.
        secrets: () => [...secrets].flatMap((secret) => (secret.startsWith('cbt_') ? [secret] : [secret, gateToken(secret)])),
        // What crossbind app preview runs with: this cloud, and the home that signs in to it.
        env: { CROSSBIND_CLOUD_URL: api, HOME: home, USERPROFILE: home },
        close() {
            apiServer.close();
            snapshotServer.close();
            rmSync(home, { recursive: true, force: true });
        },
    };
}

// A server at the run machine's address on its network, as a session's source: it answers the session's check as it
// is told, and the gate's paths, its page among them, to a request with the gate's token, a file of { status, location }
// with that status alone. Each request is recorded.
export async function standInSource(address, { key, answer, files = {} }) {
    const asked = [];
    const server = createServer(async (request, response) => {
        await bodyOf(request);
        const url = new URL(request.url, 'http://source');
        asked.push({ path: url.pathname, gate: request.headers['x-crossbind-preview'] });
        if (url.pathname === '/__crossbind/session') {
            const answered = await answer(url.searchParams.get('challenge'));
            if (answered === null) return response.writeHead(404, { 'content-type': 'text/plain' }).end('not a preview');
            return json(response, 200, answered);
        }
        if (request.headers['x-crossbind-preview'] !== gateToken(key)) return response.writeHead(403).end();
        const file = files[url.pathname === '/' ? '/index.html' : url.pathname];
        if (file === undefined) return response.writeHead(404).end();
        if (file.status) return response.writeHead(file.status, file.location ? { location: file.location } : {}).end();
        return response.writeHead(200, { 'content-type': TYPES[url.pathname.split('.').pop()] ?? TYPES.html }).end(file);
    });
    const port = await listen(server, 0, address);
    return { address: `${address.includes(':') ? `[${address}]` : address}:${port}`, asked, close: () => server.close() };
}
