import { createServer } from 'node:http';

// The run's endpoint, which the fixture's hooks ask on the device's loopback: a page's next step, held until the run
// has one, and the report of each. A page that went with its ask held, as a closed app's, takes no step. What the pages
// report besides their steps' answers are notes: each load, and the links and ends the extension held. Every report is
// kept, so that the run can read all that a page got.
export const STEP_MS = 60000;
const HOLD_MS = 30000;
// Longer than a device keeps an idle connection for its next request, Android's five minutes: one the server closed
// first is reused there, and a report POSTed on it is lost ("unexpected end of stream").
const KEPT_ALIVE_MS = 600000;

function bodyText(asked) {
    return new Promise((done) => {
        let text = '';
        asked.on('data', (chunk) => { text += chunk; });
        asked.on('end', () => done(text));
    });
}

const hand = (answer, step) => answer.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(step));

export async function serveEndpoint(port) {
    const queues = { app: [], project: [] };
    const askers = { app: [], project: [] };
    const answers = new Map();
    const notes = [];
    const reports = [];
    const noteWaiters = [];
    let steps = 0;

    function nextStep(role, answer) {
        const step = queues[role].shift();
        if (step) {
            hand(answer, step);
            return;
        }
        const asker = { answer };
        const drop = () => {
            clearTimeout(asker.timer);
            const at = askers[role].indexOf(asker);
            if (at >= 0) askers[role].splice(at, 1);
        };
        asker.timer = setTimeout(() => {
            drop();
            hand(answer, { do: 'wait' });
        }, HOLD_MS);
        answer.once('close', drop);
        askers[role].push(asker);
    }

    function reported(role, body) {
        reports.push({ role, ...body });
        if (body.id !== undefined) {
            // A step's own answer alone: an id the run never gave reaches nothing.
            const answer = answers.get(body.id);
            if (typeof answer === 'function') answer(body);
            answers.delete(body.id);
            return;
        }
        const note = { role, ...body };
        notes.push(note);
        for (const waiter of [...noteWaiters]) {
            if (waiter.test(note)) waiter.resolve(note);
        }
    }

    const server = createServer(async (asked, answer) => {
        const url = new URL(asked.url, 'http://run');
        const role = url.searchParams.get('role') === 'project' ? 'project' : 'app';
        if (url.pathname === '/next' && asked.method === 'GET') {
            nextStep(role, answer);
            return;
        }
        if (url.pathname === '/report' && asked.method === 'POST') {
            const text = await bodyText(asked);
            answer.writeHead(200).end();
            reported(role, JSON.parse(text));
            return;
        }
        answer.writeHead(404).end();
    });
    server.keepAliveTimeout = KEPT_ALIVE_MS;
    await new Promise((done, fail) => {
        server.once('error', fail);
        server.listen(port, '127.0.0.1', done);
    });

    // A step for the page of this role, which answers once it did it.
    function step(role, what, ms = STEP_MS) {
        steps += 1;
        const given = { id: steps, ...what };
        const report = new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error(`the ${role}'s page did not report ${what.do} in ${ms / 1000} s`)), ms);
            answers.set(given.id, (body) => {
                clearTimeout(timer);
                done(body);
            });
        });
        const asker = askers[role].shift();
        if (asker) {
            clearTimeout(asker.timer);
            hand(asker.answer, given);
        } else {
            queues[role].push(given);
        }
        return report;
    }

    function waitForNote(test, ms, what) {
        return new Promise((done, fail) => {
            const waiter = { test };
            const timer = setTimeout(() => {
                noteWaiters.splice(noteWaiters.indexOf(waiter), 1);
                fail(new Error(`${what} did not come in ${ms / 1000} s`));
            }, ms);
            waiter.resolve = (note) => {
                clearTimeout(timer);
                noteWaiters.splice(noteWaiters.indexOf(waiter), 1);
                done(note);
            };
            noteWaiters.push(waiter);
        });
    }

    return {
        notes, reports, step, waitForNote, close: () => server.close(),
    };
}
