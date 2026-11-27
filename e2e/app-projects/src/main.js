// The fixture's page, of the role app: it takes each step from e2e/run.mjs through the fixture's hooks, does it with the
// preview extension's functions as the crossbind app's own page will, and reports what each answered, and the links, the
// ends and the clearings the extension holds for it as they come. A step that opens a preview or goes to a page goes once
// reported, and one that clears a project's data is reported as it is asked; the page loads again as the preview ends.
import '/crossbind.js';
import { events, invoke } from 'crossbind/app';
import { preview } from '@crossbind/extension-preview';
import {
    clickFileInput, exitFullScreen, fileInput, fullScreen, shownDialog, storage,
} from '../../app-preview/src/project-steps.js';

const DIALOG = "crossbind e2e: the app's own dialog, after a preview";
// The first page of a served origin, the one URL a step sends the page to.
const SERVED = /^(crossbind:\/\/[0-9a-f]{32}\/|http:\/\/[0-9a-f]{32}\.localhost\/)$/;

const failure = (error) => `${error?.message ?? error}`;
const outcome = (promise) => promise.then((value) => ({ value: value ?? null }), (error) => ({ error: failure(error) }));

async function ask(path, body) {
    const { status, text } = await invoke('e2e-hooks.ask', body === undefined ? { path } : { path, body: JSON.stringify(body) });
    if (status !== 200) throw new Error(`the run answered ${path} with ${status}`);
    return text ? JSON.parse(text) : null;
}

// The device sign-in, typing the number given once the page asks for one, and the account the app is signed in to then.
async function signIn({ number }) {
    const messages = [];
    const signedIn = await outcome(preview.signIn({
        onMessage: (message) => {
            messages.push(message);
            if (message.number) preview.signInNumber(number).catch((error) => messages.push({ refused: failure(error) }));
        },
    }));
    return { messages, signedIn, after: await preview.account() };
}

// A check that stops, and what it leaves: no origin served, and nothing to open.
async function refuses({ session, origin }) {
    const checked = await outcome(preview.check(session));
    return { checked, served: await invoke('e2e-hooks.served', { name: origin }), opened: await outcome(preview.open(session)) };
}

// A check whose source the device cannot reach, cancelled once it says why where the system asks to let the app on
// the local network meanwhile.
async function unreachable({ session }) {
    const messages = [];
    const cancel = new AbortController();
    const checked = await outcome(preview.check(session, {
        signal: cancel.signal,
        onMessage: (message) => {
            messages.push(message);
            cancel.abort();
        },
    }));
    return { messages, checked };
}

// A check whose source answers only once the app signed out, and what it leaves to open: the run gives the page the step
// go once the source has the check, and the source its answer once the page reported go.
async function checkAcrossSignOut({ session, origin }) {
    const checking = outcome(preview.check(session));
    const go = await ask('/next');
    await ask('/report', { id: go.id, value: await preview.signOut() });
    const checked = await checking;
    return { checked, opened: await outcome(preview.open(session)), served: await invoke('e2e-hooks.served', { name: origin }) };
}

// The app's own message dialog: it shows, its call waiting, and goes as the call is cancelled.
async function dialog() {
    const cancel = new AbortController();
    const { first, shown } = await shownDialog(invoke, DIALOG, cancel.signal);
    cancel.abort();
    return { first, then: await shown };
}

const STEPS = {
    account: () => preview.account(),
    signIn,
    signOut: () => preview.signOut(),
    deleteAccount: () => preview.deleteAccount(),
    sessions: () => preview.sessions(),
    check: ({ session }) => preview.check(session),
    refuses,
    unreachable,
    checkAcrossSignOut,
    open: async ({ session }) => ({ sheet: await preview.check(session), ...(await preview.open(session)) }),
    storage,
    dialog,
    compile: ({ files, packages }) => preview.compile({ files, packages }),
    remove: ({ session }) => preview.removeSnapshot(session),
    projects: () => preview.projects(),
    takeBack: ({ project, kind }) => preview.takeBack(project, kind),
    // A second window of the app's, on a desktop, whose page takes the steps of the roles app2 and project2; and this
    // page's own window closed.
    openWindow: () => invoke('windows.open', { path: '/index.html' }),
    handLink: ({ url }) => invoke('e2e-hooks.handLink', { url }),
    breakKey: () => invoke('e2e-hooks.breakKey'),
    allow: ({ path }) => invoke('e2e-hooks.allow', { path }),
    paths: () => invoke('app.paths'),
    question: () => invoke('e2e-hooks.question'),
    askPermission: ({ kinds, origin }) => invoke('e2e-hooks.askPermission', { kinds, origin }),
    indicator: () => invoke('e2e-hooks.indicator'),
    pressIndicator: ({ item, ms }) => invoke('e2e-hooks.pressIndicator', { item, ms }),
    fullScreen: (step) => fullScreen(step, (body) => ask('/report', body)),
    exitFullScreen,
    gesture: ({ script }) => invoke('e2e-hooks.gesture', { script }),
    openPreview: ({ session, ms }) => invoke('e2e-hooks.openPreview', { session, ms: ms ?? 0 }),
    openTwo: ({ first, second }) => invoke('e2e-hooks.openTwo', { first, second }),
    fileInput: async () => fileInput((body) => ask('/report', body)),
    clickFile: () => clickFileInput(invoke, (body) => ask('/report', body)),
    pickerUp: () => invoke('e2e-hooks.pickerUp'),
    dismissPicker: () => invoke('e2e-hooks.dismissPicker'),
    cycleActive: () => invoke('e2e-hooks.cycleActive'),
    fillScreen: () => invoke('e2e-hooks.fillScreen'),
    served: ({ origin }) => invoke('e2e-hooks.served', { name: origin }),
    close: () => preview.close(),
    // A request of an origin, as a page of the app's could make one: its status, or why it failed.
    fetched: ({ url }) => fetch(url, { cache: 'no-store' }).then((answer) => `${answer.status}`, (error) => `${error.name}`),
};

async function run() {
    await globalThis.Crossbind.initNative();
    events.on('preview.link', (link) => ask('/report', { event: 'link', link }));
    events.on('preview.ended', (ended) => ask('/report', { event: 'ended', ended }));
    events.on('preview.cleared', (cleared) => ask('/report', { event: 'cleared', cleared }));
    await ask('/report', {
        loaded: location.origin, links: await preview.links(), ended: await preview.ended(), cleared: await preview.cleared(),
    });
    for (;;) {
        const step = await ask('/next');
        if (step.do === 'wait') continue;
        if (step.do === 'done') return;
        // The page takes no next step, as Back its user presses, on Android, may move it.
        if (step.do === 'stop') {
            await ask('/report', { id: step.id, value: 'stopped' });
            return;
        }
        // The page goes as a project's clearing begins, or as it goes to a page or closes its window: the step reported
        // first; a clearing refused noted, the page staying.
        if (step.do === 'clearData') {
            await ask('/report', { id: step.id, value: 'asked' });
            const asked = await outcome(preview.clearData(step.project));
            if (asked.error === undefined) return;
            await ask('/report', { event: 'clearData', error: asked.error });
            continue;
        }
        if (step.do === 'go' || step.do === 'closeWindow') {
            await ask('/report', { id: step.id, value: 'going' });
            if (step.do !== 'go') await invoke('windows.close');
            else if (SERVED.test(step.url)) location.href = step.url;
            return;
        }
        const result = await outcome(STEPS[step.do](step));
        await ask('/report', { id: step.id, ...result });
        if ((step.do === 'open' || step.do === 'openTwo') && result.value?.url) {
            location.href = result.value.url;
            return;
        }
    }
}

run().catch((error) => console.error(`E2E ERR: ${failure(error)}`));
