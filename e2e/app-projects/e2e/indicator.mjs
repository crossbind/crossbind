import { spawnSync } from 'node:child_process';
import {
    mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { questionsOn, storeOn } from './questions.mjs';

// What shows that a preview is one, and what leaves it, as e2e/run.mjs checks it on each platform: the indicator read as
// its user sees it, through the fixture's hooks or, on Android, uiautomator's dump of the screen, and pressed as its user
// would; the hooks' note of it as each page starts, which gives its order; its words, a project's listed name with each
// mark a name may have among them, and its menu's; Reload and Close preview, with the page's own dialogs up and the
// consent's question; a snapshot's session read again; a desktop's full screen; a phone's pill over a page painted
// whole, and Back on Android; a page that goes back past its first entry; and several ends at once.
const LOAD_MS = 180000;
const POLL_MS = 300;
const SHOWN_MS = 15000;
const PRESS_MS = 300;
const HELD_MS = 4000;
const SETTLED_MS = 3000;
const TOOL_MS = 30000;
const DUMP_TRIES = 5;
const TOUCH_TRIES = 3;
const DASH = '–';
const DOT = '·';
const PAINT = [255, 0, 255];
// A listed name with each mark the cloud lets one hold: a space, a dot, an underscore, an at, a slash and a dash.
export const MARKED_NAME = 'e2e name.with_marks@a/b-c';
const SNAPSHOT_NAME = 'e2e snapshot project';
const PILL_WORDS = ` ${DASH} crossbind preview`;
const RENEWED = "The snapshot's key was renewed; it opened again.";
const GONE = "This snapshot is no longer on your account's list.";
const DIALOG = "crossbind e2e: a project's own dialog, up at the preview's menu";
const SECOND_NAME = 'e2e second project';
const ENDED_AS_OPENED = 'crossbind: the preview ended as it opened.';

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

const decoded = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, name) => {
    const named = {
        amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
    }[name.toLowerCase()];
    if (named) return named;
    return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
});

function screenOf(adb) {
    for (let tries = 0; tries < DUMP_TRIES; tries += 1) {
        const { stdout = '' } = spawnSync(adb, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8', timeout: TOOL_MS });
        const end = stdout.lastIndexOf('</hierarchy>');
        if (end < 0) continue;
        return [...stdout.slice(stdout.indexOf('<hierarchy'), end).matchAll(/<node\b([^>]*?)\/?>/g)].map(([, attributes]) => Object.fromEntries(
            [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decoded(value)]),
        ));
    }
    throw new Error('uiautomator dumped no screen');
}

const boundsOf = (node) => node.bounds.match(/\d+/g).map(Number);
const centerOf = (node) => {
    const [left, top, right, bottom] = boundsOf(node);
    return [String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))];
};

// A screenshot's pixels, the screenshot kept as a PNG at file: an iOS Simulator's read as a bitmap, an Android device's
// raw from screencap.
function pixelsOf(platform, adb, file) {
    if (platform === 'android') {
        // A raw screen whole, its header the 12 or 16 bytes before its pixels; one adb cut short is taken again.
        for (let tries = 0; tries < DUMP_TRIES; tries += 1) {
            const raw = spawnSync(adb, ['exec-out', 'screencap'], { timeout: TOOL_MS, maxBuffer: 256 * 1024 * 1024 }).stdout;
            const width = raw?.length >= 16 ? raw.readUInt32LE(0) : 0;
            const height = raw?.length >= 16 ? raw.readUInt32LE(4) : 0;
            const header = (raw?.length ?? 0) - width * height * 4;
            if (width === 0 || header < 12 || header > 16) continue;
            writeFileSync(file, spawnSync(adb, ['exec-out', 'screencap', '-p'], { timeout: TOOL_MS, maxBuffer: 256 * 1024 * 1024 }).stdout);
            return { width, height, at: (x, y) => [...raw.subarray(header + (y * width + x) * 4, header + (y * width + x) * 4 + 3)] };
        }
        throw new Error('screencap gave no whole screen');
    }
    const shot = join(tmpdir(), `crossbind-e2e-pill-${process.pid}.bmp`);
    spawnSync('xcrun', ['simctl', 'io', 'booted', 'screenshot', '--type=bmp', shot], { timeout: TOOL_MS });
    const bitmap = readFileSync(shot);
    spawnSync('sips', ['-s', 'format', 'png', shot, '--out', file], { timeout: TOOL_MS });
    rmSync(shot, { force: true });
    const offset = bitmap.readUInt32LE(10);
    const width = bitmap.readInt32LE(18);
    const height = bitmap.readInt32LE(22);
    const bytes = bitmap.readUInt16LE(28) / 8;
    const row = Math.ceil((width * bytes) / 4) * 4;
    return {
        width,
        height: Math.abs(height),
        at: (x, y) => {
            const line = height > 0 ? height - 1 - y : y;
            const at = offset + line * row + x * bytes;
            return [bitmap[at + 2], bitmap[at + 1], bitmap[at]];
        },
    };
}

const isPaint = ([red, green, blue]) => Math.abs(red - PAINT[0]) < 24 && Math.abs(green - PAINT[1]) < 24 && Math.abs(blue - PAINT[2]) < 24;

// The indicator's reader and presser on a platform: read() gives { up, ... } as its user sees it; press() presses an
// item of its menu after a moment, so that a page the press ends or reloads has reported the step first; menu() its
// items' words without pressing one.
export function indicatorsOn({
    platform, endpoint, adb, applicationId,
}) {
    async function byPage(role, what) {
        const answered = await endpoint.step(role, what);
        if (answered.error !== undefined) throw new Error(`the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    }
    const adbShell = (...args) => spawnSync(adb(), ['shell', ...args], { encoding: 'utf8', timeout: TOOL_MS });
    // Android's pill, by the words its view is named with, and the menu it opens: the dialog's texts and its items.
    function androidIndicator() {
        const own = screenOf(adb()).filter((node) => node.package === applicationId());
        const pill = own.find((node) => node['content-desc']?.endsWith(PILL_WORDS));
        const list = own.filter((node) => node['resource-id'] === 'android:id/text1');
        const texts = own.filter((node) => node.class === 'android.widget.TextView' && node.text && node['resource-id'] !== 'android:id/text1').map((node) => node.text);
        return {
            up: Boolean(pill), label: pill?.['content-desc'] ?? null, pill, menu: list.length > 0 ? { texts, items: list.map((node) => node.text), nodes: list } : null,
        };
    }
    return {
        async read(role) {
            if (platform === 'android') return androidIndicator();
            return byPage(role, { do: 'indicator' });
        },
        async press(role, item, ms = PRESS_MS, isStopped = false) {
            if (platform !== 'android') {
                await byPage(role, { do: 'pressIndicator', item, ms });
                await sleep(ms);
                return;
            }
            // The page takes no next step first, as the press will reload or end it.
            if (!isStopped) await byPage(role, { do: 'stop' });
            const shown = androidIndicator();
            expect(shown.pill, `no pill is up to press ${item}: ${JSON.stringify(shown)}`);
            adbShell('input', 'tap', ...centerOf(shown.pill));
            const deadline = Date.now() + SHOWN_MS;
            for (;;) {
                const node = androidIndicator().menu?.nodes.find((each) => each.text === item);
                if (node) {
                    adbShell('input', 'tap', ...centerOf(node));
                    return;
                }
                expect(Date.now() < deadline, `the pill opened no menu with ${item}`);
                await sleep(POLL_MS);
            }
        },
        async menu(role) {
            if (platform === 'android') {
                adbShell('input', 'tap', ...centerOf(androidIndicator().pill));
                await sleep(SHOWN_MS / 10);
                const { menu } = androidIndicator();
                adbShell('input', 'keyevent', 'KEYCODE_BACK');
                await sleep(POLL_MS * 2);
                return menu;
            }
            if (platform === 'ios') {
                await byPage(role, { do: 'pressIndicator', item: 'menu' });
                await sleep(SHOWN_MS / 15);
                const { menu } = await byPage(role, { do: 'indicator' });
                await byPage(role, { do: 'pressIndicator', item: 'Cancel' }).catch(() => {});
                await sleep(POLL_MS * 2);
                return menu;
            }
            return (await byPage(role, { do: 'indicator' })).items;
        },
        // Several presses at once, armed natively where a page arms them, as the first may end the page; on Android one
        // after the other, as its user taps them. A session the app's own code opens after them, where given.
        async presses(role, presses, extra = {}) {
            if (platform === 'android') {
                await byPage(role, extra.open ? { do: 'presses', presses: [], ...extra } : { do: 'stop' });
                for (const { item } of presses) await this.press(role, item, 0, true).catch(() => {});
                return;
            }
            await byPage(role, { do: 'presses', presses, ...extra });
            await sleep(Math.max(...presses.map(({ ms }) => ms)));
        },
        // Back as its user presses it, as many times at once as given; a page it will move takes no next step first.
        async back(role, times = 1) {
            if (role) await byPage(role, { do: 'stop' });
            adbShell('input', 'keyevent', ...Array(times).fill('KEYCODE_BACK'));
        },
        tap: (x, y) => adbShell('input', 'tap', String(x), String(y)),
    };
}

// The project's name over the menu's line, and the items, as each platform draws them: two lines of one item on macOS
// and Linux, two items on Windows, a sheet's title and message on iOS, a dialog's title and line on Android.
function menuWords(platform, menu) {
    if (platform === 'ios') return { name: menu?.title, line: menu?.message, items: menu?.items.filter((item) => item !== 'Cancel') };
    if (platform === 'android') return { name: menu?.texts[0], line: menu?.texts[1], items: menu?.items };
    const items = (menu ?? []).filter((item) => !item.separator);
    if (platform === 'windows') {
        const [reload, name, line, close] = items;
        return { name: name?.words, line: line?.words, items: [reload?.words, close?.words] };
    }
    const [reload, both, close] = items;
    const [name, line] = (both?.words ?? '').split('\n');
    return { name, line, items: [reload?.words, close?.words] };
}

export async function checkIndicator(run) {
    const {
        platform, endpoint, app, openSession, stepsProject, stepsSnapshot, second, cloud, appTitle, accountName, signedOutWords,
    } = run;
    const isDesktop = ['macos', 'windows', 'linux'].includes(platform);
    const isApple = platform === 'macos' || platform === 'ios';
    const indicators = indicatorsOn(run);
    const questions = questionsOn(run);
    const report = {};
    const titleOf = (name) => `${name}${PILL_WORDS}`;
    const step = async (role, what) => {
        const answered = await endpoint.step(role, what);
        expect(answered.error === undefined, `the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    };
    const pagesSince = (from) => endpoint.notes.slice(from).filter((note) => note.event === 'page');
    const isUp = (shown, name) => shown.up && (isDesktop ? shown.title === titleOf(name) : shown.label === titleOf(name));
    const isDown = (shown) => !shown.up && (!isDesktop || shown.title === appTitle);
    async function until(read, test, what, ms = SHOWN_MS) {
        const deadline = Date.now() + ms;
        for (;;) {
            const shown = await read();
            if (test(shown)) return shown;
            expect(Date.now() < deadline, `${what}: ${JSON.stringify(shown)}`);
            await sleep(POLL_MS);
        }
    }
    const appLoaded = (what) => endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, what);
    const projectLoaded = (what) => endpoint.waitForNote((note) => note.role === 'project' && note.loaded, LOAD_MS, what);
    const down = (what) => until(() => indicators.read('app'), isDown, what);
    // An end that brings the app's page back: the indicator up as that page starts and down after it, and what the page
    // found held of preview.ended.
    async function ended(what, end) {
        const from = endpoint.notes.length;
        const back = appLoaded(`the app's page after ${what}`);
        await end();
        const home = await back;
        const page = pagesSince(from).find((note) => note.role === 'app');
        expect(page?.indicator?.up === true, `the indicator was down as the app's page started after ${what}: ${JSON.stringify(pagesSince(from))}`);
        await down(`the indicator after ${what}`);
        return home.ended;
    }
    const readingsOf = (session) => cloud.calls.filter((call) => call.host === 'api' && call.call === `GET /v1/sessions/${session.id}`).length;
    const served = async (origin) => step('app', { do: 'served', origin }).catch(() => null);

    // None before a preview.
    expect(isDown(await indicators.read('app')), 'the indicator was up before a preview');

    // 1: a project whose listed name has each mark: its indicator up as its first page starts, its words and its menu's.
    const marked = await stepsProject(MARKED_NAME);
    let from = endpoint.notes.length;
    await openSession(marked.session, marked.origin);
    const shown = await indicators.read('project');
    expect(isUp(shown, MARKED_NAME), `the indicator of "${MARKED_NAME}" read ${JSON.stringify(shown)}`);
    const firstPage = pagesSince(from).find((note) => note.role === 'project');
    expect(firstPage?.indicator?.up === true, `the indicator was not up as the project's first page started: ${JSON.stringify(pagesSince(from))}`);
    const devLine = `${accountName} ${DOT} on ${marked.session.addresses[0]}`;
    const words = menuWords(platform, await indicators.menu('project'));
    expect(words.name === MARKED_NAME && words.line === devLine && JSON.stringify(words.items) === JSON.stringify(['Reload', 'Close preview']),
        `the preview's menu read ${JSON.stringify(words)}, not "${MARKED_NAME}" over "${devLine}" between Reload and Close preview`);
    report.menu = words;
    if (isDesktop) {
        await step('project', { do: 'title', text: 'crossbind e2e: a title of the page' });
        await sleep(POLL_MS * 2);
        expect((await indicators.read('project')).title === titleOf(MARKED_NAME), "the page's document.title changed the window's title");
    }

    // Reload: the project's page starts anew at the same origin, the indicator up.
    from = endpoint.notes.length;
    const reloaded = projectLoaded("the project's page after Reload");
    await indicators.press('project', 'Reload');
    expect((await reloaded).loaded === marked.url.replace(/\/$/, ''), 'Reload loaded another page');
    const reloadPages = pagesSince(from);
    expect(reloadPages.length === 1 && reloadPages[0].role === 'project' && reloadPages[0].indicator?.up === true, `Reload started ${JSON.stringify(reloadPages)}`);

    // Close preview: the event held with no words, the origin refusing a request after it.
    const closedEnd = await ended('Close preview', () => indicators.press('project', 'Close preview'));
    expect(closedEnd.length === 1 && Object.keys(closedEnd[0]).length === 0, `the app's page found preview.ended held as ${JSON.stringify(closedEnd)}, not once with no words`);
    const refused = await step('app', { do: 'fetched', url: marked.url });
    expect(refused !== '200', `a request of the origin after Close preview answered ${refused}`);
    report.order = { first: firstPage.indicator.up, reload: reloadPages[0].indicator.up, close: true };

    // The app's own code's preview.close: down after the app's page, nothing held.
    await openSession(marked.session, marked.origin);
    const closedByApp = await ended("the app's own preview.close", () => step('project', { do: 'close' }).catch(() => {}));
    expect(closedByApp.length === 0, `preview.close held ${JSON.stringify(closedByApp)}`);

    // The event the menu's end holds reaches the app's page alone: the project's page, which listened, heard nothing.
    await openSession(marked.session, marked.origin);
    await step('project', { do: 'listenEnded' });
    await ended('Close preview with a listener', () => indicators.press('project', 'Close preview'));
    await openSession(marked.session, marked.origin);
    expect(await step('project', { do: 'listenEnded' }) === null, "the project's page heard preview.ended");
    await ended('Close preview after the listener', () => indicators.press('project', 'Close preview'));

    report.dialogs = await checkDialogs();
    if (isDesktop) report.fullScreen = await checkFullScreen();
    if (!isDesktop) report.phone = await checkPhone();
    report.pastFirst = await checkPastFirst();
    report.readings = await checkReadings();
    report.together = await checkTogether();
    return report;

    // Rule 8 and 7.4's table: what the page's own dialogs do with the menu's Reload and Close preview where the menu is
    // reached with one up (macOS's menu bar, iOS's pill above the page's alerts), and what holds the menu elsewhere.
    async function checkDialogs() {
        const out = {};
        if (isApple) {
            // Reload with the page's alert() up waits: no page starts until the alert is answered, one starts once it is.
            await openSession(marked.session, marked.origin);
            from = endpoint.notes.length;
            const after = projectLoaded("the project's page after Reload with its alert up");
            await step('project', {
                do: 'held', dialog: 'alert', text: DIALOG, presses: [{ item: 'Reload', ms: 1500 }, { button: 'OK', words: MARKED_NAME, ms: 1500 + HELD_MS }],
            });
            await after;
            const notes = endpoint.notes.slice(from);
            const answeredAt = notes.findIndex((note) => note.event === 'answered');
            const startedAt = notes.findIndex((note) => note.event === 'page' && note.role === 'project');
            expect(answeredAt >= 0 && startedAt > answeredAt, `Reload with the page's alert up started a page before its answer: ${JSON.stringify(notes.map((note) => note.event ?? note.loaded))}`);
            out.alertAtReload = 'waited for its answer';
            // dialog.message up: Reload reloads at once, the dialog going with its page.
            const afterMessage = projectLoaded("the project's page after Reload with its message dialog up");
            await step('project', { do: 'held', dialog: 'message', text: DIALOG, presses: [{ item: 'Reload', ms: 1500 }] });
            await afterMessage;
            await sleep(SETTLED_MS / 3);
            expect(await questions.read('project') === null, 'a message dialog stayed up over the page Reload brought');
            out.messageAtReload = 'closed with its page';
            // Close preview with dialog.message up, reached in the menu bar or above the page's alert: the dialog goes.
            await ended('Close preview with a message dialog up', () => step('project', { do: 'held', dialog: 'message', text: DIALOG, presses: [{ item: 'Close preview', ms: 1500 }] }));
            expect(await questions.read('app') === null, 'the message dialog stayed up after Close preview');
            out.messageAtClose = 'closed with the preview';
        }
        if (platform === 'ios') {
            // Close preview from the pill above the page's own alert: the preview ends, the alert going with it.
            await openSession(marked.session, marked.origin);
            await ended('Close preview with the page\'s alert up', () => step('project', { do: 'held', dialog: 'alert', text: DIALOG, presses: [{ item: 'Close preview', ms: 1500 }] }));
            expect(await questions.read('app') === null, "the page's alert stayed up after Close preview");
            out.alertAtClose = 'closed with the preview';
            // A message dialog whose call is cancelled leaves the pill's menu up.
            await openSession(marked.session, marked.origin);
            await step('project', { do: 'dialogUp', text: DIALOG });
            await step('project', { do: 'pressIndicator', item: 'menu' });
            await sleep(SETTLED_MS / 3);
            await step('project', { do: 'cancelDialog' });
            await sleep(SETTLED_MS / 3);
            const menu = (await indicators.read('project')).menu;
            expect(menu?.title === MARKED_NAME, `the pill's menu went with a cancelled message dialog: ${JSON.stringify(menu)}`);
            await step('project', { do: 'pressIndicator', item: 'Cancel' });
            out.menuOverCancelledDialog = 'stays';
            await ended('Close preview after the cancelled dialog', () => indicators.press('project', 'Close preview'));
        }
        if (platform === 'android') {
            // The page's alert covers the pill, and Back closes the alert, the preview staying.
            await openSession(marked.session, marked.origin);
            const answered = endpoint.waitForNote((note) => note.event === 'answered', LOAD_MS, "the page's alert's answer");
            await step('project', {
                do: 'held', dialog: 'alert', text: DIALOG, presses: [], resume: true,
            });
            await sleep(SETTLED_MS);
            out.pillUnderAlert = (await indicators.read('project').catch(() => ({ up: 'not read' }))).up;
            await indicators.back();
            await answered;
            await sleep(SETTLED_MS / 3);
            expect((await indicators.read('project')).up === true, 'Back closed the preview with the page\'s alert up, not the alert');
            out.backAtAlert = 'closed the alert';
            await ended('Close preview after the alert', () => indicators.press('project', 'Close preview'));
        }
        if (platform === 'linux') {
            // The menu waits with its window: a message dialog of the window takes its input while it is up.
            await openSession(marked.session, marked.origin);
            await step('project', { do: 'dialogUp', text: DIALOG });
            out.inputWithDialog = (await indicators.read('project')).takesInput;
            expect(out.inputWithDialog === false, `the window took its user's input with a message dialog up: ${out.inputWithDialog}`);
            await ended('Close preview with a message dialog up', () => indicators.press('project', 'Close preview'));
        }
        if (platform === 'windows') {
            // The same, read from outside, as the dialog holds the page's answers; the end sent as the item's own command.
            await openSession(marked.session, marked.origin);
            endpoint.step('project', { do: 'dialogUp', text: DIALOG }).catch(() => {});
            await until(() => questions.windowTakesInput(), (takes) => takes === false, 'the window took its user\'s input with a message dialog up');
            out.inputWithDialog = false;
            await ended('Close preview with a message dialog up', () => questions.pressMenu('Close preview'));
        }
        out.consent = await checkConsentWithIndicator();
        out.picker = await knownPicker();
        return out;
    }

    // The consent's question with the indicator: on macOS Close preview closes it and nothing is kept, and Reload leaves
    // it up, answered once and kept; on iOS it is the pill's window's, above the page's own alert.
    async function checkConsentWithIndicator() {
        if (platform !== 'macos' && platform !== 'ios') return 'not this platform';
        const { data } = await step('app', { do: 'paths' });
        const store = storeOn({ ...run, data });
        store.remove();
        const out = {};
        const ask = (tag) => step('project', { do: 'request', requests: [{ tag, kinds: ['camera'], via: 'hook' }] });
        const question = () => until(() => questions.read('project'), (up) => up !== null, 'no question came');
        await openSession(marked.session, marked.origin);
        await ask(9001);
        const up = await question();
        if (platform === 'ios') {
            expect(up.window === 'pill', `the question came in the ${up.window}'s window, not the pill's`);
            out.questionWindow = up.window;
        }
        if (platform === 'macos') {
            await ended('Close preview with the question up', () => indicators.press('project', 'Close preview'));
            expect(await questions.read('app') === null && store.read() === null, `Close preview left the question or kept ${JSON.stringify(store.read())}`);
            out.closeWithQuestion = 'closed, nothing kept';
            await openSession(marked.session, marked.origin);
            await ask(9002);
            await question();
            const reloaded = projectLoaded("the project's page after Reload with the question up");
            await indicators.press('project', 'Reload');
            await reloaded;
        } else {
            // On iOS the question is above the pill, in its window: no menu opens until it is answered.
            await sleep(SETTLED_MS / 3);
            const tried = await endpoint.step('project', { do: 'pressIndicator', item: 'menu' });
            await sleep(SETTLED_MS / 3);
            const menu = (await indicators.read('project')).menu;
            expect(!menu, `the pill opened its menu with the question up: ${JSON.stringify({ tried, menu })}`);
            out.menuWithQuestion = tried.error ?? 'none until it is answered';
        }
        const still = await questions.read('project');
        expect(still !== null, 'Reload closed the question');
        await questions.press('project', "Don't Allow", still.texts[0]);
        await sleep(SETTLED_MS / 3);
        expect(await questions.read('project') === null, 'the question was asked again after its answer');
        expect(store.read()?.[marked.origin]?.camera === false, `the answer was not kept: ${JSON.stringify(store.read())}`);
        if (platform === 'macos') out.reloadWithQuestion = 'still up, answered once, kept';
        if (platform === 'ios') {
            // Above the page's own alert: the question asked, then the page's alert, both read while both are up.
            store.remove();
            await ended('Close preview before the question over an alert', () => indicators.press('project', 'Close preview'));
            await openSession(marked.session, marked.origin);
            await ask(9003);
            await question();
            const noted = endpoint.waitForNote((note) => note.event === 'later' && note.tag === 'over-alert', LOAD_MS, 'the note over the alert');
            await step('project', { do: 'noteLater', ms: 2000, tag: 'over-alert' });
            await step('project', {
                do: 'held',
                dialog: 'alert',
                text: DIALOG,
                presses: [{ button: "Don't Allow", words: `Allow “${MARKED_NAME}” to use the camera?`, ms: 3000 }, { button: 'OK', words: MARKED_NAME, ms: 4500 }],
                resume: true,
            });
            const { alerts } = await noted;
            expect(JSON.stringify(alerts) === JSON.stringify([{ window: 'pill', title: `Allow “${MARKED_NAME}” to use the camera?` }, { window: 'app', title: MARKED_NAME }]),
                `with the page's alert up the alerts were ${JSON.stringify(alerts)}`);
            out.questionOverAlert = 'the pill\'s window, above the page\'s alert';
            await sleep(SETTLED_MS * 2);
        }
        await ended('Close preview after the question', () => indicators.press('project', 'Close preview'));
        store.remove();
        return out;
    }

    // A file input's picker left up over the page that comes, a known issue of the host's on macOS and iOS, which a line
    // of the run's output shows while it holds (docs/known-issues.md).
    async function knownPicker() {
        if (!isApple) return 'not this platform';
        await openSession(marked.session, marked.origin);
        await step('project', { do: 'clickFile' });
        await sleep(SETTLED_MS);
        expect(await step('project', { do: 'pickerUp' }) !== null, "the file input's picker did not come up");
        await ended("Close preview with a file input's picker up", () => indicators.press('project', 'Close preview'));
        const left = await step('app', { do: 'pickerUp' });
        console.log(`PREVIEW KNOWN picker-after-end ${JSON.stringify(left === null ? 'closed' : 'stays')}`);
        if (left !== null) await step('app', { do: 'dismissPicker' });
        return left === null ? 'closed' : 'stays';
    }

    // Rule 4: while a preview shows, its window fills no screen: the page's requestFullscreen() and a video's own full
    // screen as its user's click asks them, refused, or on Windows the element filling the window under its title; the
    // app's own page's as before; and on macOS the window's own full screen while a preview shows and after it.
    async function checkFullScreen() {
        const out = {};
        // A click's request, as the page's own listener makes it, and whether the page's document has full screen at all.
        const click = async (role, way) => {
            const noted = endpoint.waitForNote((note) => note.event === 'fullScreen' && note.way === way && note.role === role, SHOWN_MS, `the ${role}'s ${way} full screen`);
            const { enabled } = await step(role, { do: 'fullScreen', way });
            await run.clickPage(role);
            const answer = await noted.catch((error) => ({ outcome: `no answer: ${error.message}` }));
            await step(role, { do: 'exitFullScreen' }).catch(() => {});
            await sleep(SETTLED_MS / 3);
            return { enabled, outcome: answer.outcome };
        };
        const isGranted = ({ outcome }) => outcome === 'full' || outcome === 'asked';
        await openSession(marked.session, marked.origin);
        const ways = platform === 'macos' ? ['page', 'video', 'element'] : ['page'];
        out.project = {};
        for (const way of ways) out.project[way] = await click('project', way);
        if (platform === 'windows') {
            // WebView2 leaves the window to the host, which does not follow a project's page: the element fills the window.
            const state = await indicators.read('project');
            expect(state.framed !== false && state.title === titleOf(MARKED_NAME), `a project's full screen took the window's title or frame: ${JSON.stringify(state)}`);
            out.projectWindow = { framed: state.framed, title: state.title };
        } else {
            expect(Object.values(out.project).every((asked) => !isGranted(asked) && asked.enabled !== true),
                `a project's page had full screen while its preview showed: ${JSON.stringify(out.project)}`);
        }
        if (platform === 'macos') {
            await step('project', { do: 'fillScreen' });
            await sleep(SETTLED_MS);
            const state = await indicators.read('project');
            expect(!state.fullScreen && !state.windowTakesFullScreen, `the window took its user's full screen while its preview showed: ${JSON.stringify(state)}`);
        }
        await ended('Close preview after full screen', () => indicators.press('project', 'Close preview'));
        // The app's own page as before: its document has full screen, and takes it where its window is in front.
        out.app = await click('app', 'page');
        expect(out.app.enabled === true, `the app's own page had no full screen after the preview: ${JSON.stringify(out.app)}`);
        if (!isGranted(out.app)) console.log(`note: the app's own page's full screen not taken here: ${out.app.outcome}`);
        if (platform === 'macos') {
            const state = await indicators.read('app');
            expect(state.windowTakesFullScreen && state.webTakesFullScreen, `the app's window did not take full screen again after the preview: ${JSON.stringify(state)}`);
            await step('app', { do: 'fillScreen' });
            await sleep(SETTLED_MS);
            out.appWindow = (await indicators.read('app')).fullScreen;
            if (out.appWindow) {
                await step('app', { do: 'fillScreen' });
                await sleep(SETTLED_MS);
            } else {
                console.log("note: the app's window did not fill the screen here, its app not in front");
            }
        }
        return out;
    }

    // On a phone the pill is above a page that paints its whole viewport, its own pixels at its place; where a run touches
    // the screen, a touch beside the pill reaches the page; and on Android, Back within the project's history, from a
    // page that would hold it, twice at the project's first entry, and on the app's own page.
    async function checkPhone() {
        const out = {};
        await openSession(marked.session, marked.origin);
        await step('project', { do: 'paint', color: `rgb(${PAINT.join(', ')})` });
        await sleep(SETTLED_MS / 2);
        const pill = platform === 'android' ? await step('project', { do: 'indicator' }) : await indicators.read('project');
        const [x, y, width, height] = pill.frame.map(Math.round);
        // Kept beside the app the run built, which CI keeps of the run.
        const folder = join(import.meta.dirname, '..', 'dist', 'indicator');
        mkdirSync(folder, { recursive: true });
        const shot = join(folder, `pill-${platform}.png`);
        const pixels = pixelsOf(platform, run.adb(), shot);
        const inside = pixels.at(x + Math.round(width / 2), y + Math.round(height / 2));
        const beside = pixels.at(Math.max(0, x - 40), y + Math.round(height / 2));
        expect(!isPaint(inside) && isPaint(beside), `the screenshot has ${inside} at the pill and ${beside} beside it, not the pill above the page's paint`);
        out.screenshot = { inside, beside };
        console.log(`PREVIEW SCREENSHOT ${platform} ${shot}`);
        if (platform === 'android') {
            // Back within the project's own history is the WebView's own, which skips each entry a page made without its
            // user's activation: a touch beside the pill gives each page its user's activation before it goes on, as its
            // user's tap would. A path no other entry has tells the entries apart, as each preview of the run is of the
            // same origin.
            const origin = marked.url.replace(/\/$/, '');
            // A page just come may not take a touch until it has drawn: one given its user's activation is touched again
            // until a touch reaches it, the first page once, as a touch beside the pill must reach it.
            const touchBeside = async (what, tries = TOUCH_TRIES) => {
                await step('project', { do: 'paint', color: `rgb(${PAINT.join(', ')})` });
                for (let tried = 1; ; tried += 1) {
                    if (tries > 1) await sleep(SETTLED_MS / 3);
                    const touched = endpoint.waitForNote((note) => note.event === 'touched', tries > 1 ? SETTLED_MS : SHOWN_MS, `a touch beside the pill ${what}`);
                    indicators.tap(Math.max(0, x - 60), y + Math.round(height / 2));
                    const note = await touched.catch((error) => {
                        if (tried >= tries) throw error;
                        return null;
                    });
                    if (note) return { ...note, tried };
                }
            };
            const goTo = async (path) => {
                const shownAt = projectLoaded(`the project's ${path}`);
                await step('project', { do: 'navigate', path });
                return shownAt;
            };
            const backTo = async (what) => {
                const before = endpoint.waitForNote((note) => note.role === 'project' && note.loaded, SHOWN_MS, what);
                await indicators.back('project');
                return before;
            };
            out.touchBeside = await touchBeside('on the first page', 1);
            await goTo('/first.html');
            const touches = [(await touchBeside('on /first.html')).tried];
            await goTo('/second.html');
            const back = await backTo("the project's page before, after Back");
            expect(back.loaded === origin && back.path === '/first.html', `Back within the project went to ${back.loaded}${back.path}, not to the page before`);
            expect((await indicators.read('project')).up, 'Back within the project brought the indicator down');
            expect((await backTo("the project's first page after Back")).path === '/', 'Back within the project did not reach its first page');
            // A page that pushes a state of its own as it loads and replaces history.back() does not hold Back.
            touches.push((await touchBeside('before the page that would hold Back')).tried);
            await goTo('/holds-back.html');
            const past = await backTo('the project\'s page before the one that would hold Back');
            expect(past.path === '/', `Back from the page that would hold it went to ${past.path}`);
            out.backPastHolder = 'not held';
            out.touchesTried = touches;
            // Back twice at its first entry: one end, one event, the app's page.
            from = endpoint.notes.length;
            const backEnd = await ended('Back twice at the first entry', () => indicators.back('project', 2));
            expect(backEnd.length === 1 && Object.keys(backEnd[0]).length === 0, `Back's end held ${JSON.stringify(backEnd)}`);
            await sleep(SETTLED_MS);
            const after = pagesSince(from);
            const appPages = endpoint.notes.slice(from).filter((note) => note.role === 'app' && note.loaded);
            expect(appPages.length === 1 && after.at(-1)?.role === 'app' && await served(marked.origin) === false,
                `Back twice at the first entry left ${JSON.stringify({ pages: after.map((note) => note.role), appPages: appPages.length })}`);
            out.backTwice = 'one end, one event, the app\'s page';
            // On the app's own page Back is the host's, as before: the WebView goes back in its history, and no preview
            // comes back.
            const moved = endpoint.waitForNote((note) => note.event === 'page', SHOWN_MS, "a page after Back on the app's own page");
            await indicators.back('app');
            await moved;
            await sleep(SETTLED_MS);
            expect(isDown(await indicators.read('app')), "Back on the app's own page brought a preview back");
            out.back = 'within, then closed at the first entry; the app\'s page as before';
        } else {
            await ended('Close preview after the paint', () => indicators.press('project', 'Close preview'));
        }
        return out;
    }

    // A project's page that goes back past its first entry: the app's page shows with the preview ended, or the host
    // refuses the move and the project's page stays with its preview, never the app's page beside a preview served.
    async function checkPastFirst() {
        await openSession(marked.session, marked.origin);
        from = endpoint.notes.length;
        await step('project', { do: 'navigate', n: -1 });
        await sleep(SETTLED_MS * 2);
        const appPage = endpoint.notes.slice(from).find((note) => note.role === 'app' && note.loaded);
        if (appPage) {
            await down('the indicator after the page went back past its first entry');
            expect(await served(marked.origin) === false, 'the app\'s page came back with the preview still served');
            return 'the app\'s page, the preview ended';
        }
        expect((await indicators.read('project')).up, 'the project\'s page stayed without its indicator');
        await ended('Close preview after the page stayed', () => indicators.press('project', 'Close preview'));
        return 'refused, the project\'s page stayed';
    }

    // Rule 9: a snapshot's session read again at Reload and at the app's return to the front, none while nothing asks.
    async function checkReadings() {
        const out = {};
        const snapshot = stepsSnapshot(SNAPSHOT_NAME);
        const another = stepsSnapshot(`${SNAPSHOT_NAME} two`);
        const lineOf = async () => menuWords(platform, await indicators.menu('project')).line;
        const versions = storeOn({ ...run, data: (await step('app', { do: 'paths' })).data }, 'versions.json');
        await openSession(snapshot.session, snapshot.origin);
        expect(await lineOf() === `${accountName} ${DOT} a snapshot, version 1`, 'the snapshot\'s line named no version 1');
        const opened = readingsOf(snapshot.session);
        await sleep(SETTLED_MS);
        expect(readingsOf(snapshot.session) === opened, 'the session was read again while nothing asked');
        if (await run.returnToFront()) {
            await sleep(SETTLED_MS);
            expect(readingsOf(snapshot.session) === opened + 1, `the return to the front read the session ${readingsOf(snapshot.session) - opened} times`);
            out.atFront = 'one reading';
        } else {
            out.atFront = 'no return to the front made here: the app was not in front, or no run makes one';
        }
        // A higher version, served at Reload, the line naming both; the version opened stays as it was.
        cloud.raise(snapshot.session.id);
        let reloaded = projectLoaded('the snapshot after Reload');
        await indicators.press('project', 'Reload');
        await reloaded;
        expect(await lineOf() === `${accountName} ${DOT} a snapshot, version 2, changed since you opened version 1`, 'the line named no higher version');
        expect(versions.read()?.[snapshot.session.id] === 1, `the version opened was noted as ${JSON.stringify(versions.read())} once version 2 was served`);
        // A key made anew, taken at Reload, with 3.4's words.
        cloud.rekey(snapshot.session.id);
        reloaded = projectLoaded('the snapshot after Reload with a new key');
        await indicators.press('project', 'Reload');
        await reloaded;
        expect(await lineOf() === RENEWED, 'the line did not say the key was renewed');
        // Reload while a reading waits: one reading, one reload.
        let release = cloud.hold(snapshot.session.id);
        const before = readingsOf(snapshot.session);
        from = endpoint.notes.length;
        await indicators.presses('project', [{ item: 'Reload', ms: PRESS_MS }, { item: 'Reload', ms: PRESS_MS * 2 }]);
        await sleep(SETTLED_MS / 3);
        release();
        await projectLoaded('the snapshot after two Reloads');
        await sleep(SETTLED_MS);
        expect(readingsOf(snapshot.session) - before === 1 && pagesSince(from).filter((note) => note.role === 'project').length === 1,
            `two Reloads while a reading waited read ${readingsOf(snapshot.session) - before} times and started ${pagesSince(from).length} pages`);
        // An answer held until Close preview and the second project's open passed changes nothing of the second, though it
        // brings a higher version.
        release = cloud.hold(snapshot.session.id);
        await ended('Close preview with a reading held', () => indicators.presses('project', [{ item: 'Reload', ms: PRESS_MS }, { item: 'Close preview', ms: PRESS_MS * 4 }]));
        // Another snapshot's Reload while that reading still waits: read and reloaded all the same.
        await openSession(another.session, another.origin);
        reloaded = endpoint.waitForNote((note) => note.role === 'project' && note.loaded, SHOWN_MS, 'another snapshot after its Reload, as a reading of the one before waited');
        await indicators.press('project', 'Reload');
        await reloaded;
        out.reloadBesideHeld = 'reloaded';
        await ended('Close preview of another snapshot', () => indicators.press('project', 'Close preview'));
        await openSession(second.session, second.origin);
        const secondLine = await lineOf();
        from = endpoint.notes.length;
        cloud.raise(snapshot.session.id);
        release();
        await sleep(SETTLED_MS);
        // Read before the second's page is asked anything, which a reload of it would leave unanswered.
        const started = pagesSince(from).length;
        expect(started === 0, `an answer after its preview ended started ${started} pages in the second project's window`);
        const after = { shown: await indicators.read('project'), line: await lineOf() };
        expect(isUp(after.shown, 'e2e second project') && after.line === secondLine, `an answer after its preview ended changed the second project's: ${JSON.stringify(after)}`);
        out.heldAnswer = 'changed nothing of the second';
        await ended('Close preview of the second project', () => indicators.press('project', 'Close preview'));
        // 401 signs the app out, the preview ending with its words.
        await openSession(snapshot.session, snapshot.origin);
        cloud.revokeApps();
        const signedOut = await ended('Reload as the app was signed out', () => indicators.press('project', 'Reload'));
        expect(signedOut.some((each) => each.message === signedOutWords), `a 401 at Reload held ${JSON.stringify(signedOut)}`);
        await run.signIn();
        // The session gone: Reload ends the preview with its words.
        await openSession(snapshot.session, snapshot.origin);
        cloud.remove(snapshot.session.id);
        const gone = await ended('Reload of a snapshot gone', () => indicators.press('project', 'Reload'));
        expect(gone.length === 1 && gone[0].message === GONE, `a snapshot gone held ${JSON.stringify(gone)}`);
        out.gone = gone[0].message;
        // Rule 12: Close preview as an end of the extension's own comes, another snapshot's gone: one end, with its
        // words or none.
        await openSession(another.session, another.origin);
        cloud.remove(another.session.id);
        const both = await ended('Reload of a snapshot gone, and Close preview at once',
            () => indicators.presses('project', [{ item: 'Reload', ms: PRESS_MS }, { item: 'Close preview', ms: PRESS_MS + 20 }]));
        expect(both.length === 1 && (both[0].message === GONE || Object.keys(both[0]).length === 0), `a snapshot gone as Close preview came held ${JSON.stringify(both)}`);
        out.goneAndClosed = both[0].message ?? 'Close preview\'s';
        return out;
    }

    // Rule 12: several ends at once leave one preview or none, one indicator or none, no question up.
    async function checkTogether() {
        const out = {};
        await openSession(marked.session, marked.origin);
        const twice = await ended('Close preview twice',
            () => indicators.presses('project', [{ item: 'Close preview', ms: PRESS_MS }, { item: 'Close preview', ms: PRESS_MS + 30 }]));
        expect(twice.length <= 1, `Close preview twice held ${JSON.stringify(twice)}`);
        out.closeTwice = twice.length;
        // A second project opened as the first one's end is on its way.
        await openSession(marked.session, marked.origin);
        from = endpoint.notes.length;
        const back = appLoaded("the app's page as a second project opened");
        await indicators.presses('project', [{ item: 'Close preview', ms: PRESS_MS }], { open: second.session.id, openMs: PRESS_MS });
        await back;
        await sleep(SETTLED_MS);
        const isServed = await served(second.origin);
        const state = await indicators.read('app');
        expect(isServed === state.up && await questions.read('app') === null, `a second project opened as the first one's end came left ${JSON.stringify({ isServed, state })}`);
        out.secondAsFirstEnds = isServed ? 'the second open, its indicator up' : 'none, its indicator down';
        if (isServed) await step('app', { do: 'close' });
        await down('the indicator after the second project');
        out.twoOpens = await twoOpens();
        return out;
    }

    // Rule 1 with two sessions the app's own code opens, the second's open on its way while the first one's indicator
    // waits for the main thread, which the hook holds where the second's check needs none of it: the second served, its
    // indicator up with its name as its first page starts and after a Reload, down after Close preview, the first one's
    // open refused.
    async function twoOpens() {
        from = endpoint.notes.length;
        const shownAt = projectLoaded('the second of two sessions opened at once');
        const two = await step('app', { do: 'openTwo', first: marked.session.id, second: second.session.id });
        const firstPage = await shownAt;
        const started = pagesSince(from).find((note) => note.role === 'project');
        expect(two.url && firstPage.loaded === two.url.replace(/\/$/, '') && isUp(started?.indicator ?? {}, SECOND_NAME),
            `the second of two opened at once showed ${firstPage.loaded} with ${JSON.stringify({ two, indicator: started?.indicator })}`);
        if (two.held) expect(two.first.error === ENDED_AS_OPENED, `the first of two opened at once answered ${JSON.stringify(two.first)}, the second's open past it`);
        from = endpoint.notes.length;
        const reloaded = projectLoaded('the second of two after Reload');
        await indicators.press('project', 'Reload');
        await reloaded;
        const again = pagesSince(from).find((note) => note.role === 'project');
        expect(isUp(again?.indicator ?? {}, SECOND_NAME) && isUp(await indicators.read('project'), SECOND_NAME),
            `the second of two after Reload: ${JSON.stringify(again?.indicator)}`);
        await ended('Close preview of the second of two', () => indicators.press('project', 'Close preview'));
        return two.held ? 'the second served, the first refused' : `one after the other here: the first ${two.first.error ? 'refused' : 'served, then ended'}`;
    }
}
