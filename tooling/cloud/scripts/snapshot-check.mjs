// Snapshots, checked against a crossbind cloud that is up, staging by default: a snapshot over the cap, of bytes or of
// files, is refused with 413 and the one before it stays; a snapshot of 50 MB of files and one of 500 small files go
// up. A test client signs in twice with codes approved on the cloud's device page by the account to check: as
// `crossbind login` does, to upload, and as the crossbind app does, to list and open, as the app's proxy asks the
// snapshot host. Its uploads are of a made-up project, the same at each run, so the account keeps one snapshot of it, for
// 30 days after its last upload. With --session, the link `crossbind app preview --cloud` printed for that account, it
// first opens that snapshot. About 100 MB go up in all. Both tokens are signed out; no token, key or id is printed.
// usage: node scripts/snapshot-check.mjs [--session <link>] [--url https://api-staging.crossbind.dev] [--snapshots https://snapshots-staging.crossbind.dev]
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { CLIENT, CLI_CLIENT, deviceClient } from './device-client.mjs';
import { MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_FILES } from '../worker/snapshots.js';
import { gateToken, provenText } from '../../../core/crossbind/src/utils/previewSession.js';
import { ustarHeader } from '../../../core/crossbind/src/utils/snapshotArchive.js';

const DEFAULT_URL = 'https://api-staging.crossbind.dev';
const DEFAULT_SNAPSHOTS = 'https://snapshots-staging.crossbind.dev';
const SESSION = /(?:^|[?&]s=)([A-Za-z0-9_-]{22})$/;
const BLOCK = 512;
const PAGE = Buffer.from('<!doctype html><title>made-up snapshot check</title>');
// One made-up project, the same at each run, whose snapshot the account keeps.
const PROJECT = Object.freeze({ id: createHash('sha256').update('crossbind-snapshot-check').digest().subarray(0, 16).toString('base64url'), name: 'made-up-snapshot-check' });

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const url = new URL(option('--url') ?? DEFAULT_URL).origin;
const snapshots = new URL(option('--snapshots') ?? DEFAULT_SNAPSHOTS).origin;
const link = option('--session');
if (link !== undefined && !SESSION.test(link)) throw new Error('usage: node scripts/snapshot-check.mjs [--session <the link crossbind app preview --cloud prints>] [--url <cloud>] [--snapshots <its snapshot host>]');
const { call, signIn } = deviceClient(url);
const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

// The test client signed in as `client`, with a code approved on the device page by the account `whom` names.
async function signedIn(client, whom) {
    const started = await call('POST', '/v1/device/authorize', { body: client });
    if (started.status !== 200) throw new Error(`${url} answered the start with ${started.status}: ${JSON.stringify(started.body)}`);
    process.stdout.write(`open ${started.body.verification_uri} signed in as ${whom}, and enter the code ${started.body.user_code}; approve it, then type here the number the page shows\n`);
    const { signed, refused } = await signIn(started.body);
    if (!signed) throw new Error(`the sign-in ended: ${refused?.error_description}`);
    return signed;
}

// An archive of [path, bytes] files as crossbind app preview --cloud writes one, and its upload to the snapshot.
const archiveOf = (files) => Buffer.concat([...files.flatMap(([path, bytes]) => [ustarHeader(path, bytes.length), bytes, Buffer.alloc((BLOCK - (bytes.length % BLOCK)) % BLOCK)]), Buffer.alloc(2 * BLOCK)]);
async function put(token, id, files) {
    const body = archiveOf(files);
    const response = await fetch(`${url}/v1/snapshots/${id}`, {
        method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-tar', 'content-length': String(body.length) }, body, redirect: 'error',
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}
const smallFiles = (count) => [['index.html', PAGE], ...Array.from({ length: count - 1 }, (_, at) => [`f${String(at).padStart(3, '0')}.js`, Buffer.from(`// ${at}\n`)])];

// The snapshot host as the crossbind app's proxy asks it, with the gate's token of the key the account's list gives.
const open = (session, path, { token = true } = {}) => fetch(`${snapshots}/${session.id}/${path}`, { headers: token ? { 'x-crossbind-preview': gateToken(session.key) } : {}, redirect: 'error' });
const proves = async (session) => {
    const challenge = randomBytes(32).toString('base64url');
    const answer = await (await open(session, `__crossbind/session?challenge=${challenge}`)).json();
    return answer.proof === createHmac('sha256', Buffer.from(session.key, 'base64url')).update(provenText(answer.protocol, challenge, answer.session)).digest('base64url');
};

const cli = await signedIn(CLI_CLIENT, 'the account to check (this code is the CLI\'s)');
const app = await signedIn(CLIENT, 'the same account (this code is the crossbind app\'s)');
check('the CLI and the crossbind app sign in to the same account', cli.account.id === app.account.id, cli.account.name);
const listed = async (id) => ((await call('GET', '/v1/sessions', { token: app.access_token })).body.sessions ?? []).find((session) => session.id === id);

if (link !== undefined) {
    const session = await listed(SESSION.exec(link)[1]);
    const page = session && await open(session, 'index.html');
    const without = session && await open(session, 'index.html', { token: false });
    check('the snapshot crossbind app preview --cloud uploaded is listed for the account\'s crossbind app, and its host serves its page to its key\'s token alone, with the session\'s proof',
        session?.source === 'snapshot' && page.status === 200 && page.headers.get('content-type') === 'text/html; charset=utf-8' && without.status === 403 && await proves(session),
        session ? `${session.project.name}, version ${session.version}; page ${page.status}, without the token ${without.status}` : 'not listed');
}

const made = await call('POST', '/v1/snapshots', { token: cli.access_token, body: { project: PROJECT, protocol: 1 } });
check('the cloud makes the made-up project\'s snapshot, or finds it again', made.status === 200 && SESSION.test(made.body.id ?? ''), `${made.status}${made.body.error ? ` ${made.body.error}` : ''}`);
const { id } = made.body;

const near = await put(cli.access_token, id, [['index.html', PAGE], ['big.bin', Buffer.alloc(MAX_SNAPSHOT_BYTES - PAGE.length, 7)]]);
check(`a snapshot of ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB of files, the cap, goes up`, near.status === 200 && near.body.bytes === MAX_SNAPSHOT_BYTES, `${near.status}, version ${near.body.version}`);
const many = await put(cli.access_token, id, smallFiles(MAX_SNAPSHOT_FILES));
check(`a snapshot of ${MAX_SNAPSHOT_FILES} small files goes up`, many.status === 200 && many.body.files === MAX_SNAPSHOT_FILES, `${many.status}, version ${many.body.version}`);

// Each over the cap at its last file, so that the refusal comes once nearly all of it was sent.
const overBytes = await put(cli.access_token, id, [['index.html', PAGE], ['big.bin', Buffer.alloc(MAX_SNAPSHOT_BYTES - PAGE.length, 7)], ['z.bin', Buffer.alloc(1024, 7)]]);
const overFiles = await put(cli.access_token, id, smallFiles(MAX_SNAPSHOT_FILES + 1));
check('over the cap, of bytes and of files, an upload is refused with 413', overBytes.status === 413 && overFiles.status === 413, `${overBytes.status} ${overBytes.body.error}; ${overFiles.status} ${overFiles.body.error}`);

const kept = await listed(id);
const last = kept && await open(kept, `f${String(MAX_SNAPSHOT_FILES - 2).padStart(3, '0')}.js`);
check('the snapshot before them stays: listed at its version, its files served', kept?.version === many.body.version && last.status === 200 && (await last.text()) === `// ${MAX_SNAPSHOT_FILES - 2}\n`,
    kept ? `version ${kept.version}, its last file ${last.status}` : 'not listed');

const ended = [];
for (const signed of [cli, app]) {
    await call('DELETE', '/v1/token', { token: signed.access_token });
    ended.push((await call('GET', '/v1/account', { token: signed.access_token })).status);
}
check('both tokens are signed out', ended.every((status) => status === 401), ended.join(', '));
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
