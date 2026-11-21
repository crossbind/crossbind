// A session of one account is invisible to another, checked against a crossbind cloud that is up, staging by default:
// run crossbind app preview there, signed in to one account, then this with the link it prints. A test client signs in
// as the crossbind app twice, each time with a code approved on the cloud's device page: as the account that runs the
// preview, which lists the session with its pairing key and finds it by its id, then as another account, unlinked from
// the first, which lists nothing of it and gets 404 for its id. Once the preview has stopped, the first finds it gone.
// Both tokens are signed out; no token, key or address is printed.
// usage: node scripts/session-check.mjs --session <the link crossbind app preview prints> [--url https://api-staging.crossbind.dev]
import readline from 'node:readline/promises';
import { CLIENT, deviceClient } from './device-client.mjs';

const DEFAULT_URL = 'https://api-staging.crossbind.dev';
const SESSION = /(?:^|[?&]s=)([A-Za-z0-9_-]{22})$/;

const option = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const url = new URL(option('--url') ?? DEFAULT_URL).origin;
const id = SESSION.exec(option('--session') ?? '')?.[1];
if (!id) throw new Error('usage: node scripts/session-check.mjs --session <the link crossbind app preview prints> [--url <cloud>]');
const { call, signIn } = deviceClient(url);
const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

// The test client signed in as the crossbind app, with a code approved on the device page by the account `whom` names.
async function appSignedIn(whom) {
    const started = await call('POST', '/v1/device/authorize', { body: CLIENT });
    if (started.status !== 200) throw new Error(`${url} answered the start with ${started.status}: ${JSON.stringify(started.body)}`);
    process.stdout.write(`open ${started.body.verification_uri} signed in as ${whom}, and enter the code ${started.body.user_code}; approve it, then type here the number the page shows\n`);
    const { signed, refused } = await signIn(started.body);
    if (!signed) throw new Error(`the sign-in ended: ${refused?.error_description}`);
    process.stdout.write(`signed in as ${signed.account.name} (account ${signed.account.id})\n`);
    return signed;
}

const listedFor = async (token) => (await call('GET', '/v1/sessions', { token })).body.sessions ?? [];

const first = await appSignedIn('the account crossbind app preview runs as');
const listed = (await listedFor(first.access_token)).find((session) => session.id === id);
const found = await call('GET', `/v1/sessions/${id}`, { token: first.access_token });
check('the preview\'s account lists its session, with a pairing key and a dev server\'s address, and finds it by its id',
    listed?.source === 'dev' && /^[A-Za-z0-9_-]{43}$/.test(listed.key) && listed.addresses.length > 0 && found.status === 200 && found.body.id === id,
    listed ? `${listed.project.name}, protocol ${listed.protocol}; by its id ${found.status}` : 'not listed');

const second = await appSignedIn('another account, unlinked from the first (sign out on the page, then sign in with the other way in)');
const strangers = await listedFor(second.access_token);
const strangerFinds = await call('GET', `/v1/sessions/${id}`, { token: second.access_token });
check('another account lists nothing of it, and gets 404 for its id', second.account.id !== first.account.id && !strangers.some((session) => session.id === id) && strangerFinds.status === 404,
    `account ${second.account.id === first.account.id ? 'the same one' : 'another'}, ${strangers.length} sessions listed, by its id ${strangerFinds.status}`);

const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
await terminal.question('stop crossbind app preview with Ctrl-C, then press Enter here: ');
terminal.close();
const gone = await call('GET', `/v1/sessions/${id}`, { token: first.access_token });
check('once the preview has stopped, its account finds the session gone', gone.status === 404, `${gone.status}`);

const ended = [];
for (const signed of [first, second]) {
    await call('DELETE', '/v1/token', { token: signed.access_token });
    ended.push((await call('GET', '/v1/account', { token: signed.access_token })).status);
}
check('both tokens are signed out', ended.every((status) => status === 401), ended.join(', '));
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
