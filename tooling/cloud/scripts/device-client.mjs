// A test client of the device sign-in, for the checks run against a crossbind cloud that is up (device-check.mjs,
// session-check.mjs): it starts a sign-in as the crossbind app does, polls at the pace the cloud asks, and sends the
// number its person reads off the cloud's device page. It sends made-up values of its own alone.
import readline from 'node:readline/promises';

// What the test client says it is: the cloud's device page and the account's devices show it as "crossbind app 0.0.0
// on macOS 0.0" until the check signs it out.
export const CLIENT = Object.freeze({
    client: 'app', version: '0.0.0', platform: 'macos', os: '0.0',
});
const SLOW_DOWN_SECONDS = 5;
const NUMBER = /^\s*([1-9]\d)\s*$/;

const wait = (seconds) => new Promise((resolve) => { setTimeout(resolve, seconds * 1000); });

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

export function deviceClient(url) {
    async function call(method, route, { body, token } = {}) {
        const response = await fetch(`${url}${route}`, {
            method,
            headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: body && JSON.stringify(body),
            redirect: 'error',
        });
        return { status: response.status, body: await response.json().catch(() => ({})) };
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

    return { call, signIn };
}
