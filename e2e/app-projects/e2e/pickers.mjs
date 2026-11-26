import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { indicatorsOn } from './indicator.mjs';

// A file input's picker, as e2e/run.mjs checks it on each platform. Where the host shows it, macOS's open panel and
// Android's system picker, it closes as its page goes: at the web view's own reload, at the preview's end and, on
// macOS, as the end is on its way, whichever comes first. A file input clicked on the page that came shows it again,
// on Android a file chosen there reaches that page, and no page gets a file of a picker its page left. A move within
// the page's document leaves Android's up. iOS's is WebKit's own, which stays over the page that comes, a known issue
// that a line of the run's output shows while it holds (docs/known-issues.md).
const LOAD_MS = 180000;
const POLL_MS = 300;
const SHOWN_MS = 15000;
const SETTLED_MS = 3000;
const LATER_MS = 3000;
const TAP_MS = 1500;
const TOOL_MS = 30000;
const TRIES = 20;
// When Close preview comes after the script that clicks the file input is armed, which runs 800 ms on as its user's
// click: before the click, about with it and after it.
const END_MS = [500, 800, 1100];
const CLICK = 'e2eFile(); undefined';
const PICKER_NAME = 'e2e picker project';

function expect(isHeld, problem) {
    if (!isHeld) throw new Error(problem);
}

export async function checkPickers(run) {
    const {
        platform, endpoint, openSession, adb, applicationId,
    } = run;
    const indicators = indicatorsOn(run);
    const step = async (role, what) => {
        const answered = await endpoint.step(role, what);
        expect(answered.error === undefined, `the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    };
    const appLoaded = (what) => endpoint.waitForNote((note) => note.role === 'app' && note.loaded, LOAD_MS, what);
    const projectLoaded = (what) => endpoint.waitForNote((note) => note.role === 'project' && note.loaded, LOAD_MS, what);
    const files = () => endpoint.notes.filter((note) => note.event === 'files');
    const chosenFiles = new Set();
    async function until(read, test, what, ms = SHOWN_MS) {
        const deadline = Date.now() + ms;
        for (;;) {
            const value = await read();
            if (test(value)) return value;
            expect(Date.now() < deadline, `${what}: ${JSON.stringify(value)}`);
            await sleep(POLL_MS);
        }
    }
    async function ended(what, end) {
        const back = appLoaded(`the app's page after ${what}`);
        await end();
        await back;
        await until(() => indicators.read('app'), (shown) => !shown.up, `the indicator after ${what}`);
    }
    const project = await run.stepsProject(PICKER_NAME);
    const before = files().length;
    const out = platform === 'macos' ? await onMacos() : platform === 'ios' ? { end: await onIos() } : platform === 'android' ? await onAndroid() : 'not this platform';
    const reached = files().slice(before).filter((note) => !chosenFiles.has(note));
    expect(reached.length === 0, `a page got the files of a picker its page left: ${JSON.stringify(reached)}`);
    return out;

    // The page's picker read until it is up or down.
    function picker(role, isUp, what) {
        return until(() => step(role, { do: 'pickerUp' }), (up) => (up !== null) === isUp, what);
    }

    async function shown(role) {
        await step(role, { do: 'clickFile' });
        await picker(role, true, `the file input's picker did not come up on the ${role}'s page`);
    }

    async function goneAndShownAgain(role, what) {
        await picker(role, false, `the picker stayed over the page that came after ${what}`);
        await shown(role);
        await step(role, { do: 'dismissPicker' });
        await picker(role, false, `the picker shown again after ${what} did not close`);
        return 'closed, and shown again on the page that came';
    }

    async function onMacos() {
        await openSession(project.session, project.origin);
        await shown('project');
        const reloaded = projectLoaded("the project's page after Reload with its picker up");
        await indicators.press('project', 'Reload');
        await reloaded;
        const reload = await goneAndShownAgain('project', 'Reload');
        await shown('project');
        await ended("Close preview with a file input's picker up", () => indicators.press('project', 'Close preview'));
        const end = await knownLine();
        expect(end === 'closed', "the host's picker stayed over the app's page after the preview's end");
        await goneAndShownAgain('app', 'Close preview');
        const onItsWay = {};
        for (const ms of END_MS) {
            await openSession(project.session, project.origin);
            await step('project', { do: 'fileInput' });
            const clicked = endpoint.waitForNote((note) => note.event === 'gesture', LOAD_MS, 'the click as the end was on its way');
            await ended(`Close preview ${ms} ms after a file input's click was armed`, () => step('project', {
                do: 'presses', presses: [{ item: 'Close preview', ms }, { gesture: CLICK, ms: 0 }],
            }));
            await picker('app', false, `a file input clicked as the preview's end was on its way, ${ms} ms after its click was armed, left its picker up`);
            const { failure } = await clicked;
            onItsWay[ms] = failure === null ? 'clicked on the project\'s page' : `no click: ${failure}`;
        }
        // The click came before the end at least once, or the race was never run.
        expect(Object.values(onItsWay).some((click) => click.startsWith('clicked')), `no click came before the end: ${JSON.stringify(onItsWay)}`);
        return { reload, end, onItsWay };
    }

    async function onIos() {
        await openSession(project.session, project.origin);
        await shown('project');
        await ended("Close preview with a file input's picker up", () => indicators.press('project', 'Close preview'));
        const end = await knownLine();
        if (end === 'stays') await step('app', { do: 'dismissPicker' });
        return end;
    }

    // The line the known issue's check reads.
    async function knownLine() {
        const left = await (platform === 'macos' ? picker('app', false, 'closed').catch(() => 'stays') : step('app', { do: 'pickerUp' }));
        const said = left === null ? 'closed' : 'stays';
        console.log(`PREVIEW KNOWN picker-after-end ${JSON.stringify(said)}`);
        return said;
    }

    async function onAndroid() {
        const adbRun = (...args) => spawnSync(adb(), args, { encoding: 'utf8', timeout: TOOL_MS });
        const resumed = () => (adbRun('shell', 'dumpsys', 'activity', 'activities').stdout.match(/topResumedActivity=ActivityRecord\{\S+ \S+ (\S+)/) ?? [])[1] ?? null;
        const isOwn = (front) => front?.startsWith(`${applicationId()}/`) ?? false;
        const size = adbRun('shell', 'wm', 'size').stdout.match(/(\d+)x(\d+)/);
        const middle = [String(Math.round(size[1] / 2)), String(Math.round(size[2] / 2))];
        const name = `crossbind-e2e-picker-${Date.now()}.txt`;
        const local = join(tmpdir(), name);
        writeFileSync(local, 'crossbind e2e: a file chosen in the picker');
        adbRun('push', local, `/sdcard/Download/${name}`);
        rmSync(local, { force: true });
        adbRun('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', `file:///sdcard/Download/${name}`);
        // The page's input over its whole viewport, tapped as its user taps it, until the system's picker is in front.
        async function inFront(role) {
            await step(role, { do: 'fileInput' });
            for (let tries = 0; tries < TRIES / 4; tries += 1) {
                await sleep(TAP_MS);
                adbRun('shell', 'input', 'tap', ...middle);
                const front = await until(resumed, (shown) => !isOwn(shown), 'no picker', SETTLED_MS).catch(() => null);
                if (front) return front;
            }
            throw new Error(`a tap on the ${role}'s file input brought no picker in front: ${resumed()}`);
        }
        const ownInFront = (what) => until(resumed, isOwn, `the picker stayed in front after ${what}`);
        // A file chosen as its user chooses it, which reaches the page that asked, with its name.
        async function chosen(role, origin) {
            const front = await inFront(role);
            const reached = endpoint.waitForNote((note) => note.event === 'files' && note.origin === origin, LOAD_MS, `the file chosen on the ${role}'s page`);
            const tried = [];
            for (let tries = 0; tries < TRIES && !tried.includes('chosen'); tries += 1) {
                await sleep(TAP_MS);
                const { stdout = '' } = adbRun('exec-out', 'uiautomator', 'dump', '/dev/tty');
                const nodes = [...stdout.matchAll(/<node\b([^>]*?)\/?>/g)].map(([, attributes]) => Object.fromEntries([...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
                const tap = (node) => {
                    const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
                    adbRun('shell', 'input', 'tap', String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2)));
                };
                const file = nodes.find((node) => node.text === name);
                const downloads = nodes.find((node) => node.text === 'Downloads' && node.package?.includes('documentsui'));
                const roots = nodes.find((node) => node['content-desc'] === 'Show roots');
                if (file) tap(file);
                else if (downloads) tap(downloads);
                else if (roots) tap(roots);
                tried.push(file ? 'chosen' : downloads ? 'Downloads' : roots ? 'roots' : 'looked');
            }
            expect(tried.includes('chosen'), `the file was not found in the picker: ${tried.join(', ')}`);
            const got = await reached;
            chosenFiles.add(got);
            expect(JSON.stringify(got.names) === JSON.stringify([name]), `the ${role}'s page got the files ${JSON.stringify(got.names)}, not ${name}`);
            return { picker: front, names: got.names };
        }
        await openSession(project.session, project.origin);
        const moved = { picker: await inFront('project') };
        await step('project', { do: 'later', what: 'pushState', ms: LATER_MS });
        await sleep(LATER_MS + SETTLED_MS);
        moved.front = resumed();
        expect(!isOwn(moved.front), `a move within the page's document took its picker down: ${moved.front}`);
        adbRun('shell', 'input', 'keyevent', 'KEYCODE_BACK');
        await ownInFront('Back');
        await inFront('project');
        const reloaded = projectLoaded("the project's page after its reload with the picker in front");
        await step('project', { do: 'later', what: 'reload', ms: LATER_MS });
        await reloaded;
        await ownInFront("the page's reload");
        const reload = await chosen('project', new URL(project.url).origin);
        await inFront('project');
        const back = appLoaded("the app's page after the preview's end with the picker in front");
        await step('project', { do: 'later', what: 'close', ms: LATER_MS });
        await back;
        await ownInFront("the preview's end");
        const end = await chosen('app', 'https://appassets.androidplatform.net');
        return { moved: `the picker stayed in front: ${moved.front}`, reload, end };
    }
}
