// The fixture's page, of the role app: it takes each step from e2e/run.mjs through the fixture's hooks, does it with the
// preview extension's functions as the crossbind app's own page will, and reports what each answered, and the links and
// the ends the extension holds for it as they come. A step that opens a preview goes to its origin once reported; the
// page loads again as the preview ends.
import '/crossbind.js';
import { events, invoke } from 'crossbind/app';
import { preview } from '@crossbind/extension-preview';
import { shownDialog, storage } from '../../app-preview/src/project-steps.js';

const DIALOG = "crossbind e2e: the app's own dialog, after a preview";

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
    handLink: ({ url }) => invoke('e2e-hooks.handLink', { url }),
    breakKey: () => invoke('e2e-hooks.breakKey'),
    allow: ({ path }) => invoke('e2e-hooks.allow', { path }),
};

async function run() {
    await globalThis.Crossbind.initNative();
    events.on('preview.link', (link) => ask('/report', { event: 'link', link }));
    events.on('preview.ended', (ended) => ask('/report', { event: 'ended', ended }));
    await ask('/report', { loaded: location.origin, links: await preview.links(), ended: await preview.ended() });
    for (;;) {
        const step = await ask('/next');
        if (step.do === 'wait') continue;
        if (step.do === 'done') return;
        const result = await outcome(STEPS[step.do](step));
        await ask('/report', { id: step.id, ...result });
        if (step.do === 'open' && result.value?.url) {
            location.href = result.value.url;
            return;
        }
    }
}

run().catch((error) => console.error(`E2E ERR: ${failure(error)}`));
