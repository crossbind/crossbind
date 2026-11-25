// What a project's page does for e2e/app-projects/e2e/run.mjs, as the fixture opens it as a preview: it says it loaded,
// then takes each step from the run through the fixture's hooks, as the app's page does, and reports what each
// answered: every function the app may register, called past its crossbind/app, and some through it; the events it
// hears; its origin's storage; reads of its source; what it asks to use, and the question that asks its user; a reload;
// and the preview's end, with a message dialog of its own up or none. Its storage step is the app's page's too.
const DIALOG = "crossbind e2e: a project's dialog, which its preview's end closes";
const SHOWN_MS = 1500;
const LOCATION_MS = 5000;

const failure = (error) => `${error?.name ?? 'Error'}: ${error?.message ?? error}`;
const outcome = (promise) => promise.then((value) => ({ value: value ?? null }), (error) => ({ error: failure(error) }));
const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

// Whether a database of this name is on the page's origin: opening one that is not upgrades it, which is aborted, so
// that the look makes none.
function hasDatabase(name) {
    return new Promise((resolve) => {
        const opened = indexedDB.open(name);
        opened.onupgradeneeded = () => {
            opened.transaction.abort();
            resolve(false);
        };
        opened.onsuccess = () => {
            opened.result.close();
            resolve(true);
        };
        opened.onerror = () => resolve(false);
    });
}

function makeDatabase(name) {
    return new Promise((resolve, reject) => {
        const opened = indexedDB.open(name, 1);
        opened.onupgradeneeded = () => opened.result.createObjectStore('marks');
        opened.onsuccess = () => {
            opened.result.close();
            resolve();
        };
        opened.onerror = () => reject(opened.error);
    });
}

// What the origin's storage holds of the run's marks, in IndexedDB and in OPFS where the web view gives the origin one,
// then the page's own mark left in both.
export async function storage({ run, marks, mark }) {
    const named = (each) => `e2e-mark-${run}-${each}`;
    const root = navigator.storage?.getDirectory ? await navigator.storage.getDirectory().catch(() => null) : null;
    const seen = {};
    for (const each of marks) {
        seen[each] = {
            database: await hasDatabase(named(each)),
            file: root ? await root.getFileHandle(named(each)).then(() => true, () => false) : 'absent',
        };
    }
    if (mark) {
        await makeDatabase(named(mark));
        if (root) await root.getFileHandle(named(mark), { create: true });
    }
    return { origin: location.origin, seen };
}

// A message dialog asked: 'shown' where its call waits for its user, else what it answered at once.
export async function shownDialog(invoke, message, signal) {
    const shown = outcome(invoke('dialog.message', { message }, signal ? { signal } : {}));
    return { first: await Promise.race([shown, sleep(SHOWN_MS).then(() => 'shown')]), shown };
}

// A file of the page's source read in one range, as a media element asks.
async function range({ path, asked }) {
    const answer = await fetch(path, { headers: { Range: asked }, cache: 'no-store' });
    return { status: answer.status, range: answer.headers.get('content-range'), bytes: [...new Uint8Array(await answer.arrayBuffer())] };
}

// A path of the page's source as the page fetches it: its status and its text.
async function fetched({ path }) {
    const answer = await fetch(path, { cache: 'no-store' });
    return { status: answer.status, text: await answer.text() };
}

// What each of these functions answers the page that calls it itself, past its crossbind/app, with options none of them
// takes, so that one that runs fails as it reads them; on a phone after the page put a text of its own on the clipboard,
// which a read of it gives back without the system asking its user.
async function sweep({ names, text }, invoke) {
    if (text) await invoke('clipboard.writeText', { text });
    return Promise.all(names.map(async (name) => {
        const answered = await outcome(invoke(name, { filters: 1 }));
        return [name, answered.error ?? `answered ${JSON.stringify(answered.value)}`];
    })).then(Object.fromEntries);
}

// What the page hears of the hooks' event note: one sent to every page of the role app, then one sent to this page
// alone, which it waits for.
async function heard({ ms }, api, invoke) {
    const got = [];
    let own = null;
    const isOwn = new Promise((done) => { own = done; });
    const stop = api.events.on('e2e-hooks.note', (value) => {
        got.push(value);
        if (value === 'own') own();
    });
    await invoke('e2e-hooks.emit', { to: 'every', value: 'every' });
    await invoke('e2e-hooks.emit', { to: 'own', value: 'own' });
    await Promise.race([isOwn, sleep(ms)]);
    stop();
    return got;
}

// What the shell's file functions answer the page for a path the app's own page may reach.
function picked({ path }, invoke) {
    const names = ['shell.openPath', 'shell.revealInFolder', 'shell.trash'];
    return Promise.all(names.map(async (name) => [name, (await outcome(invoke(name, { path }))).error ?? 'answered'])).then(Object.fromEntries);
}

// What each of these functions of crossbind/app answers through the page's own import of it, as "dialog.open".
function throughModule({ names }, api) {
    return Promise.all(names.map(async (name) => {
        const [space, member] = name.split('.');
        return [name, (await outcome(api[space][member]({}))).error ?? 'answered'];
    })).then(Object.fromEntries);
}

// What a request for these kinds answers once it ends: allowed, denied, or what else ended it, as a device the machine
// lacks; the location allowed with no position as its code. By the page's own web API, or by the fixture's hook, which
// asks for the page's origin as an extension asks.
async function requested({ kinds, via }, invoke) {
    if (via === 'hook') {
        const { allowed } = await invoke('e2e-hooks.askPermission', { kinds, origin: location.origin });
        return allowed ? 'allowed' : 'denied';
    }
    if (kinds.includes('location')) {
        return new Promise((done) => {
            navigator.geolocation.getCurrentPosition(() => done('allowed'), (error) => done(error.code === 1 ? 'denied' : `allowed, code ${error.code}`), {
                timeout: LOCATION_MS, maximumAge: 0,
            });
        });
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: kinds.includes('camera'), audio: kinds.includes('microphone') });
        stream.getTracks().forEach((track) => track.stop());
        return 'allowed';
    } catch (error) {
        return error.name === 'NotAllowedError' ? 'denied' : error.name;
    }
}

// Starts each request at once and answers before any of them ends, each one's end then a note of its tag.
async function request({ requests }, invoke, note) {
    for (const asked of requests) {
        requested(asked, invoke).then(
            (answered) => note({ event: 'requested', tag: asked.tag, outcome: answered }),
            (error) => note({ event: 'requested', tag: asked.tag, outcome: failure(error) }),
        );
    }
    return 'started';
}

// The web's own question for notifications, which a page of the app asks no one.
async function notified() {
    return globalThis.Notification?.requestPermission ? String(await Notification.requestPermission()) : 'no Notification';
}

export async function runSteps(invoke, api) {
    const ask = async (path, body) => {
        const { status, text } = await invoke('e2e-hooks.ask', body === undefined ? { path } : { path, body: JSON.stringify(body) });
        if (status !== 200) throw new Error(`the run answered ${path} with ${status}`);
        return text ? JSON.parse(text) : null;
    };
    const steps = {
        sweep: (step) => sweep(step, invoke),
        heard: (step) => heard(step, api, invoke),
        picked: (step) => picked(step, invoke),
        throughModule: (step) => throughModule(step, api),
        storage,
        range,
        fetched,
        request: (step) => request(step, invoke, (body) => ask('/report', body)),
        question: () => invoke('e2e-hooks.question'),
        press: ({ button, words }) => invoke('e2e-hooks.press', { button, words }),
        cancel: () => invoke('e2e-hooks.cancel'),
        notified,
    };
    // On Windows, where a task dialog up holds the page's answers, the run calls through DevTools.
    globalThis.crossbindE2e = { invoke };
    await ask('/report', { loaded: location.origin });
    for (;;) {
        const step = await ask('/next');
        if (step.do === 'wait') continue;
        if (step.do === 'reload') {
            await ask('/report', { id: step.id, value: 'reloading' });
            location.reload();
            return;
        }
        if (step.do === 'close') {
            const dialog = step.withDialog ? await shownDialog(invoke, DIALOG) : null;
            // The report's own answer is not waited for: on Windows a message dialog's modal loop holds every answer to
            // the page until it closes, which the preview's end does. The run waits for both.
            ask('/report', { id: step.id, value: { dialog: dialog?.first ?? null } }).catch(() => {});
            await invoke('e2e-hooks.closePreview');
            return;
        }
        await ask('/report', { id: step.id, ...(await outcome(steps[step.do](step))) });
    }
}
