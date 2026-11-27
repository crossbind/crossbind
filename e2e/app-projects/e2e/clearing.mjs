import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { PAGE_REACHES, messageOf } from './consents.mjs';
import { indicatorsOn } from './indicator.mjs';
import { questionsOn, screenOf, storeOn } from './questions.mjs';

// What the preview's menu and the app's page clear of what a project keeps, as e2e/run.mjs checks it on each platform:
// Clear this project's data…'s question, read and answered as its user would, its ways out Cancel's; a clearing from the
// menu and one from the app's page, each store a project's page fills gone for its origin alone, with its answers, its
// note and its snapshot's version noted; the prefix that is the extension's; and what Settings calls, the projects the
// note holds and an Allow taken back. On a desktop a second window shows the project too, its worker holding a database
// open: where the clearing waits for it, it ends by its time, and the second window's requests to its end change nothing.
const LOAD_MS = 180000;
const QUESTION_MS = 30000;
const OUTCOME_MS = 60000;
const POLL_MS = 300;
const SETTLED_MS = 1500;
const PRESS_MS = 300;
const TOOL_MS = 30000;
// The extension's time for a clearing its page has not ended.
const CLEARING_MS = 10000;
// Android's emulator may give an allowed page no position, so its location requests end this long after they are made.
const POSITION_MS = 30000;
// Where a touch outside the question lands, as a share of the screen's height from its top.
const OUTSIDE_AT = 0.2;
const CLEAR = "Clear this project's data…";
const DETAIL = 'Its sources are untouched.';
const PREFIX = '/__crossbind-preview/';
const STORES = ['localStorage', 'sessionStorage', 'indexedDB', 'opfs', 'caches', 'cookies'];
const CLEARING_NOW = "crossbind clears a project's data now: try again once that is done.";
const UNLISTED_CLEAR = 'crossbind: preview.clearData(id) clears the data of a project preview.projects() lists.';
const UNLISTED_TAKE_BACK = "crossbind: preview.takeBack(id, kind) takes back the camera's, the microphone's or the location's Allow of a project preview.projects() lists.";
const UNFINISHED = (name) => `crossbind could not finish clearing what “${name}” keeps on this device, so some of it may stay. Its permissions are removed; clear its data again to remove the rest.`;
const questionOf = (name) => `Remove what “${name}” keeps on this device: its storage and its permissions?`;
const SNAPSHOT = 'e2e cleared snapshot';
const KEPT = 'e2e kept project';
const IDLE = 'e2e idle project';
const HELD = 'e2e held project';

// A service worker of the project's that answers every path, the steps page's own files through and any other with a page
// of its own, its cache filled as it installs; a worker that holds a database open, closing it on no one's word; and a
// file of the project's own under the prefix that is the extension's.
export const CLEARING_FILES = {
    'e2e-worker.js': `self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open('e2e-worker').then((cache) => cache.put('/e2e-worker-cached', new Response('worker'))));
});
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
    const { pathname } = new URL(event.request.url);
    const isOwn = pathname === '/' || pathname.endsWith('.html') || pathname.endsWith('.js') || pathname.startsWith('/__crossbind/');
    event.respondWith(isOwn ? fetch(event.request) : new Response('the worker answered ' + pathname, { headers: { 'content-type': 'text/html' } }));
});`,
    'e2e-database-worker.js': `const opened = indexedDB.open('e2e-holder', 1);
opened.onupgradeneeded = () => opened.result.createObjectStore('marks');
opened.onsuccess = () => {
    opened.result.onversionchange = () => {};
    postMessage('held');
};
opened.onerror = () => postMessage('failed: ' + opened.error?.name);`,
    '__crossbind-preview/own.txt': "a file of the project's own",
};

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

export async function checkClearing(run) {
    const {
        platform, endpoint, openSession, closePreview, stepsProject, stepsSnapshot, cloud, adb, accountName,
    } = run;
    const isDesktop = ['macos', 'windows', 'linux'].includes(platform);
    const indicators = indicatorsOn(run);
    const questions = questionsOn(run);
    await questions.prepare();
    const step = async (role, what) => {
        const answered = await endpoint.step(role, what);
        expect(answered.error === undefined, `the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    };
    const { data } = await step('app', { do: 'paths' });
    const consents = storeOn({ ...run, data });
    const versions = storeOn({ ...run, data }, 'versions.json');
    const note = storeOn({ ...run, data }, 'projects.json');
    consents.remove();
    const report = {};

    // The camera allowed at its question: by the page where nothing the system asks follows unanswered, else by the hook,
    // of the same holder, as permissions.mjs asks.
    const reaches = (kind) => PAGE_REACHES[platform].includes(kind);
    const allowVia = (kind) => (reaches(kind) && (platform === 'android' || (platform === 'ios' && kind !== 'location')) ? 'page' : 'hook');
    // Android's hooks ask nothing, so its page asks for what is denied; elsewhere the hook, as WebKit keeps a page's denial.
    const denyVia = () => (platform === 'android' ? 'page' : 'hook');
    const isAllowed = (answered, via) => (via === 'hook' ? answered === 'allowed' : answered !== 'denied' && !/^\w*Error: /.test(answered));
    let tags = 9100;
    async function start(kind, via) {
        const tag = (tags += 1);
        const position = kind === 'location' && platform === 'android' ? { positionMs: POSITION_MS } : {};
        await step('project', { do: 'request', requests: [{ tag, kinds: [kind], via, ...position }] });
        return tag;
    }
    async function outcome(tag) {
        const deadline = Date.now() + OUTCOME_MS;
        for (;;) {
            const done = endpoint.notes.find((note) => note.event === 'requested' && note.tag === tag);
            if (done) return done.outcome;
            if (platform === 'android' && questions.system()) questions.allowSystem();
            expect(Date.now() < deadline, `request ${tag} did not end in ${OUTCOME_MS / 1000} s`);
            await sleep(POLL_MS);
        }
    }
    async function upFor(test, what) {
        const deadline = Date.now() + QUESTION_MS;
        for (;;) {
            const shown = await questions.read('project');
            if (test(shown)) return shown;
            expect(Date.now() < deadline, `${what}: ${JSON.stringify(shown)}`);
            await sleep(POLL_MS);
        }
    }
    async function answerCamera(name, button) {
        const via = button === 'Allow' ? allowVia('camera') : denyVia();
        const tag = await start('camera', via);
        const message = messageOf(name, ['camera']);
        await upFor((shown) => shown?.texts.includes(message), `no question of the camera came for ${name}`);
        await questions.press('project', button, message);
        const answered = await outcome(tag);
        expect(button !== 'Allow' || isAllowed(answered, via), `the camera of ${name} was not allowed at its question: ${answered}`);
    }

    // The menu's Clear this project's data…, which brings its question up and leaves the page: pressed at once where the
    // hooks press it, as an armed press is one the page takes no step after. On Windows, as the dialog will hold every
    // answer to the page, from outside where the page will go meanwhile, the page taking no next step first.
    async function pressMenu({ isLeaving = false } = {}) {
        if (platform === 'android') {
            await indicators.press('project', CLEAR, 0, !isLeaving);
            return;
        }
        if (platform === 'windows' && isLeaving) {
            await step('project', { do: 'stop' });
            await questions.pressMenu(CLEAR);
            return;
        }
        await step('project', { do: 'pressIndicator', item: CLEAR });
    }
    const confirmation = (name) => upFor((shown) => shown?.texts.includes(questionOf(name)), `${CLEAR}'s question did not come for ${name}`);
    // No question up, as the page of this role reads it where the hooks read it.
    const isNone = async (role = 'project') => {
        await sleep(SETTLED_MS);
        return (await questions.read(role)) === null;
    };
    // Its Clear, which ends the page: armed by the hooks once the page reported the step where they press it; elsewhere
    // from outside, the page taking no next step first (pressMenu's isLeaving).
    async function pressClear(name) {
        if (platform === 'windows' || platform === 'android') {
            await questions.press('project', 'Clear', questionOf(name));
            return;
        }
        await indicators.presses('project', [{ button: 'Clear', words: questionOf(name), ms: PRESS_MS }]);
    }
    const appLoaded = (what, role = 'app') => endpoint.waitForNote((note) => note.role === role && note.loaded, LOAD_MS, what);
    const stores = (marks) => step('project', { do: 'stores', marks });
    const filledOf = (filled) => STORES.filter((store) => filled[store] === true);
    const projectsListed = async () => (await step('app', { do: 'projects' })).projects;
    const isListed = async (origin) => (await projectsListed()).some((each) => each.id === origin);
    const snapshotCalls = (session) => cloud.calls.filter((call) => call.host === 'snapshots' && call.call.includes(`/${session.id}/`)).length;

    // The projects: one kept as the others are cleared, a snapshot cleared from the menu, one cleared from the app's page.
    const kept = await stepsProject(KEPT, CLEARING_FILES);
    const snapshot = stepsSnapshot(SNAPSHOT, CLEARING_FILES);
    const idle = await stepsProject(IDLE, CLEARING_FILES);
    await openSession(kept.session, kept.origin);
    report.filledKept = await step('project', { do: 'fill', mark: 'kept' });
    await answerCamera(KEPT, 'Allow');
    // The prefix is the extension's: a project's own file there and the clearing's paths answer 404 outside a clearing,
    // and its source is asked for none of them.
    for (const path of [`${PREFIX}own.txt`, `${PREFIX}clear`, `${PREFIX}cleared?token=${'A'.repeat(43)}&left=`]) {
        const fetched = await step('project', { do: 'fetched', path });
        expect(fetched.status === 404, `${path} outside a clearing answered ${JSON.stringify(fetched)}`);
    }
    expect(kept.asked.every(({ path }) => !path.startsWith(PREFIX)), `the source was asked for ${JSON.stringify(kept.asked.filter(({ path }) => path.startsWith(PREFIX)))}`);
    report.prefix = '404, its source asked nothing';
    await closePreview();
    await openSession(idle.session, idle.origin);
    report.filledIdle = await step('project', { do: 'fill', mark: 'idle' });
    await closePreview();
    await openSession(snapshot.session, snapshot.origin);
    report.filled = await step('project', { do: 'fill', mark: 'cleared' });
    report.worker = await step('project', { do: 'worker' });
    await answerCamera(SNAPSHOT, 'Allow');
    const before = await stores(['cleared']);
    report.workers = before.workers;
    expect(filledOf(report.filled).every((store) => before.seen.cleared[store] === true) && versions.read()?.[snapshot.session.id] === 1
        && consents.read()?.[snapshot.origin]?.camera === true && note.read()?.[snapshot.origin]?.name === SNAPSHOT,
    `before its clearing the snapshot's marks, version, answer or note were not kept: ${JSON.stringify({ before, versions: versions.read(), consents: consents.read(), note: note.read()?.[snapshot.origin] })}`);

    // Its question: its words, its default, and Cancel and each way out leave the marks, the answers and the preview.
    await pressMenu();
    const up = await confirmation(SNAPSHOT);
    const isCancel = (drawn) => drawn === null || drawn === undefined || /^cancel$/i.test(drawn);
    expect(up.texts.includes(DETAIL) && up.buttons.some((button) => /^cancel$/i.test(button)) && up.buttons.some((button) => /^clear$/i.test(button))
        && isCancel(up.preferred) && isCancel(up.focused) && isCancel(up.escape), `${CLEAR}'s question read ${JSON.stringify(up)}`);
    report.question = {
        texts: up.texts, buttons: up.buttons, preferred: up.preferred ?? null, focused: up.focused ?? null, escape: up.escape ?? null,
    };
    await questions.press('project', 'Cancel', questionOf(SNAPSHOT));
    expect(await isNone(), `${CLEAR}'s question stayed after Cancel`);
    const ways = questions.waysOut('project');
    if (platform === 'android') {
        // A touch outside it, above it on the page, where the system's gestures take none.
        ways.push(['a touch outside', () => {
            const [, , right, bottom] = screenOf(adb())[0].bounds.match(/\d+/g).map(Number);
            spawnSync(adb(), ['shell', 'input', 'tap', String(Math.round(right / 2)), String(Math.round(bottom * OUTSIDE_AT))], { timeout: TOOL_MS });
        }]);
    }
    report.waysOut = [];
    for (const [way, take] of ways) {
        await pressMenu();
        await confirmation(SNAPSHOT);
        await take();
        expect(await isNone(), `${CLEAR}'s question stayed after ${way}`);
        report.waysOut.push(way);
    }
    // The key that presses a default, where the run sends one: Cancel's, or none where the system takes it to show the
    // focus first, as Android's touch mode does; never Clear's, which the marks below would show.
    if (platform === 'linux' || platform === 'android') {
        await pressMenu();
        await confirmation(SNAPSHOT);
        const key = questions.pressDefaultKey();
        await sleep(SETTLED_MS);
        const stays = await questions.read('project');
        if (stays) await questions.press('project', 'Cancel', questionOf(SNAPSHOT));
        report.defaultKey = stays ? `${key}: the question stays, ${stays.focused ?? 'nothing'} focused` : `${key}: closed`;
    }
    const kept1 = await stores(['cleared']);
    expect(STORES.every((store) => kept1.seen.cleared[store] === before.seen.cleared[store]) && consents.read()?.[snapshot.origin]?.camera === true
        && (await indicators.read('project')).up, `Cancel or a way out changed ${JSON.stringify({ kept1, consents: consents.read() })}`);

    // Pressed twice: one question, where a second press reaches the menu, as a desktop's does.
    if (isDesktop) {
        await pressMenu();
        await pressMenu();
        await confirmation(SNAPSHOT);
        await questions.press('project', 'Cancel', questionOf(SNAPSHOT));
        expect(await isNone(), `${CLEAR} pressed twice brought a second question`);
        report.pressedTwice = 'one question';
    }

    // Close preview with its question up: by the menu where it is reached so, on macOS, on Windows by its command, as the
    // dialog holds the window's menu, and elsewhere by the app's own code. The question closes and nothing is cleared.
    let back = appLoaded("the app's page after Close preview with the clearing's question up");
    await pressMenu({ isLeaving: platform === 'windows' });
    await confirmation(SNAPSHOT);
    if (platform === 'macos') await indicators.press('project', 'Close preview');
    else if (platform === 'windows') await questions.pressMenu('Close preview');
    else endpoint.step('project', { do: 'close' }).catch(() => {});
    const closed = await back;
    expect(await isNone('app') && closed.cleared.length === 0 && consents.read()?.[snapshot.origin]?.camera === true && await isListed(snapshot.origin),
        `Close preview with the clearing's question up left ${JSON.stringify(closed)}`);
    report.closedWithQuestion = 'closed, nothing cleared';

    // A sign-out as its question is up, where the page takes a step meanwhile: closed, nothing cleared, the project listed
    // signed out as well.
    if (platform !== 'windows') {
        await openSession(snapshot.session, snapshot.origin);
        back = appLoaded("the app's page after a sign-out with the clearing's question up");
        await pressMenu();
        await confirmation(SNAPSHOT);
        endpoint.step('project', { do: 'signOut' }).catch(() => {});
        const signedOut = await back;
        expect(await isNone('app') && signedOut.cleared.length === 0 && await isListed(snapshot.origin), `a sign-out with the clearing's question up left ${JSON.stringify(signedOut)}`);
        report.signOutWithQuestion = 'closed, nothing cleared, listed signed out';
        await run.signIn();
    }

    // macOS reaches its menu with the consent's question up: Clear's question waits behind it until it is answered, and
    // its Cancel keeps that answer.
    if (platform === 'macos') {
        await openSession(snapshot.session, snapshot.origin);
        const tag = await start('microphone', 'hook');
        const asked = messageOf(SNAPSHOT, ['microphone']);
        await upFor((shown) => shown?.texts.includes(asked), 'no question of the microphone came');
        await pressMenu();
        await sleep(SETTLED_MS);
        expect((await questions.read('project'))?.texts.includes(asked), `${CLEAR} with the consent's question up took its place`);
        await questions.press('project', "Don't Allow", asked);
        expect(await outcome(tag) === 'denied', "the microphone was allowed at its question's Don't Allow");
        await confirmation(SNAPSHOT);
        await questions.press('project', 'Cancel', questionOf(SNAPSHOT));
        expect(await isNone() && consents.read()?.[snapshot.origin]?.microphone === false, `Clear's Cancel after the consent's answer kept ${JSON.stringify(consents.read())}`);
        report.withConsentQuestion = "waits behind the consent's question, its Cancel keeping that answer";
        await closePreview();
    }

    // iOS: Clear's question is the pill's window's, above the page's own alert.
    if (platform === 'ios') {
        await openSession(snapshot.session, snapshot.origin);
        const noted = endpoint.waitForNote((note) => note.event === 'later' && note.tag === 'clear-over-alert', LOAD_MS, "the note of Clear's question over the alert");
        await step('project', { do: 'noteLater', ms: 2500, tag: 'clear-over-alert' });
        await step('project', {
            do: 'held',
            dialog: 'alert',
            text: "crossbind e2e: a project's own dialog, up under Clear's question",
            presses: [{ item: CLEAR, ms: 1000 }, { button: 'Cancel', words: questionOf(SNAPSHOT), ms: 3500 }, { button: 'OK', words: SNAPSHOT, ms: 4500 }],
            resume: true,
        });
        const { alerts } = await noted;
        expect(alerts.some((alert) => alert.window === 'pill' && alert.title === questionOf(SNAPSHOT)) && alerts.some((alert) => alert.window === 'app'),
            `with the page's alert up Clear's question was in ${JSON.stringify(alerts)}`);
        report.overAlert = "the pill's window, above the page's alert";
        await sleep(SETTLED_MS * 3);
        await closePreview();
    }

    // Clear from the menu: the preview ends with it, preview.ended and preview.cleared held, the indicator down, nothing
    // asked of the snapshot's host meanwhile; the snapshot's stores, answers, note and version noted gone, its worker and
    // its cache where one registered, and a kind allowed before asked again; the kept project's stores still there.
    await openSession(snapshot.session, snapshot.origin);
    back = appLoaded("the app's page after the clearing from the menu");
    await pressMenu({ isLeaving: true });
    await confirmation(SNAPSHOT);
    const calls = snapshotCalls(snapshot.session);
    const started = Date.now();
    await pressClear(SNAPSHOT);
    const fromMenu = await back;
    report.fromMenuMs = Date.now() - started;
    const cleared = fromMenu.cleared[0];
    expect(JSON.stringify(fromMenu.ended) === '[{}]' && fromMenu.cleared.length === 1 && cleared.id === snapshot.origin && cleared.name === SNAPSHOT
        && cleared.account === accountName && cleared.message === undefined && snapshotCalls(snapshot.session) === calls,
    `the app's page after the clearing from the menu found ${JSON.stringify({ ended: fromMenu.ended, cleared: fromMenu.cleared, calls: snapshotCalls(snapshot.session) - calls })}`);
    await sleep(SETTLED_MS);
    expect(!(await indicators.read('app')).up, 'the indicator stayed up after the clearing from the menu');
    expect(consents.read()?.[snapshot.origin] === undefined && versions.read()?.[snapshot.session.id] === undefined && !(await isListed(snapshot.origin)),
        `the clearing from the menu left ${JSON.stringify({ consents: consents.read(), versions: versions.read() })}`);
    const sheet = await step('app', { do: 'check', session: snapshot.session.id });
    expect(sheet.opened === null, `the cleared snapshot's Open sheet read ${JSON.stringify(sheet)}`);
    await openSession(snapshot.session, snapshot.origin);
    const after = await stores(['cleared']);
    expect(STORES.every((store) => after.seen.cleared[store] !== true) && (after.workers === 'absent' || after.workers === 0), `the clearing from the menu left ${JSON.stringify(after)}`);
    await answerCamera(SNAPSHOT, "Don't Allow");
    await closePreview();
    await openSession(kept.session, kept.origin);
    const keptAfter = await stores(['kept']);
    expect(filledOf(report.filledKept).every((store) => keptAfter.seen.kept[store] === true), `the kept project's stores after another's clearing: ${JSON.stringify(keptAfter)}`);
    report.fromMenu = { stores: after.seen.cleared, workers: after.workers, kept: keptAfter.seen.kept };
    await closePreview();

    // What Settings calls: the projects the note holds, in the order of their names, each with its answers; an Allow taken
    // back, and nothing taken or given of a kind not asked, one kept off or a project not listed.
    const listed = await projectsListed();
    const names = listed.map((each) => `${each.name}\u0000${each.account}`);
    expect(JSON.stringify(names) === JSON.stringify([...names].sort()) && listed.some((each) => each.id === kept.origin && each.name === KEPT
        && each.account === accountName && each.consents.camera === true), `preview.projects() gave ${JSON.stringify(listed)}`);
    const refusal = async (what) => (await endpoint.step('app', what)).error;
    const unchanged = JSON.stringify(consents.read());
    for (const [project, kind] of [['0'.repeat(32), 'camera'], ['../consents', 'camera'], [kept.origin, 'clipboard']]) {
        expect(await refusal({ do: 'takeBack', project, kind }) === UNLISTED_TAKE_BACK, `a takeBack of ${project}'s ${kind} was not refused in its words`);
    }
    await step('app', { do: 'takeBack', project: kept.origin, kind: 'microphone' });
    await step('app', { do: 'takeBack', project: idle.origin, kind: 'camera' });
    expect(JSON.stringify(consents.read()) === unchanged, `a takeBack of a kind not asked made an entry: ${JSON.stringify(consents.read())}`);
    await step('app', { do: 'takeBack', project: kept.origin, kind: 'camera' });
    expect(consents.read()?.[kept.origin]?.camera === false && (await projectsListed()).find((each) => each.id === kept.origin)?.consents.camera === false,
        `the camera taken back kept ${JSON.stringify(consents.read())}`);
    await step('app', { do: 'takeBack', project: kept.origin, kind: 'camera' });
    expect(consents.read()?.[kept.origin]?.camera === false, 'a takeBack of a kind kept off changed it');
    report.takeBack = 'an Allow taken back; nothing listed, not asked or kept off changed nothing';

    // Clear from the app's page, for a project not open: its stores and note gone, preview.cleared held alone, the window
    // back at the app's page, its source asked nothing meanwhile; and preview.clearData of nothing listed refused.
    const clearRefusal = async (project) => {
        const noted = endpoint.waitForNote((note) => note.event === 'clearData', LOAD_MS, 'the refusal of a clearing');
        await step('app', { do: 'clearData', project });
        return (await noted).error;
    };
    expect(await clearRefusal('0'.repeat(32)) === UNLISTED_CLEAR && await clearRefusal('app') === UNLISTED_CLEAR, 'a clearing of nothing listed was not refused in its words');
    const askedBefore = idle.asked.length;
    back = appLoaded("the app's page after the clearing from the app's page");
    await step('app', { do: 'clearData', project: idle.origin });
    const fromPage = await back;
    expect(fromPage.ended.length === 0 && fromPage.cleared.length === 1 && fromPage.cleared[0].id === idle.origin && fromPage.cleared[0].message === undefined
        && idle.asked.length === askedBefore && !(await isListed(idle.origin)),
    `the clearing from the app's page left ${JSON.stringify({ ended: fromPage.ended, cleared: fromPage.cleared, asked: idle.asked.slice(askedBefore) })}`);
    await openSession(idle.session, idle.origin);
    const idleAfter = await stores(['idle']);
    expect(STORES.every((store) => idleAfter.seen.idle[store] !== true), `the clearing from the app's page left ${JSON.stringify(idleAfter)}`);
    report.fromPage = idleAfter.seen.idle;
    await closePreview();

    if (isDesktop) report.held = await checkHeld();
    return report;

    // A desktop: a second window shows the project too, its worker holding a database open. Where the web view's clearing
    // waits for it, the clearing ends by its time, the app's page told what may stay, the answers gone and the project
    // still listed, and meanwhile the second window gets no page of the clearing's without its token, its requests to
    // the clearing's end, with no token and another's, change nothing, and a preview's open is refused. Windows' own
    // removal closes what holds the database.
    async function checkHeld() {
        const held = await stepsProject(HELD, CLEARING_FILES);
        await openSession(held.session, held.origin);
        await step('project', { do: 'fill', mark: 'held' });
        await answerCamera(HELD, 'Allow');
        await closePreview();
        const opened = appLoaded("the second window's app page", 'app2');
        await step('app', { do: 'openWindow' });
        await opened;
        await openSession(held.session, held.origin);
        const shown = endpoint.waitForNote((note) => note.role === 'project2' && note.loaded, LOAD_MS, "the second window's project page");
        await step('app2', { do: 'go', url: held.url });
        await shown;
        expect(await step('project2', { do: 'holdDatabase' }) === 'held', "the second window's worker held no database");
        const secondBack = appLoaded("the second window's app page after the clearing", 'app2');
        back = appLoaded("the app's page after the held clearing");
        await pressMenu({ isLeaving: true });
        await confirmation(HELD);
        const started = Date.now();
        await pressClear(HELD);
        const out = {};
        if (platform !== 'windows') {
            await sleep(SETTLED_MS);
            const asked = async (what, path) => {
                out[what] = (await step('project2', { do: 'fetched', path })).status;
                expect(out[what] === 404, `as the clearing waited its end, ${path} answered ${out[what]}`);
            };
            await asked('page', `${PREFIX}clear`);
            await asked('otherPage', `${PREFIX}clear?token=${'A'.repeat(43)}`);
            await asked('noToken', `${PREFIX}cleared?left=`);
            await asked('otherToken', `${PREFIX}cleared?token=${'A'.repeat(43)}&left=`);
            out.open = await step('project2', { do: 'tryOpen', session: held.session.id });
            expect(out.open.refused === CLEARING_NOW, `an open as the clearing ran answered ${JSON.stringify(out.open)}`);
        }
        // Each window comes back to the app's page, and what was held goes to the one in front that asks for it first.
        const told = [...(await back).cleared, ...(await secondBack).cleared];
        out.ms = Date.now() - started;
        if (platform === 'windows') {
            expect(told.length === 1 && told[0].id === held.origin && told[0].message === undefined && !(await isListed(held.origin)),
                `the clearing beside a held database left ${JSON.stringify(told)}`);
            out.outcome = "cleared: WebView2's own removal closes what holds the database";
        } else {
            expect(told.length === 1 && told[0].id === held.origin && told[0].message === UNFINISHED(HELD) && out.ms >= CLEARING_MS
                && consents.read()?.[held.origin] === undefined && await isListed(held.origin),
            `the held clearing ended with ${JSON.stringify({ told, ms: out.ms, consents: consents.read() })}`);
            out.outcome = 'ended by its time: told what may stay, the answers gone, still listed';
        }
        await step('app2', { do: 'closeWindow' });
        await sleep(SETTLED_MS);
        return out;
    }
}
