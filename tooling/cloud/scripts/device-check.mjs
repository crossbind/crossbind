// The device sign-in, checked against a crossbind cloud that is up, staging by default: a test client starts a sign-in
// as the crossbind app does, prints the code to enter on the cloud's device page, asks for the number that page shows
// once the code is approved there, and prints the account its token signs in to. It then shows that the cloud reads
// the token as the app's (its account read, usage refused), and signs it out. The client sends made-up values of its
// own alone, and its token is never printed.
// usage: node scripts/device-check.mjs [--url https://api-staging.crossbind.dev]
import readline from 'node:readline/promises';

const DEFAULT_URL = 'https://api-staging.crossbind.dev';
// What the test client says it is: the cloud's device page and the account's devices show it as "crossbind app 0.0.0
// on macOS 0.0" until the check signs it out.
const CLIENT = Object.freeze({
    client: 'app', version: '0.0.0', platform: 'macos', os: '0.0',
});
const SLOW_DOWN_SECONDS = 5;
const NUMBER = /^\s*([1-9]\d)\s*$/;

const at = process.argv.indexOf('--url');
const url = new URL(at === -1 ? DEFAULT_URL : process.argv[at + 1]).origin;
const wait = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });
const results = [];
function check(name, ok, detail) {
    results.push(ok);
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}\n`);
}

async function call(method, route, { body, token } = {}) {
    const response = await fetch(`${url}${route}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: body && JSON.stringify(body),
        redirect: 'error',
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
}

// The number the page shows, from this terminal or what is piped in: two digits, asked again for anything else. The
// terminal is read from the question on, so that a line piped in before it is not lost.
async function askNumber() {
    for (;;) {
        const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
        const answer = await terminal.question('the page shows a number once you approve: type it here (one try): ');
        terminal.close();
        const typed = NUMBER.exec(answer);
        if (typed) return Number(typed[1]);
    }
}

// Polls at the pace the cloud asks, the first time at once, so that the code is seen waiting before it is approved;
// the number goes once, as soon as it is typed.
async function signIn(started) {
    const answers = [];
    let pace = started.interval;
    let match;
    let atOnce = true;
    for (;;) {
        await wait(atOnce ? 0 : pace);
        atOnce = false;
        const answer = await call('POST', '/v1/device/token', { body: match === undefined ? { device_code: started.device_code } : { device_code: started.device_code, match } });
        answers.push(answer.body.error ?? 'signed in');
        if (answer.status === 200) return { answers, signed: answer.body };
        if (answer.body.error === 'slow_down') {
            pace += SLOW_DOWN_SECONDS;
        } else if (answer.body.error === 'matching_required' && match === undefined) {
            match = await askNumber();
            atOnce = true;
        } else if (answer.body.error !== 'authorization_pending' || match !== undefined) {
            return { answers, refused: answer.body };
        }
    }
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
