// What e2e/desktop-app/e2e/preview.mjs reads of a previewed page, each line in the preview's terminal through Vite's
// console forwarding: the page loads with the device's platform and the crossbind app's crossbind/app; a function of the
// app's own pages is refused naming the role, after the project's own initNative() where it has one; the system's
// message dialog waits for its user, as the page first loads, until the conformance app's probe closes it; and an edit
// of preview-greeting.js comes in place, the page's state kept. The run puts this file beside another project's main.js.
import { app, device, dialog, invoke } from 'crossbind/app';
import { greeting } from './preview-greeting.js';

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

async function checkDialog() {
    const shown = answered(dialog.message({ message: MESSAGE }));
    const first = await within(shown, QUIET_MS, 'shown');
    const closed = first === 'shown' ? await invoke('probe.closeDialog', { message: MESSAGE }).catch(failure) : null;
    say('dialog', { dialog: first, closed, answer: await within(shown, ANSWER_MS, 'no answer once closed') });
}

export async function checkPreview(initNative) {
    say('load', {
        isReload, ticks, greeting, platform: import.meta.env.CROSSBIND_APP_PLATFORM, device: device.platform, origin: location.origin, secure: isSecureContext,
    });
    try {
        if (initNative) await initNative();
        say('paths', await answered(app.paths()));
        if (!isReload) await checkDialog();
    } catch (error) {
        say('failure', failure(error));
    }
}

if (import.meta.hot) {
    import.meta.hot.accept('./preview-greeting.js', (next) => say('hot', { isReload, ticks, greeting: next?.greeting }));
}
