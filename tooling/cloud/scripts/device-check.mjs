// The device sign-in, checked against a crossbind cloud that is up, staging by default: a test client starts a sign-in
// as the crossbind app does, prints the code to enter on the cloud's device page, asks for the number that page shows
// once the code is approved there, and prints the account its token signs in to. It then shows that the cloud reads
// the token as the app's (its account read, usage refused), and signs it out. The client sends made-up values of its
// own alone, and its token is never printed.
// usage: node scripts/device-check.mjs [--url https://api-staging.crossbind.dev]
import { CLIENT, deviceClient } from './device-client.mjs';

const DEFAULT_URL = 'https://api-staging.crossbind.dev';

const at = process.argv.indexOf('--url');
const url = new URL(at === -1 ? DEFAULT_URL : process.argv[at + 1]).origin;
const { call, signIn } = deviceClient(url);
const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

const started = await call('POST', '/v1/device/authorize', { body: CLIENT });
if (started.status !== 200) throw new Error(`${url} answered the start with ${started.status}: ${JSON.stringify(started.body)}`);
const page = started.body.verification_uri;
check('the start answers a code of eight letters and the cloud\'s own device page', URL.parse(page)?.origin === url && /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/.test(started.body.user_code), page);
process.stdout.write(`open ${page}, sign in, and enter the code ${started.body.user_code}; approve it, then type here the number the page shows\n`);

const { answers, signed, refused } = await signIn(started.body);
check('the code waits until it is approved, then the number signs the client in', answers[0] === 'authorization_pending' && answers.includes('matching_required') && signed !== undefined,
    refused ? `${answers.join(', ')}: ${refused.error_description}` : answers.join(', '));
if (signed) {
    process.stdout.write(`signed in as ${signed.account.name} (account ${signed.account.id})\n`);
    const token = signed.access_token;
    const account = await call('GET', '/v1/account', { token });
    const usage = await call('GET', '/v1/usage', { token });
    check('the token is the crossbind app\'s: it reads its account, and usage refuses it', account.status === 200 && account.body.id === signed.account.id && usage.status === 403, `account ${account.status}, usage ${usage.status}`);
    const signedOut = await call('DELETE', '/v1/token', { token });
    const after = await call('GET', '/v1/account', { token });
    check('the token is signed out', signedOut.status === 204 && after.status === 401, `${signedOut.status}, then ${after.status}`);
}
const passed = results.filter(Boolean).length;
process.stdout.write(`${passed}/${results.length} checks pass\n`);
process.exitCode = results.length > 0 && passed === results.length ? 0 : 1;
