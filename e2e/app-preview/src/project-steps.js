// What a project's page does for e2e/app-projects/e2e/run.mjs, as the fixture opens it as a preview: it says it loaded,
// then takes each step from the run through the fixture's hooks, as the app's page does, and reports what each
// answered: every function the app may register, called past its crossbind/app, and some through it; the events it
// hears; its origin's storage; reads of its source; what it asks to use, and the question that asks its user; a reload;
// the preview's end, with a message dialog of its own up or none; and what the preview's indicator and its menu do with
// the page: a press of the menu with the page's own dialog up, its history, its whole viewport painted, its full
// screen. Its storage and full screen steps are the app's page's too.
const DIALOG = "crossbind e2e: a project's dialog, which its preview's end closes";
const SHOWN_MS = 1500;
const STAYED_MS = 3000;

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
// A location request waits for its answer with no time of its own unless the run gives it one: Chromium counts the time
// a question is up against it.
async function requested({ kinds, via, positionMs }, invoke) {
    if (via === 'hook') {
        const { allowed } = await invoke('e2e-hooks.askPermission', { kinds, origin: location.origin });
        return allowed ? 'allowed' : 'denied';
    }
    if (kinds.includes('location')) {
        return new Promise((done) => {
            navigator.geolocation.getCurrentPosition(() => done('allowed'), (error) => done(error.code === 1 ? 'denied' : `allowed, code ${error.code}`), {
                maximumAge: 0, ...(positionMs ? { timeout: positionMs } : {}),
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

// The page's full screen as its user's click asks it, which the click itself, or a script run as one, starts once the
// step armed it: the page's own element, a video's element, or a video's own full screen. Its answer is noted.
export async function fullScreen({ way }, note) {
    let video = document.querySelector('video');
    if (way !== 'page' && !video) {
        video = document.body.appendChild(Object.assign(document.createElement('video'), {
            muted: true, playsInline: true, controls: true, src: '/inline.mp4',
        }));
        await new Promise((done) => {
            video.addEventListener('loadedmetadata', done, { once: true });
            setTimeout(done, 5000);
        });
    }
    const asked = () => {
        if (way === 'video') {
            video.webkitEnterFullscreen();
            return Promise.resolve('asked');
        }
        const element = way === 'page' ? document.documentElement : video;
        return element.requestFullscreen ? element.requestFullscreen().then(() => 'full') : Promise.reject(new TypeError('no requestFullscreen'));
    };
    globalThis.e2eFullScreen = () => {
        Promise.resolve().then(asked).then(
            (outcome) => note({ event: 'fullScreen', way, outcome, element: document.fullscreenElement?.localName ?? null }),
            (error) => note({ event: 'fullScreen', way, outcome: `${error.name}: ${error.message}` }),
        ).catch(() => {});
    };
    document.addEventListener('click', globalThis.e2eFullScreen, { once: true });
    return { enabled: document.fullscreenEnabled ?? null };
}

export async function exitFullScreen() {
    await document.exitFullscreen?.().catch(() => {});
    document.querySelector('video')?.webkitExitFullscreen?.();
    return document.fullscreenElement ?? null;
}

// The page's whole viewport one colour above everything the page can draw, and its user's touch on it noted.
async function paint({ color }, note) {
    const cover = document.body.appendChild(document.createElement('div'));
    cover.style.cssText = `position: fixed; inset: 0; z-index: 2147483647; background: ${color}`;
    cover.addEventListener('click', (event) => note({ event: 'touched', x: event.clientX, y: event.clientY }).catch(() => {}));
    return { width: innerWidth, height: innerHeight, ratio: devicePixelRatio };
}

// A file input over the page's whole viewport, which its user's tap opens, or the hooks' script as its user's click, and
// the names of the files it got noted.
export function fileInput(note) {
    const input = document.body.appendChild(Object.assign(document.createElement('input'), { type: 'file' }));
    input.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; z-index: 2147483647; opacity: 0.01';
    input.addEventListener('change', () => note({ event: 'files', origin: location.origin, names: [...input.files].map((file) => file.name) }).catch(() => {}));
    globalThis.e2eFile = () => input.click();
    return 'shown';
}

// The same input clicked as its user's click, by the hooks' script.
export async function clickFileInput(invoke, note) {
    fileInput(note);
    await invoke('e2e-hooks.gesture', { script: 'e2eFile(); undefined' });
    return 'clicked';
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
        press: ({ button, words, ms }) => invoke('e2e-hooks.press', { button, words, ms }),
        cancel: () => invoke('e2e-hooks.cancel'),
        notified,
        indicator: () => invoke('e2e-hooks.indicator'),
        fullScreen: (step) => fullScreen(step, (body) => ask('/report', body)),
        exitFullScreen,
        paint: (step) => paint(step, (body) => ask('/report', body)),
        // A message dialog of the page's own, up until the step after cancels its call.
        dialogUp: async ({ text }) => {
            globalThis.e2eDialog = new AbortController();
            return (await shownDialog(invoke, text, globalThis.e2eDialog.signal)).first;
        },
        cancelDialog: async () => {
            globalThis.e2eDialog?.abort();
            return 'cancelled';
        },
        // A file input clicked as its user's click, by the hooks' script, and the picker it brings up read.
        clickFile: () => clickFileInput(invoke, (body) => ask('/report', body)),
        fileInput: async () => fileInput((body) => ask('/report', body)),
        pickerUp: () => invoke('e2e-hooks.pickerUp'),
        dismissPicker: () => invoke('e2e-hooks.dismissPicker'),
        noteLater: ({ ms, tag }) => invoke('e2e-hooks.noteLater', { ms, tag }),
        // Whether the page heard the preview's end, which it keeps where its next page reads it.
        listenEnded: async () => {
            api.events.on('preview.ended', () => localStorage.setItem('e2e-heard-ended', 'yes'));
            return localStorage.getItem('e2e-heard-ended');
        },
        pressIndicator: ({ item, ms }) => invoke('e2e-hooks.pressIndicator', { item, ms }),
        gesture: ({ script }) => invoke('e2e-hooks.gesture', { script }),
        fillScreen: () => invoke('e2e-hooks.fillScreen'),
        cycleActive: () => invoke('e2e-hooks.cycleActive'),
        title: async ({ text }) => {
            document.title = text;
            return document.title;
        },
    };
    // On Windows, where a task dialog up holds the page's answers, the run calls through DevTools.
    globalThis.crossbindE2e = { invoke };
    // A page that would hold Back: as it loads, with no user's activation, it pushes a state of its own and replaces
    // history.back().
    if (location.pathname === '/holds-back.html' && !location.hash) {
        history.pushState(null, '', '#held');
        history.back = () => {};
    }
    await ask('/report', { loaded: location.origin, path: location.pathname, length: history.length });
    for (;;) {
        const step = await ask('/next');
        if (step.do === 'wait') continue;
        // A press of the preview's menu that reloads or ends the page, which comes once the page has reported it: the
        // page asks for no next step, which another page would get.
        // The page takes no next step, as a press its user's taps make, on Android, will reload or end it.
        if (step.do === 'stop') {
            await ask('/report', { id: step.id, value: 'stopped' });
            return;
        }
        // Several presses of the preview's menu armed natively at once, and a session opened by the app's own code after
        // them, as the presses may end the page before a step could arm the next; the hook reports the step first.
        if (step.do === 'presses') {
            await invoke('e2e-hooks.presses', {
                id: step.id, presses: step.presses, open: step.open ?? null, openMs: step.openMs ?? 0,
            });
            return;
        }
        if (step.do === 'pressIndicator' && step.ms) {
            await invoke('e2e-hooks.presses', {
                id: step.id, presses: [{ item: step.item, ms: step.ms }], open: null, openMs: 0,
            });
            return;
        }
        // A move of the page's own history, or to a path of its origin, once reported, and once the page has loaded: a
        // page's navigation before its load, with no user's activation, takes the page's own entry of the history.
        if (step.do === 'navigate') {
            await ask('/report', { id: step.id, value: { length: history.length } });
            if (document.readyState !== 'complete') await new Promise((resolve) => { addEventListener('load', () => setTimeout(resolve), { once: true }); });
            if (step.path) {
                location.assign(step.path);
                return;
            }
            history.go(step.n);
            // A page the move left in place, as where the app refuses it, takes the run's steps again.
            setTimeout(() => runSteps(invoke, api), STAYED_MS);
            return;
        }
        // The page's own dialog up as the preview's menu is pressed: the press, and the dialog's answer where the run
        // gives one, armed natively first, as the dialog holds the page, once the hook has reported the step; the
        // dialog's answer noted once it comes.
        if (step.do === 'held') {
            await invoke('e2e-hooks.presses', {
                id: step.id, presses: step.presses, open: null, openMs: 0,
            });
            // A page that stays once its dialog is answered, as no press reloads or ends it, takes the run's steps again.
            const answered = async (body) => {
                await ask('/report', { event: 'answered', dialog: step.dialog, ...body }).catch(() => {});
                if (step.resume) runSteps(invoke, api);
            };
            if (step.dialog === 'alert') setTimeout(() => answered({ value: String(alert(step.text)) }), 100);
            else outcome(invoke('dialog.message', { message: step.text })).then(answered);
            return;
        }
        // What the page does once ms passed, as its picker is up: a move within its document, a reload, or the
        // preview's end by the app's own code. A page that stays takes the run's steps again.
        if (step.do === 'later') {
            await ask('/report', { id: step.id, value: 'armed' });
            setTimeout(() => {
                if (step.what === 'pushState') {
                    history.pushState(null, '', '#moved');
                    runSteps(invoke, api);
                } else if (step.what === 'reload') {
                    location.reload();
                } else {
                    invoke('e2e-hooks.closePreview').catch(() => {});
                }
            }, step.ms);
            return;
        }
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
