// The conformance suite inside an app: the page reaches the module the app's host runs as a worker-backed web build
// reaches its worker, and the host runs embind-jsi as React Native does.
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { app as host, events, menu, notification, shell, tray, updater } from 'crossbind/app';
// Constants bind only for the names imported here; the header also defines one no leg imports.
import {
    initNative, AllSymbols as confConstantsModule, CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION,
    CONF_HEX, CONF_INT, CONF_NEGATIVE, CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName,
} from '@crossbind/conformance/native/confconstants.h';
// Variadic functions, function-like and renaming macros and mutable globals bind only for the names imported here.
import {
    ConfVaBuffer, confCounter, confCounterValue, confGreeting, confGreetingValue, confMacroAdd, confMacroAdd_, confMacroWide, confMacroWide_, confVaNoexcept, confMacroHalf,
    confMacroHalf_, confMacroLength, confMacroLength_, confRenamed, confRenamedTarget, confVaFormat, confVaSum, vaDouble,
    allocBuffer, cstring, readCString, readNumberAt, readPointerAt, writeNumberAt, writePointerAt,
} from '@crossbind/conformance/native/confextras.h';
import { Counter } from './native/counter.rs';
import { LAUNCH_ARGS, LAUNCH_URL, NOTIFICATION, PHONE_URL, TRASHED_FILE, TRAY } from '../e2e/launch.mjs';
// Direct crate imports: bridged from the crates' own sources, no surface file.
import { Uuid } from 'cargo:uuid';
import { Version, VersionReq } from 'cargo:semver';
import { Regex } from 'cargo:regex';
import { xxh364, Xxh3 } from 'cargo:xxhash-rust/xxh3';
import { xxh64, Xxh64 } from 'cargo:xxhash-rust/xxh64';
import { xxh32, Xxh32 } from 'cargo:xxhash-rust/xxh32';
import { Argon2, Params as Argon2Params, Algorithm as Argon2Algorithm, Version as Argon2Version } from 'cargo:argon2-rust';
import { Params as Argon2ModuleParams, Memory as Argon2Memory } from 'cargo:argon2-rust/params';
import { XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader } from 'cargo:lzma-rust2';

// A sandboxed frame of the page reaches the module's channel too, but not the token of the page's top frame; on Android
// it gets neither the token nor the port, nor the object a page asks for its port with.
function callFromSandboxedFrame() {
    const frame = document.createElement('iframe');
    frame.sandbox = 'allow-scripts';
    frame.srcdoc = `<script>
        const post = (text) => parent.postMessage(text, '*');
        try {
            if (window.__crossbind_token || window.__crossbind_port || window.__crossbind_ready) post('[0,"a sandboxed frame got the port"]');
            else window.webkit.messageHandlers.crossbind.postMessage('["get",0,["ConfBox"],[]]').then(String, () => 'refused').then(post);
        } catch {
            post('refused');
        }
    </script>`;
    const answer = new Promise((resolve) => {
        addEventListener('message', (event) => resolve(String(event.data)), { once: true });
    });
    document.body.append(frame);
    return answer.finally(() => frame.remove());
}

// On Android a frame of the page's own origin has the object a page asks for its port with, and the app answers the top
// frame alone: the page keeps its port, and the module the objects the page holds.
async function askFromSameOriginFrame(m) {
    const box = await new m.ConfBox(2, 3);
    const frame = document.createElement('iframe');
    // A frame's empty first document gets no such object; a blob URL's document has the page's origin and does.
    frame.src = URL.createObjectURL(new Blob(['<p>a frame of the page</p>'], { type: 'text/html' }));
    const loaded = new Promise((resolve) => { frame.onload = resolve; });
    document.body.append(frame);
    await loaded;
    const ready = frame.contentWindow.__crossbind_ready;
    if (!ready) throw new Error("a frame of the page's origin has no object to ask for a port with, so nothing was checked");
    ready.postMessage('frame');
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    frame.remove();
    const area = await Promise.race([box.area(), new Promise((resolve) => { setTimeout(() => resolve('no answer'), 3000); })]);
    if (area !== 6) throw new Error(`after a frame asked for a port, an object of the page answered ${area}`);
}

// A function the page passes to the module runs in the page once native code calls it, with no answer for native code,
// and one native code kept runs each time it calls it again.
async function checkCallbacks(m) {
    const got = [];
    const answer = await m.jsCall((x) => got.push(x), 3.5);
    if (answer !== undefined) throw new Error(`native code got an answer from a page function: ${JSON.stringify(answer)}`);
    await m.jsStore((x) => got.push(x));
    await m.jsFire(7);
    await m.jsFire(8);
    for (let i = 0; i < 100 && got.length < 3; i += 1) await new Promise((resolve) => { setTimeout(resolve, 20); });
    if (JSON.stringify(got) !== '[3.5,7,8]') throw new Error(`the page functions native code called ran with ${JSON.stringify(got)}, not 3.5, 7 and 8`);
}

// The window changes its size a while after the host answers, and the page later still.
async function checkPageSize(when) {
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    for (let i = 0; i < 100 && innerHeight !== 600; i += 1) await new Promise((resolve) => { setTimeout(resolve, 20); });
    if (innerWidth !== 800 || innerHeight !== 600) throw new Error(`${when}, the page is ${innerWidth} × ${innerHeight}, not 800 × 600`);
}

// On Windows and Linux the menus go in a bar of the window, which keeps the page at the size app.window gives, and no
// menus take the bar away; on macOS they go in the screen's menu bar, and a phone has none.
async function checkMenus(isDesktop) {
    const menus = [
        { label: 'File', items: [{ label: 'Open', id: 'open', accelerator: 'CmdOrCtrl+O' }, { type: 'separator' }, { role: 'quit' }] },
        { role: 'editMenu' },
        { label: 'View', items: [{ label: 'Sidebar', id: 'sidebar', checked: true, accelerator: 'F9' }] },
    ];
    const set = await menu.set(menus).then(() => 'set', (error) => error.message);
    if (!isDesktop) {
        if (!set.includes('has no menu bar')) throw new Error(`menu.set() did not refuse on a phone: ${set}`);
        return;
    }
    if (set !== 'set') throw new Error(`menu.set() failed: ${set}`);
    await checkPageSize('with its menu bar');
    await menu.set([]);
    await checkPageSize('without its menu bar');
    await menu.set(menus);
    await checkPageSize('with its menu bar again');
}

// e2e/run.mjs serves a newer version whose file its signature covers, then the same version with that file changed: the
// app gets past the first one's signature to find it unpacks to no app, and refuses the second.
async function checkUpdates() {
    const offered = await updater.check();
    if (offered?.version !== '99.0.0') throw new Error(`updater.check() found ${JSON.stringify(offered)}, not the 99.0.0 e2e/run.mjs serves`);
    const signed = await updater.install().then(() => 'installed', (error) => error.message);
    if (!signed.includes('cannot install the update')) throw new Error(`a signed update did not get past its signature: ${signed}`);
    // e2e/run.mjs reads why, where the runner trusts the key the app is signed with.
    console.log(`crossbind e2e: the signed update was refused: ${signed}`);
    const tampered = await updater.install().then(() => 'installed', (error) => error.message);
    if (!tampered.includes('app.updater.publicKey')) throw new Error(`a tampered update was not refused: ${tampered}`);
}

const LAUNCH_TIMEOUT_MS = 30000;
// Longer than e2e/run.mjs's steps may take together, so a failure of its own says what went wrong.
const FULL_SCREEN_TIMEOUT_MS = 150000;

// e2e/run.mjs reads the clipboard, shows the page's element full screen, as only a user's click could, gives the
// window's screen a new scale, checks the window still covers it, and leaves full screen: the page waits for both changes.
function checkScaledFullScreen() {
    let counted;
    let timer;
    return new Promise((resolve, reject) => {
        let changes = 0;
        counted = () => {
            changes += 1;
            if (changes === 2) resolve();
        };
        document.addEventListener('fullscreenchange', counted);
        timer = setTimeout(() => reject(new Error('the page was not shown full screen and back')), FULL_SCREEN_TIMEOUT_MS);
        console.log('FILL SCREEN');
    }).finally(() => {
        document.removeEventListener('fullscreenchange', counted);
        clearTimeout(timer);
    });
}

// The next event of this name, which comes within LAUNCH_TIMEOUT_MS.
function nextEvent(name) {
    let stop;
    let timer;
    return new Promise((resolve, reject) => {
        stop = events.on(name, resolve);
        timer = setTimeout(() => reject(new Error(`no event ${name} reached the page`)), LAUNCH_TIMEOUT_MS);
    }).finally(() => {
        stop?.();
        clearTimeout(timer);
    });
}

// e2e/run.mjs launches a desktop app with LAUNCH_URL, which reached the app before the page listened; a phone's opens
// with none. The page listens first, then asks, as a page does to miss no link.
async function checkLaunchUrls(expected) {
    const stop = events.on('open-url', () => {});
    const urls = await host.launchUrls();
    stop();
    if (JSON.stringify(urls) !== JSON.stringify(expected)) throw new Error(`app.launchUrls() is ${JSON.stringify(urls)}, not ${JSON.stringify(expected)}`);
}

// e2e/run.mjs opens an Android app with PHONE_URL once the page listens, as a link a user taps does.
async function checkOpenedUrl() {
    const opened = nextEvent('open-url');
    console.log('OPEN LINK');
    const { url } = await opened;
    if (url !== PHONE_URL) throw new Error(`the link the app was opened with reached the page as ${JSON.stringify(url)}, not ${PHONE_URL}`);
}

// e2e/run.mjs launches the app again, from a folder that is not this app's, with LAUNCH_ARGS and that folder once the
// page listens: the app that runs takes the launch, and its link, and the one launched leaves.
async function checkSecondInstance() {
    const launched = Promise.all([nextEvent('second-instance'), nextEvent('open-url')]);
    console.log('LAUNCH AGAIN');
    const [{ args, cwd }, { url }] = await launched;
    const folder = args.at(-1);
    // Windows takes a folder's name in any case.
    const isSameFolder = cwd.includes('\\') ? folder?.toLowerCase() === cwd.toLowerCase() : folder === cwd;
    if (JSON.stringify(args.slice(0, -1)) !== JSON.stringify(LAUNCH_ARGS) || !isSameFolder) {
        throw new Error(`the app launched again handed over ${JSON.stringify({ args, cwd })}`);
    }
    if (url !== LAUNCH_ARGS.at(-1)) throw new Error(`the link the app was launched again with reached the page as ${JSON.stringify(url)}`);
}

// e2e/run.mjs clicks the tray's icon, its menu's first item with checked and the notification: on Windows with the
// messages Windows sends the app, on Linux as the tray and the notification server of the run's own session bus. A
// macOS app's icon shows unclicked, and its notification would ask its user first; a phone has neither.
async function checkTray(isDesktop) {
    // The host holds a page that went around crossbind/app to the same menus.
    const unchecked = await globalThis.Crossbind.app('tray.set', { menu: [{ label: 'Quit', role: 'quit' }] }).then(() => 'set', (error) => error.message);
    if (!unchecked.includes('takes no role')) throw new Error(`a tray menu with a standard item was not refused: ${unchecked}`);
    const set = await tray.set(TRAY).then(() => 'set', (error) => error.message);
    if (!isDesktop) {
        if (!set.includes('has no tray icon')) throw new Error(`tray.set() did not refuse on a phone: ${set}`);
        const shown = await notification.show(NOTIFICATION).then(() => 'shown', (error) => error.message);
        if (!shown.includes('shows no notifications')) throw new Error(`notification.show() did not refuse on a phone: ${shown}`);
        return;
    }
    // A Windows session without a taskbar has no notification area, which e2e/run.mjs checks the runner's has not.
    if (set.includes('notification area did not take')) {
        console.log(`NO NOTIFICATION AREA: ${set}`);
        return;
    }
    if (set !== 'set') throw new Error(`tray.set() failed: ${set}`);
    if (!navigator.userAgent.includes('Macintosh')) {
        const shown = await notification.show(NOTIFICATION).then(() => 'shown', (error) => error.message);
        if (shown !== 'shown') throw new Error(`notification.show() failed: ${shown}`);
        const clicked = Promise.all([nextEvent('tray'), nextEvent('menu'), nextEvent('notification')]);
        console.log('CLICK TRAY');
        const [, click] = await clicked;
        const item = TRAY.menu.find((entry) => 'checked' in entry);
        if (click.id !== item.id || click.checked !== !item.checked) {
            throw new Error(`a click of the tray's ${item.label} reached the page as ${JSON.stringify(click)}`);
        }
    }
    const removed = await tray.remove().then(() => 'removed', (error) => error.message);
    if (removed !== 'removed') throw new Error(`tray.remove() failed: ${removed}`);
}

initNative().then(async (m) => {
    try {
        // Markup can make a crossbind:// request as well, so one without the page's token must be refused. On Android the
        // bytes travel over the page's port alone, and the page's origin serves no such request; during development that
        // origin is the dev server's, which answers any path with the page.
        const isAndroid = Boolean(globalThis.__crossbind_port);
        // The desktop window opens the page at the size app.window gives, whatever frame it adds around it.
        const isDesktop = !isAndroid && navigator.maxTouchPoints === 0;
        // A built desktop app asks for an update first, which tells e2e/run.mjs that the app app.relaunch() opened anew
        // has opened.
        if (isDesktop && !import.meta.env.DEV) await updater.check();
        if (isDesktop && (innerWidth !== 800 || innerHeight !== 600)) {
            throw new Error(`the page is ${innerWidth} × ${innerHeight}, not the 800 × 600 app.window gives`);
        }
        // A desktop page may show an element full screen.
        if (isDesktop && !(document.fullscreenEnabled ?? document.webkitFullscreenEnabled)) throw new Error('the page cannot show an element full screen');
        // The page has getUserMedia() for the camera and the microphone of app.permissions, which WebKit keeps from an
        // app without their reasons, and WebKitGTK without its media streams.
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('the page has no camera or microphone, which app.permissions lists');
        // A macOS page's location, which app.permissions lists, comes from the host, as WKWebView gives none there.
        if (isDesktop && navigator.userAgent.includes('Macintosh') && /\[native code\]/.test(String(navigator.geolocation.getCurrentPosition))) {
            throw new Error("the macOS page's navigator.geolocation is WebKit's, which gives no position there");
        }
        // A desktop page reads the clipboard on its user's gesture alone, which e2e/run.mjs gives on Windows. A read that
        // waits reads nothing either.
        if (isDesktop) {
            const read = navigator.clipboard?.readText().then(() => 'read', (error) => error.name);
            const answer = await Promise.race([read, new Promise((resolve) => { setTimeout(() => resolve('waited'), 3000); })]);
            if (answer === 'read') throw new Error('the page read the clipboard without its user\'s gesture');
        }
        // The app's own functions answer over the page's channel on every platform, and the host checks what it opens.
        const folders = await host.paths();
        if (![folders.data, folders.cache, folders.logs].every((folder) => /^(\/|[A-Za-z]:\\)/.test(folder))) {
            throw new Error(`the app's folders are no absolute paths: ${JSON.stringify(folders)}`);
        }
        const opened = await shell.openExternal('javascript:void 0').then(() => 'opened', (error) => error.message);
        if (!opened.includes('http, https and mailto')) throw new Error(`a javascript: address was not refused: ${opened}`);
        // The host refuses a message dialog no platform shows to a page that went around crossbind/app, before showing one.
        const unshowable = [
            [{ message: '' }, 'takes a message'],
            [{ message: 'Saved.', buttons: ['A', 'B', 'C', 'D'] }, 'three buttons at most'],
            [{ message: 'Saved.', buttons: ['OK', ''] }, 'each with a label'],
            [{ message: 'Saved.', kind: 'question' }, 'the kind question'],
        ];
        for (const [options, refusal] of unshowable) {
            const asked = globalThis.Crossbind.app('dialog.message', options).then(() => 'answered', (error) => error.message);
            const answer = await Promise.race([asked, new Promise((resolve) => { setTimeout(() => resolve('a dialog showed'), 3000); })]);
            if (!answer.includes(refusal)) throw new Error(`a message dialog no platform shows was not refused: ${answer}`);
        }
        // The page opens files where app.openPath lets it, the data folder here, and shows the app's folders and what a
        // dialog picked alone.
        const separator = folders.data.includes('\\') ? '\\' : '/';
        const outside = await shell.openPath(folders.data.replace(/[^\\/]+$/, 'crossbind-outside')).then(() => 'opened', (error) => error.message);
        if (!outside.includes('app.openPath')) throw new Error(`a path outside the app's folders was not refused: ${outside}`);
        const unlisted = await shell.openPath(`${folders.cache}${separator}crossbind-missing`).then(() => 'opened', (error) => error.message);
        if (!unlisted.includes('app.openPath')) throw new Error(`a file in a folder app.openPath does not list was not refused: ${unlisted}`);
        const listed = await shell.openPath(`${folders.data}${separator}crossbind-missing`).then(() => 'opened', (error) => error.message);
        if (listed === 'opened' || listed.includes('app.openPath')) throw new Error(`a missing file where app.openPath lets the page: ${listed}`);
        const inside = await shell.revealInFolder(`${folders.data}${separator}crossbind-missing`).then(() => 'shown', (error) => error.message);
        if (inside === 'shown' || inside.includes("reaches the app's folders")) throw new Error(`a missing file in the app's folder: ${inside}`);
        // The page moves what is in the app's folders to the trash, but none of the folders.
        const outsideTrash = await shell.trash(folders.data.replace(/[^\\/]+$/, 'crossbind-outside')).then(() => 'trashed', (error) => error.message);
        if (!outsideTrash.includes('shell.trash')) throw new Error(`a path outside the app's folders was not refused the trash: ${outsideTrash}`);
        const folderTrash = await shell.trash(folders.data).then(() => 'trashed', (error) => error.message);
        if (!folderTrash.includes('itself')) throw new Error(`the app's data folder was not refused the trash: ${folderTrash}`);
        // A link before a .. would lead the system out of the folder the path reads as.
        const dotted = await shell.trash(`${folders.data}${separator}crossbind-missing${separator}..${separator}${TRASHED_FILE}`).then(() => 'trashed', (error) => error.message);
        if (!dotted.includes('without . or ..')) throw new Error(`a path with .. in it was not refused the trash: ${dotted}`);
        // e2e/run.mjs leaves a file in a desktop app's data folder, which goes to the trash and is gone from there.
        if (isDesktop && !import.meta.env.DEV) {
            const file = `${folders.data}${separator}${TRASHED_FILE}`;
            const trashed = await shell.trash(file).then(() => 'trashed', (error) => error.message);
            if (trashed !== 'trashed') throw new Error(`a file in the app's data folder did not go to the trash: ${trashed}`);
            const again = await shell.trash(file).then(() => 'trashed', (error) => error.message);
            if (!again.includes('there is no')) throw new Error(`a file that went to the trash is still there: ${again}`);
        }
        await checkMenus(isDesktop);
        // A development session opens the app with no link.
        await checkLaunchUrls(isDesktop && !import.meta.env.DEV ? [LAUNCH_URL] : []);
        // A phone's system ends its apps, and its store updates them.
        if (!isDesktop) {
            const quit = await host.quit().then(() => 'quit', (error) => error.message);
            if (!quit.includes('does not quit itself')) throw new Error(`app.quit() did not refuse on a phone: ${quit}`);
            const relaunched = await host.relaunch().then(() => 'relaunched', (error) => error.message);
            if (!relaunched.includes('does not quit itself')) throw new Error(`app.relaunch() did not refuse on a phone: ${relaunched}`);
            const checked = await updater.check().then(() => 'checked', (error) => error.message);
            if (!checked.includes('does not update itself')) throw new Error(`updater.check() did not refuse on a phone: ${checked}`);
            await checkTray(false);
            // iOS asks its user before a link from outside opens the app, which no run can answer.
            if (isAndroid && !import.meta.env.DEV) await checkOpenedUrl();
        } else if (!import.meta.env.DEV) {
            await checkUpdates();
            await checkSecondInstance();
            // e2e/run.mjs tells a Windows app's window the system goes to sleep and wakes, as Windows does, first.
            if (navigator.userAgent.includes('Windows')) await Promise.all([nextEvent('suspend'), nextEvent('resume'), checkScaledFullScreen()]);
            await checkTray(true);
        }
        if (!isAndroid || !import.meta.env.DEV) {
            const { status } = await fetch(isAndroid ? '/b/result?id=1' : 'crossbind://app/b/result?id=1');
            if (status !== (isAndroid ? 404 : 403)) throw new Error(`the host answered ${status} to a request without the page's token`);
        }
        const framed = await callFromSandboxedFrame();
        if (framed.startsWith('[0,')) throw new Error(`a sandboxed frame called the module: ${framed}`);
        if (isAndroid) await askFromSameOriginFrame(m);
        await checkCallbacks(m);
        const result = await runConformance({
            cpp: { ConfBox: m.ConfBox, ConfCircle: m.ConfCircle, ConfOps: m.ConfOps, ConfShape: m.ConfShape },
            rustPkg: {
                RustyCounter: m.RustyCounter,
                Widget: m.Widget,
                Gauge: m.Gauge,
                Mode: m.Mode,
                RustIntVector: m.RustIntVector,
                doubleIt: m.doubleIt,
                greet: m.greet,
                checkedParse: m.checkedParse,
                parseEven: m.parseEven,
                tag: m.tag,
                jsonEcho: m.jsonEcho,
                jsonTally: m.jsonTally,
                jsonPick: m.jsonPick,
                SharedDoc: m.SharedDoc,
                dupDoc: m.dupDoc,
                sharedDropCount: m.sharedDropCount,
            },
            rustAppLocal: { Counter },
            rustCrates: {
                Uuid, Version, VersionReq, Regex, xxh364, Xxh3, xxh64, Xxh64, xxh32, Xxh32,
                Argon2, Argon2Params, Argon2Algorithm, Argon2Version, Argon2ModuleParams, Argon2Memory,
                XzOptions, XzWriter, XzReader, LzmaOptions, LzmaWriter, Lzma2Reader, LzmaReader,
            },
            // A JS function cannot cross to the host, as it cannot cross to a worker.
            jsLive: null,
            pointers: m,
            callbacks: m,
            strings: m,
            wrappers: m,
            types: m,
            constants: {
                CONF_BASE, CONF_BASE_NAME, CONF_CHAR, CONF_DOUBLE, CONF_EXPRESSION, CONF_HEX, CONF_INT, CONF_NEGATIVE,
                CONF_PLATFORM, CONF_STRING, CONF_TRUE, CONF_WIDE, confGlobal, confGlobalName, module: confConstantsModule,
            },
            extras: {
                ConfVaBuffer, confCounter, confCounterValue, confGreeting, confGreetingValue, confMacroAdd, confMacroAdd_, confMacroWide, confMacroWide_, confVaNoexcept, confMacroHalf,
                confMacroHalf_, confMacroLength, confMacroLength_, confRenamed, confRenamedTarget, confVaFormat, confVaSum, vaDouble,
                allocBuffer, cstring, readCString, readNumberAt, readPointerAt, writeNumberAt, writePointerAt,
            },
            rustKit: m,
            caps: { worker: true, jsiNative: true },
        });
        // The summary comes last: the run ends the app once it reads it, or a built desktop app's once it has opened anew.
        if (result.pass !== result.run) console.log(result.lines.join('\n'));
        console.log(result.summary);
        document.getElementById('conf').textContent = result.summary;
        if (isDesktop && !import.meta.env.DEV && result.pass === result.run) await host.relaunch();
    } catch (error) {
        console.error(`CONFORMANCE ERR: ${error?.message ?? error}`);
    }
});
