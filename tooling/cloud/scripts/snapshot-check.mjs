// Snapshots, checked against a crossbind cloud that is up, staging by default: a snapshot of 50 MB of files goes up and
// answers a byte range of a file, as a media element seeks; one of 500 small files goes up; a snapshot over the cap, of
// bytes or of files, is refused with 413 and the one before it stays; then the CLI's token removes it, and it answers as
// one that never was. A test client signs in twice with codes approved on the cloud's device page by the account to
// check: as `crossbind login` does, to upload and remove, and as the crossbind app does, to list and open, as the app's
// proxy asks the snapshot host. Its uploads are of a made-up project, the same at each run, whose snapshot the check
// removes as it ends. With --session, the link `crossbind app preview --cloud` printed for that account, it first opens
// that snapshot. With --rate, the 50 MB archive is sent at that many bytes a second, as from a slow line: it must end in
// 200 or in crossbind's own words, never in a page of Cloudflare's. About 100 MB go up in all. Both tokens are signed
// out; no token, key or id is printed.
// usage: node scripts/snapshot-check.mjs [--session <link>] [--rate <bytes/s>] [--url https://api-staging.crossbind.dev] [--snapshots https://snapshots-staging.crossbind.dev]
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
// One made-up project, the same at each run, whose snapshot the check makes and removes.
const PROJECT = Object.freeze({ id: createHash('sha256').update('crossbind-snapshot-check').digest().subarray(0, 16).toString('base64url'), name: 'made-up-snapshot-check' });
// A paced archive goes out this much at a time.
const PACED_CHUNK = 16 * 1024;
// The byte range read of the 50 MB snapshot's large file, from its middle.
const RANGE = Object.freeze({ start: 26_214_400, end: 26_214_499 });
const USAGE = 'usage: node scripts/snapshot-check.mjs [--session <the link crossbind app preview --cloud prints>] [--rate <bytes a second>] [--url <cloud>] [--snapshots <its snapshot host>]';

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const url = new URL(option('--url') ?? DEFAULT_URL).origin;
const snapshots = new URL(option('--snapshots') ?? DEFAULT_SNAPSHOTS).origin;
const link = option('--session');
const rate = option('--rate') === undefined ? undefined : Number(option('--rate'));
if ((link !== undefined && !SESSION.test(link)) || (rate !== undefined && !(Number.isSafeInteger(rate) && rate > 0))) throw new Error(USAGE);
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
// The archive's bytes at `bytesPerSecond`, as from a slow line: each chunk once its moment comes.
function paced(archive, bytesPerSecond) {
    const started = performance.now();
    let sent = 0;
    return new ReadableStream({
        async pull(controller) {
            if (sent >= archive.length) {
                controller.close();
                return;
            }
            const wait = started + (sent / bytesPerSecond) * 1000 - performance.now();
            if (wait > 0) await new Promise((resolve) => { setTimeout(resolve, wait); });
            const chunk = archive.subarray(sent, sent + PACED_CHUNK);
            sent += chunk.length;
            controller.enqueue(chunk);
        },
    });
}
// Its answer, the seconds it took, and a refusal's words: crossbind's, or where no JSON of crossbind's came back, the
// title of the page that did instead, Cloudflare's own, or its first words. Sent at `pace` bytes a second where given.
async function put(token, id, files, pace) {
    const archive = archiveOf(files);
    const started = performance.now();
    const response = await fetch(`${url}/v1/snapshots/${id}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/x-tar', 'content-length': String(archive.length) },
        body: pace ? paced(archive, pace) : archive,
        ...(pace ? { duplex: 'half' } : {}),
        redirect: 'error',
    });
    const text = await response.text();
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    let answer = {};
    try {
        answer = JSON.parse(text);
    } catch {
        // No JSON of crossbind's: its words come from the page below.
    }
    const words = answer.error ?? (response.ok ? '' : (/<title>([^<]*)<\/title>/i.exec(text)?.[1] ?? text).replace(/\s+/g, ' ').trim().slice(0, 120));
    return {
        status: response.status, body: answer, seconds, words,
    };
}
// An upload's status, its seconds and a refusal's words, as the checks print them.
const told = ({ status, seconds, words }) => `${status} in ${seconds} s${words ? `: ${words}` : ''}`;
const smallFiles = (count) => [['index.html', PAGE], ...Array.from({ length: count - 1 }, (_, at) => [`f${String(at).padStart(3, '0')}.js`, Buffer.from(`// ${at}\n`)])];

// The snapshot host as the crossbind app's proxy asks it, with the gate's token of the key the account's list gives.
const open = (session, path, { token = true, method = 'GET', headers = {} } = {}) => fetch(`${snapshots}/${session.id}/${path}`, {
    method, headers: { ...(token ? { 'x-crossbind-preview': gateToken(session.key) } : {}), ...headers }, redirect: 'error',
});
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

// Bytes that differ with where they stand, so that a range read at another offset reads others.
const bigFile = Buffer.from(Uint8Array.from({ length: MAX_SNAPSHOT_BYTES - PAGE.length }, (_, at) => at % 251));
const near = await put(cli.access_token, id, [['index.html', PAGE], ['big.bin', bigFile]], rate);
const nearTaken = near.status === 200 && near.body.bytes === MAX_SNAPSHOT_BYTES;
check(`a snapshot of ${MAX_SNAPSHOT_BYTES / 1024 / 1024} MB of files, the cap, ${rate === undefined ? 'goes up' : `sent at ${rate} bytes a second, ends in 200 or in crossbind's own words`}`,
    nearTaken || (rate !== undefined && typeof near.body.error === 'string'), `${told(near)}, version ${near.body.version}`);

// A byte range from the middle of its large file, one past the file's end, and a HEAD, as a media element asks them.
const big = nearTaken ? await listed(id) : undefined;
const rangeStarted = performance.now();
const ranged = big && await open(big, 'big.bin', { headers: { range: `bytes=${RANGE.start}-${RANGE.end}` } });
const rangedBytes = ranged && Buffer.from(await ranged.arrayBuffer());
const rangeSeconds = ((performance.now() - rangeStarted) / 1000).toFixed(1);
const past = big && await open(big, 'big.bin', { headers: { range: `bytes=${bigFile.length}-` } });
const head = big && await open(big, 'big.bin', { method: 'HEAD' });
check('a file of it answers a byte range with 206 and those bytes alone, one past its end with 416, and a HEAD with its length',
    ranged?.status === 206 && ranged.headers.get('content-range') === `bytes ${RANGE.start}-${RANGE.end}/${bigFile.length}` && rangedBytes.equals(bigFile.subarray(RANGE.start, RANGE.end + 1))
    && past.status === 416 && past.headers.get('content-range') === `bytes */${bigFile.length}`
    && head.status === 200 && head.headers.get('content-length') === String(bigFile.length) && head.headers.get('accept-ranges') === 'bytes',
    big ? `${ranged.status} (${rangedBytes.length} bytes in ${rangeSeconds} s), past its end ${past.status}, HEAD ${head.status} of ${head.headers.get('content-length')} bytes` : 'no snapshot of 50 MB to read');

const many = await put(cli.access_token, id, smallFiles(MAX_SNAPSHOT_FILES));
check(`a snapshot of ${MAX_SNAPSHOT_FILES} small files goes up`, many.status === 200 && many.body.files === MAX_SNAPSHOT_FILES, `${told(many)}, version ${many.body.version}`);

// Each over the cap at its last file, so that the refusal comes once nearly all of it was sent.
const overBytes = await put(cli.access_token, id, [['index.html', PAGE], ['big.bin', Buffer.alloc(MAX_SNAPSHOT_BYTES - PAGE.length, 7)], ['z.bin', Buffer.alloc(1024, 7)]]);
const overFiles = await put(cli.access_token, id, smallFiles(MAX_SNAPSHOT_FILES + 1));
check('over the cap, of bytes and of files, an upload is refused with 413', overBytes.status === 413 && overFiles.status === 413, `${told(overBytes)}; ${told(overFiles)}`);

const kept = await listed(id);
const last = kept && await open(kept, `f${String(MAX_SNAPSHOT_FILES - 2).padStart(3, '0')}.js`);
check('the snapshot before them stays: listed at its version, its files served', kept?.version === many.body.version && last.status === 200 && (await last.text()) === `// ${MAX_SNAPSHOT_FILES - 2}\n`,
    kept ? `version ${kept.version}, its last file ${last.status}` : 'not listed');

// The CLI's token removes it, as crossbind app preview --cloud --remove does; then it answers as one that never was.
const removeStarted = performance.now();
const removed = await call('DELETE', `/v1/snapshots/${id}`, { token: cli.access_token });
const removeSeconds = ((performance.now() - removeStarted) / 1000).toFixed(1);
const stillListed = await listed(id);
const found = await call('GET', `/v1/sessions/${id}`, { token: app.access_token });
const served = kept && await open(kept, 'index.html');
const again = await call('DELETE', `/v1/snapshots/${id}`, { token: app.access_token });
check('the CLI\'s token removes it, and it then answers as one that never was: listed no more, 404 by its id, the host\'s 403 to its key, 404 to a second removal',
    removed.status === 204 && stillListed === undefined && found.status === 404 && served?.status === 403 && again.status === 404,
    `${removed.status} in ${removeSeconds} s; ${stillListed ? 'still listed' : 'listed no more'}, ${found.status}, ${served?.status}, ${again.status}`);

const ended = [];
for (const signed of [cli, app]) {
    await call('DELETE', '/v1/token', { token: signed.access_token });
    ended.push((await call('GET', '/v1/account', { token: signed.access_token })).status);
}
check('both tokens are signed out', ended.every((status) => status === 401), ended.join(', '));
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
