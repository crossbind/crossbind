// What e2e/app-projects/e2e/run.mjs reads of a previewed page, each line in the preview's terminal through Vite's console
// forwarding: the page loads with the device's platform and the crossbind app's crossbind/app; a function that belongs
// to the built app is refused in a preview's words, after the project's own initNative() where it has one; the
// system's message dialog waits for its user, as the page first loads, until the page cancels its call; and an edit of
// preview-greeting.js comes in place, the page's state kept. Then the page takes the run's steps (project-steps.js).
import * as api from 'crossbind/app';
import { greeting } from './preview-greeting.js';
import { runSteps } from './project-steps.js';

const { app, device, invoke } = api;
const MESSAGE = "crossbind e2e: a preview's dialog";
const QUIET_MS = 3000;
const ANSWER_MS = 10000;
const TICK_MS = 100;

// A load of the page's own, as a native edit's: not the one the app opened.
const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
let ticks = 0;
setInterval(() => { ticks += 1; }, TICK_MS);

const say = (kind, value) => console.log(`PREVIEW ${kind} ${JSON.stringify(value)}`);
const failure = (error) => `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
const answered = (promise) => promise.then((value) => `answered ${JSON.stringify(value)}`, failure);
const within = (promise, ms, otherwise) => Promise.race([promise, new Promise((resolve) => { setTimeout(() => resolve(otherwise), ms); })]);

// The dialog shows, so its call waits for its user, and it goes as the page cancels the call.
async function checkDialog() {
    const cancel = new AbortController();
    const shown = answered(invoke('dialog.message', { message: MESSAGE }, { signal: cancel.signal }));
    const first = await within(shown, QUIET_MS, 'shown');
    cancel.abort();
    say('dialog', { dialog: first, answer: await within(shown, ANSWER_MS, 'no answer once cancelled') });
}

export async function checkPreview(initNative) {
    say('load', {
        isReload, ticks, greeting, platform: import.meta.env.CROSSBIND_APP_PLATFORM, device: device.platform, origin: location.origin, secure: isSecureContext,
    });
    try {
        if (initNative) await initNative();
        say('paths', await answered(app.paths()));
        if (!isReload) await checkDialog();
        await runSteps(invoke, api);
    } catch (error) {
        say('failure', failure(error));
    }
}

if (import.meta.hot) {
    import.meta.hot.accept('./preview-greeting.js', (next) => say('hot', { isReload, ticks, greeting: next?.greeting }));
}
