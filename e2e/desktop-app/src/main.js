// The conformance suite inside an app: the page reaches the module the app's host runs as a worker-backed web build
// reaches its worker, and the host runs embind-jsi as React Native does.
import { runConformance } from '@crossbind/conformance/spec/run.mjs';
import { app as host, events, invoke, menu, notification, routeUrl, shell, tray, updater, windows } from 'crossbind/app';
import * as clipboard from '@crossbind/extension-clipboard';
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
import {
    ACTIVITIES, AGAIN_FILE, FIRST_ARGS, FIRST_FILES, LAUNCH_ARGS, LAUNCH_URL, NOTIFICATION, OPENED_FILE, PHONE_FILE_TEXT, PHONE_FILES, PHONE_LINKS,
    PHONE_URL, PROBE_URLS, SHORTCUTS, TRASHED_FILE, TRAY,
} from '../e2e/launch.mjs';
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
    // A macOS app's Dock icon shows the page's items, which no other platform has.
    const docked = await menu.setDock([{ label: 'New window', id: 'new-window' }]).then(() => 'set', (error) => error.message);
    if (isDesktop && navigator.userAgent.includes('Macintosh')) {
        if (docked !== 'set') throw new Error(`menu.setDock() failed: ${docked}`);
        const titles = await invoke('probe.dockMenu');
        if (JSON.stringify(titles) !== JSON.stringify(['New window'])) throw new Error(`the Dock's menu is ${JSON.stringify(titles)}, not the page's`);
    } else if (!docked.includes('a macOS app alone has a Dock menu')) {
        throw new Error(`menu.setDock() did not refuse off macOS: ${docked}`);
    }
    if (!isDesktop) {
        if (!set.includes('has no menu bar')) throw new Error(`menu.set() did not refuse on a phone: ${set}`);
        const popped = await menu.popup([{ label: 'Open', id: 'open' }], { x: 1, y: 1 }).then(() => 'opened', (error) => error.message);
        if (!popped.includes('opens no menu')) throw new Error(`menu.popup() did not refuse on a phone: ${popped}`);
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
    const offeredToApp = await invoke('probe.checkForUpdate');
    if (offeredToApp !== '99.0.0') throw new Error(`the app's own code found ${JSON.stringify(offeredToApp)} as the update, not 99.0.0`);
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

// e2e/run.mjs launches a desktop app with LAUNCH_URL and the probe's PROBE_URLS.launch, which reached the app before the
// page listened; a phone's opens with none. The page listens first, then asks, as a page does to miss no link, and gets
// its own link alone, as the probe its own, which the probe holds for the page as the event probe.url.
async function checkLaunchUrls(isLinked) {
    const stop = events.on('open-url', () => {});
    const urls = await host.launchUrls();
    const held = await events.held('probe.url');
    stop();
    const expected = isLinked ? [LAUNCH_URL] : [];
    if (JSON.stringify(urls) !== JSON.stringify(expected)) throw new Error(`app.launchUrls() is ${JSON.stringify(urls)}, not ${JSON.stringify(expected)}`);
    const probeHeld = isLinked ? [{ url: PROBE_URLS.launch }] : [];
    if (JSON.stringify(held) !== JSON.stringify(probeHeld)) throw new Error(`events.held('probe.url') is ${JSON.stringify(held)}, not ${JSON.stringify(probeHeld)}`);
    await checkProbed(isLinked ? [PROBE_URLS.launch] : []);
}

// Whether the folder the run named is the one the app was launched in: Windows takes a folder's name in any case.
function isSameFolder(folder, cwd) {
    return cwd.includes('\\') ? folder?.toLowerCase() === cwd.toLowerCase() : folder === cwd;
}

// The paths of files of these names in a folder, as the host makes them absolute, and whether the files are those.
const inFolder = (cwd, names) => names.map((file) => `${cwd}${cwd.includes('\\') ? '\\' : '/'}${file}`);
const isSameFiles = (paths, cwd, names) => paths.length === names.length && inFolder(cwd, names).every((path, index) => isSameFolder(paths[index], path));

// e2e/run.mjs launches a desktop app with FIRST_ARGS, then --cwd= and the folder it launches it in, among its links and
// FIRST_FILES: app.launchArgs() leaves out the links and files, which the page asks for with app.launchFiles(), each
// against that folder, the probe's among them reaching the probe alone. A phone opens with none.
async function checkLaunch(isDesktop) {
    const launch = await host.launchArgs();
    const files = await host.launchFiles();
    const probed = (await events.held('probe.files')).flatMap(({ paths }) => paths);
    if (!isDesktop) {
        if (launch.args.length > 0 || launch.cwd !== '' || files.length > 0 || probed.length > 0) {
            throw new Error(`a phone's launch has ${JSON.stringify({ launch, files, probed })}`);
        }
        return;
    }
    const { args, cwd } = launch;
    if (JSON.stringify(args.slice(0, -1)) !== JSON.stringify(FIRST_ARGS) || !isSameFolder(args.at(-1), `--cwd=${cwd}`)) {
        throw new Error(`app.launchArgs() is ${JSON.stringify(launch)}`);
    }
    if (!isSameFiles(files, cwd, [...FIRST_FILES.page, FIRST_FILES.url])) throw new Error(`app.launchFiles() is ${JSON.stringify(files)}`);
    if (!isSameFiles(probed, cwd, [FIRST_FILES.probe])) throw new Error(`the probe was launched with the files ${JSON.stringify(probed)}`);
}

// The links the probe got so far, each once.
async function checkProbed(expected) {
    const probed = await invoke('probe.urls');
    if (JSON.stringify(probed) !== JSON.stringify(expected)) throw new Error(`the probe got the links ${JSON.stringify(probed)}, not ${JSON.stringify(expected)}`);
}

// The links of the page's scheme that reach it until the probe hears of its own, which comes after them.
async function linksUntilProbed() {
    const links = [];
    const stop = events.on('open-url', ({ url }) => links.push(url));
    const { url } = await nextEvent('probe.url').finally(stop);
    return { links, probed: url };
}

// The values of the events of these names until each has come so many times, within LAUNCH_TIMEOUT_MS.
function eventsUntil(counts) {
    const heard = Object.fromEntries(Object.keys(counts).map((name) => [name, []]));
    let stops = [];
    let timer;
    return new Promise((resolve, reject) => {
        stops = Object.keys(counts).map((name) => events.on(name, (value) => {
            heard[name].push(value);
            if (Object.entries(counts).every(([other, count]) => heard[other].length >= count)) resolve(heard);
        }));
        timer = setTimeout(() => reject(new Error(`the page heard ${JSON.stringify(heard)}, not as many as ${JSON.stringify(counts)}`)), LAUNCH_TIMEOUT_MS);
    }).finally(() => {
        stops.forEach((stop) => stop());
        clearTimeout(timer);
    });
}

// e2e/run.mjs opens an Android app with PHONE_URL once the page listens, as a link a user taps does, then with
// PHONE_LINKS and on PHONE_FILES, and with the probe's PROBE_URLS.phone last: each reaches the owner of its scheme, site
// or type, the probe's the probe alone.
async function checkOpenedUrl() {
    const opened = eventsUntil({ 'open-url': 2, 'probe.url': 2, 'open-files': 1, 'probe.files': 2 });
    console.log('OPEN LINK');
    const heard = await opened;
    const urls = (name) => heard[name].map(({ url }) => url);
    if (JSON.stringify(urls('open-url')) !== JSON.stringify([PHONE_URL, PHONE_LINKS.page])) throw new Error(`the links the app was opened with reached the page as ${JSON.stringify(urls('open-url'))}`);
    if (JSON.stringify(urls('probe.url')) !== JSON.stringify([PHONE_LINKS.probe, PROBE_URLS.phone])) throw new Error(`the probe's links reached it as ${JSON.stringify(urls('probe.url'))}`);
    await checkProbed([PHONE_LINKS.probe, PROBE_URLS.phone]);
    // Each file reaches the owner of its MIME type as a copy in the app's cache, of the name it had: the private
    // provider's, which came first, none.
    for (const [name, files] of [['open-files', [PHONE_FILES.page]], ['probe.files', [PHONE_FILES.probe, PHONE_FILES.bare]]]) {
        const paths = heard[name].flatMap(({ paths }) => paths);
        if (paths.length !== files.length || !files.every((file, index) => paths[index].endsWith(`/${file}`))) {
            throw new Error(`the files the app was opened on reached ${name} as ${JSON.stringify(paths)}`);
        }
        for (const path of paths) {
            const text = await invoke('probe.readFile', { path });
            if (text !== PHONE_FILE_TEXT) throw new Error(`the copy ${path} holds ${JSON.stringify(text)}`);
        }
    }
}

// e2e/run.mjs launches the app again, from a folder that is not this app's, with LAUNCH_ARGS, the probe's
// PROBE_URLS.again, AGAIN_FILE and --cwd= and that folder once the page listens: the app that runs takes the launch,
// whose arguments leave its links and its file out, which reach their owners, the probe's the probe alone, and the one
// launched leaves.
async function checkSecondInstance() {
    const launched = Promise.all([nextEvent('second-instance'), linksUntilProbed(), nextEvent('open-files')]);
    console.log('LAUNCH AGAIN');
    const [{ args, cwd }, { links, probed }, { paths }] = await launched;
    if (JSON.stringify(args.slice(0, -1)) !== JSON.stringify(LAUNCH_ARGS.slice(0, -1)) || !isSameFolder(args.at(-1), `--cwd=${cwd}`)) {
        throw new Error(`the app launched again handed over ${JSON.stringify({ args, cwd })}`);
    }
    if (!isSameFiles(paths, cwd, [AGAIN_FILE])) throw new Error(`the file the app was launched again with reached the page as ${JSON.stringify(paths)}`);
    if (JSON.stringify(links) !== JSON.stringify([LAUNCH_ARGS.at(-1)])) throw new Error(`the links the app was launched again with reached the page as ${JSON.stringify(links)}`);
    if (probed !== PROBE_URLS.again) throw new Error(`the probe's link the app was launched again with reached it as ${JSON.stringify(probed)}`);
    await checkProbed([PROBE_URLS.launch, PROBE_URLS.again]);
}

// e2e/run.mjs opens a macOS app that runs again, as a click of its Dock icon does, once the probe has hidden its window:
// the app shows the window before the probe hears it reopen.
async function checkReopen() {
    await invoke('probe.hide');
    const reopened = nextEvent('probe.reopen');
    console.log('REOPEN APP');
    const { isShown } = await reopened;
    if (!isShown) throw new Error('the probe heard the app reopen with its window hidden');
}

// e2e/run.mjs opens a macOS app that runs on a file of its type, as Finder does, which the page hears of.
async function checkOpenFile() {
    const opened = nextEvent('open-files');
    console.log('OPEN FILE');
    const { paths } = await opened;
    if (paths.length !== 1 || !paths[0].endsWith(`/dist/${OPENED_FILE}`)) throw new Error(`the file macOS opened the app on reached the page as ${JSON.stringify(paths)}`);
    if ((await invoke('probe.readFile', { path: paths[0] })) !== PHONE_FILE_TEXT) throw new Error(`the file macOS opened the app on is not ${paths[0]}`);
}

// e2e/run.mjs asks a Windows app's window whether its user's session may end, as Windows does as its user signs out:
// the probe refuses, which the window answers.
async function checkEndSession() {
    const asked = nextEvent('probe.quit-request');
    console.log('END SESSION');
    await asked;
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
    // A Windows session may take no tray icon at all, which e2e/run.mjs checks with one of its own.
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

// The clipboard extension's text reads back as the page wrote it, and the host refuses no text from a page that went
// around the package. The page puts back what the clipboard held, as the run's machine is someone's; iOS alone asks its
// user before an app reads another app's text, so the page there reads its own alone.
async function checkClipboard(isIos) {
    const held = isIos ? null : await clipboard.readText();
    const text = `crossbind e2e ${Date.now()} Öffnen 😀`;
    await clipboard.writeText(text);
    const read = await clipboard.readText();
    if (held !== null) await clipboard.writeText(held);
    if (read !== text) throw new Error(`the clipboard gave back ${JSON.stringify(read)}, not ${JSON.stringify(text)}`);
    const unchecked = await globalThis.Crossbind.app('clipboard.writeText', { text: 5 }).then(() => 'written', (error) => error.message);
    if (!unchecked.includes('takes a string')) throw new Error(`a clipboard write of no text was not refused: ${unchecked}`);
}

// The page's dialogs and what it asks to use reach the app's own page-dialogs and page-permissions, which answer at
// once: a dialog of the message "cancel" cancelled, a prompt() with what it was asked, and the location denied.
async function checkPageRequests() {
    alert('alert');
    if (!confirm('confirm') || confirm('cancel')) throw new Error("confirm() did not give page-dialogs' answers");
    const text = 'Öffnen 😀';
    const prompted = JSON.parse(prompt(`prompt ${text}`, `default ${text}`) ?? 'null');
    if (prompted?.message !== `prompt ${text}` || prompted.defaultText !== `default ${text}`) {
        throw new Error(`prompt() gave ${JSON.stringify(prompted)}, not what page-dialogs was asked`);
    }
    if (prompt('cancel') !== null) throw new Error('a prompt() that page-dialogs cancelled gave a text');
    const code = await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(() => resolve(0), (error) => resolve(error.code));
    });
    if (code !== GeolocationPositionError.PERMISSION_DENIED) throw new Error(`the location page-permissions denied ended with code ${code}`);
    const asked = await invoke('page-permissions.asked');
    if (!asked.some(({ kinds, origin, isListed }) => kinds.join() === 'location' && origin === location.origin && isListed)) {
        throw new Error(`page-permissions was not asked for the page's location: ${JSON.stringify(asked)}`);
    }
}

// How often until() asks again.
const POLL_MS = 100;

// The first of what an extension's function gives that find takes, once there is one, within LAUNCH_TIMEOUT_MS.
async function until(name, find, failure) {
    const end = Date.now() + LAUNCH_TIMEOUT_MS;
    for (;;) {
        const found = (await invoke(name)).find(find);
        if (found) return found;
        if (Date.now() > end) throw new Error(failure);
        await new Promise((resolve) => { setTimeout(resolve, POLL_MS); });
    }
}

// The page's navigations beyond the app's origins reach the app's own page-navigation, which refuses each, so the page
// stays: its top frame's, and but on Android, whose WebView loads a frame of another origin without asking, a frame's,
// which WebKitGTK names the top frame's.
async function checkNavigation(isDesktop, isAndroid) {
    const away = 'https://crossbind-e2e.invalid/away';
    location.href = away;
    const top = await until('page-navigation.asked', ({ url }) => url === away, `page-navigation was not asked for ${away}`);
    if (!top.isMainFrame || top.isNewWindow || top.isUserInitiated || !top.isPage) {
        throw new Error(`page-navigation was asked for the top frame's ${away} as ${JSON.stringify(top)}`);
    }
    if (isAndroid) return;
    // A window the page asks for at the app's own origins opens nowhere, without asking, and the page stays.
    window.open('about:blank');
    window.open(URL.createObjectURL(new Blob(['window'], { type: 'text/plain' })));
    await new Promise((resolve) => { setTimeout(resolve, POLL_MS * 5); });
    const windows = (await invoke('page-navigation.asked')).filter(({ isNewWindow }) => isNewWindow);
    if (windows.length > 0) throw new Error(`page-navigation was asked for a window of the app's own origins: ${JSON.stringify(windows)}`);
    const isLinux = isDesktop && !/Macintosh|Windows/.test(navigator.userAgent);
    const framed = 'https://crossbind-e2e.invalid/frame';
    const frame = document.createElement('iframe');
    frame.src = framed;
    document.body.append(frame);
    const asked = await until('page-navigation.asked', ({ url }) => url === framed, `page-navigation was not asked for ${framed}`).finally(() => frame.remove());
    if (asked.isMainFrame !== isLinux || asked.isNewWindow) throw new Error(`page-navigation was asked for a frame's ${framed} as ${JSON.stringify(asked)}`);
}

// The page's downloads reach the app's own page-downloads, which asks nothing: one it saves, with the text the page gave
// it, and one it cancels. WebView2 names a download as it would save it, with a number where the user's Downloads
// folder has a file of its name.
async function checkDownloads() {
    const text = 'crossbind download Öffnen 😀';
    const download = (name) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
        link.download = name;
        document.body.append(link);
        link.click();
        link.remove();
    };
    const ended = (prefix) => until('page-downloads.ended', ({ name }) => name.startsWith(prefix), `page-downloads heard of no download ${prefix}`);
    download('probe-download.txt');
    const saved = await ended('probe-download');
    if (saved.failure !== null || saved.text !== text || !saved.path.includes('probe-download')) {
        throw new Error(`the download page-downloads saved ended as ${JSON.stringify(saved)}`);
    }
    download('cancel-download.txt');
    const cancelled = await ended('cancel-download');
    if (!cancelled.isCancelled || cancelled.failure !== null) throw new Error(`the download page-downloads cancelled ended as ${JSON.stringify(cancelled)}`);
}

// What the app carries beside its page: a file of the probe's, in the folder its registry names, and one of the app's
// own, in the folder app.paths().resources names, which Android copies out of its APK.
async function checkCarried() {
    const { resources } = await host.paths();
    if (typeof resources !== 'string' || resources === '') throw new Error(`app.paths() gave no folder of the app's own files: ${JSON.stringify(resources)}`);
    const carried = await invoke('probe.carried');
    if (carried.extension !== 'carried by the probe\n' || carried.app !== 'carried by the app\n') {
        throw new Error(`the app carries ${JSON.stringify(carried)}, not the probe's file and its own`);
    }
}

// JSON text of a value whose objects' members are in the order of their names, as a dictionary keeps none.
const sortedJson = (value) => JSON.stringify(value, (key, member) => (member && typeof member === 'object' && !Array.isArray(member)
    ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => (a < b ? -1 : 1))) : member));

// The probe hands an iOS or macOS app's delegate user activities, as Handoff does, with a userInfo of each kind a
// property list holds: the page gets the one of app.activityTypes, its date, URL and UUID as their text and its set as an
// array, once it has asked, and the probe the one of its own, with its bytes; the macOS delegate refuses one of a type no
// one continues. The page makes one of app.activityTypes current, and then none, which another platform refuses.
async function checkActivities(isApple, isDesktop) {
    const set = await host.setUserActivity({ type: ACTIVITIES.page, userInfo: { note: 7 }, webpageUrl: 'https://example.com/notes/7' })
        .then(() => 'set', (error) => error.message);
    if (!isApple) {
        if (!set.includes('an iOS or macOS app alone sets a user activity')) throw new Error(`app.setUserActivity() did not refuse off Apple's platforms: ${set}`);
        return;
    }
    if (set !== 'set') throw new Error(`app.setUserActivity() failed: ${set}`);
    const undeclared = await host.setUserActivity({ type: ACTIVITIES.nobody }).then(() => 'set', (error) => error.message);
    if (!undeclared.includes('app.activityTypes')) throw new Error(`app.setUserActivity() took a type app.activityTypes does not list: ${undeclared}`);
    await host.setUserActivity(null);
    // A development build claims no user activity on macOS.
    if (!isDesktop || !import.meta.env.DEV) {
        const { activityTypes } = await invoke('probe.apple');
        if (JSON.stringify(activityTypes) !== JSON.stringify([ACTIVITIES.page, ACTIVITIES.probe])) {
            throw new Error(`the app's Info.plist lists the user activities ${JSON.stringify(activityTypes)}`);
        }
    }
    const continued = Promise.all([nextEvent('user-activity'), nextEvent('probe.activity')]);
    const held = await events.held('user-activity');
    if (held.length > 0) throw new Error(`the app was launched with the user activities ${JSON.stringify(held)}`);
    const taken = [];
    for (const [type, withData] of [[ACTIVITIES.page, false], [ACTIVITIES.probe, true], [ACTIVITIES.nobody, false]]) {
        taken.push(await invoke('probe.continueActivity', { type, withData }));
    }
    const [page, probed] = await continued;
    const userInfo = {
        n: 1, flag: true, text: 'a', list: [1, null], nested: { x: 'y' }, date: '1970-01-01T00:00:00Z', url: 'https://example.com/x',
        uuid: 'E621E1F8-C36C-495A-93FC-0C247A3E6E5F', set: ['s'],
    };
    if (sortedJson(page) !== sortedJson({ type: ACTIVITIES.page, userInfo, webpageUrl: 'https://example.com/page' })) {
        throw new Error(`the page heard the user activity ${JSON.stringify(page)}`);
    }
    if (JSON.stringify(probed) !== JSON.stringify({ type: ACTIVITIES.probe, text: 'a', data: [1, 2, 3], webpageUrl: 'https://example.com/page' })) {
        throw new Error(`the probe heard the user activity ${JSON.stringify(probed)}`);
    }
    if (isDesktop && JSON.stringify(taken) !== JSON.stringify([true, true, false])) throw new Error(`the macOS delegate took the user activities as ${JSON.stringify(taken)}`);
}

// A phone app's icon shows the quick actions of app.shortcutItems and the probe's, as iOS's Info.plist and Android's
// static shortcuts list them, and the probe taps each as the system does, on Android with the intent its shortcuts.xml
// gives: the page gets its own once it has asked, the probe its own, and none one of a type no one owns, which iOS's
// delegate refuses and Android has no shortcut of. Android starts a tap in a task it empties first, which leaves the
// page as it was, as this check goes on in it.
async function checkShortcuts(isAndroid) {
    const types = [SHORTCUTS.page, SHORTCUTS.probe];
    // Android lists its static shortcuts in no order of its manifest's.
    const listed = isAndroid ? (await invoke('probe.shortcuts')).toSorted((a, b) => (a.id < b.id ? -1 : 1)) : (await invoke('probe.apple')).shortcutTypes;
    const expected = isAndroid ? [{ id: SHORTCUTS.page, label: 'New note' }, { id: SHORTCUTS.probe, label: 'Probe' }] : types;
    if (JSON.stringify(listed) !== JSON.stringify(expected)) throw new Error(`the app's icon lists the quick actions ${JSON.stringify(listed)}`);
    const tapped = Promise.all([nextEvent('shortcut-item'), nextEvent('probe.shortcut')]);
    const held = await events.held('shortcut-item');
    if (held.length > 0) throw new Error(`the app was launched with the quick actions ${JSON.stringify(held)}`);
    const taken = [];
    for (const type of [...types, SHORTCUTS.nobody]) taken.push(await invoke('probe.tapShortcut', { type }));
    const [page, probed] = await tapped;
    if (page.type !== SHORTCUTS.page || probed.type !== SHORTCUTS.probe) throw new Error(`the quick actions' taps reached ${JSON.stringify({ page, probed })}`);
    if (JSON.stringify(taken) !== JSON.stringify([true, true, false])) throw new Error(`the quick actions' taps were taken as ${JSON.stringify(taken)}`);
}

// The host owns an iOS or macOS app's notification center, whose owner the probe hands notifications as the system
// does: each extension hears of each, one to show while the app is in front as its first decider shows it, the probe's
// in the list alone and another as a banner, in the list and with its sound, and the taps and actions its user answers
// with, a tap of one of notification.show()'s being the page's event notification. The app's push token reaches every
// extension, or why the system gave none, and so does a silent push, whose answers iOS hears as one.
async function checkNotifications(isDesktop) {
    const owner = await invoke('probe.notificationCenter');
    if (owner !== 'CrossbindNotificationCenter') throw new Error(`the notification center's owner is ${owner}, not the host's`);
    const probed = eventsUntil({ 'probe.notification': 4 });
    const presentations = [await invoke('probe.notify', { id: 'probe.present' }), await invoke('probe.notify', { id: 'other.present' })];
    const shown = [{ banner: false, list: true, sound: false, badge: false }, { banner: true, list: true, sound: true, badge: false }];
    if (JSON.stringify(presentations) !== JSON.stringify(shown)) throw new Error(`the notifications shown in front were ${JSON.stringify(presentations)}`);
    const tapped = nextEvent('notification');
    await invoke('probe.notify', { id: 'crossbind.menu.e2e', answer: 'tap' });
    await tapped;
    await invoke('probe.notify', { id: 'probe.reply', answer: 'reply' });
    const heard = (await probed)['probe.notification'];
    const answers = heard.map(({ id, isAnswered, isTap, action }) => [id, isAnswered, isTap, action]);
    const told = [['probe.present', false, false, ''], ['other.present', false, false, ''], ['crossbind.menu.e2e', true, true, ''], ['probe.reply', true, false, 'reply']];
    if (JSON.stringify(answers) !== JSON.stringify(told) || !heard.every(({ probe, isRemote }) => probe === true && isRemote === false)) {
        throw new Error(`the probe heard the notifications ${JSON.stringify(heard)}`);
    }
    const registered = nextEvent('probe.push');
    await invoke('probe.registerForPush');
    const { token, failure } = await registered;
    if (!(/^[0-9a-f]+$/.test(token ?? '') || failure)) throw new Error(`registerForPush() reached the probe with ${JSON.stringify({ token, failure })}`);
    const pushed = nextEvent('probe.push-message');
    const fetched = await invoke('probe.silentPush');
    const { probe } = await pushed;
    if (probe !== true || fetched !== (isDesktop ? null : 'newData')) throw new Error(`a silent push reached the probe as ${JSON.stringify({ probe, fetched })}`);
}

// What an extension adds to an app, through the probe: C compiled with folders of its own and its own macros, text
// that is no UTF-8 as U+FFFD, a call of the app's functions from native code, which is no page's, and the pages it hears
// of, and the app's state before its user, whose changes the page hears too; on the desktop the close its user asks
// for and the quit the page asks for as its user's Quit does, which the probe refuses, so the app runs on; on the main
// thread a task that throws, which the app outlives; on Apple's platforms the
// Info.plist key and the iOS privacy reasons it gave; and on Android its manifest's elements, its resources, its
// permission and the page's WebView.
async function checkContract(isDesktop, isAndroid) {
    const sum = await invoke('probe.compiled');
    if (sum !== 6) throw new Error(`the probe's C gave ${sum}, not 6, with its include folder and macros`);
    const text = await invoke('probe.invalidUtf8');
    if (text !== 'a�b') throw new Error(`a reply of no UTF-8 reached the page as ${JSON.stringify(text)}`);
    if ((await invoke('probe.fromPage')) !== true || (await invoke('probe.invokeOwn')) !== false) {
        throw new Error("a call through the native invoke() was taken for the page's");
    }
    const pages = await invoke('probe.pages');
    if (!(pages.count >= 1) || !pages.isCallThread || !pages.isCallPage) {
        throw new Error(`the probe heard of this page not as it started, on the thread of its calls, as the page they come from: ${JSON.stringify(pages)}`);
    }
    const refused = await invoke('probe.refusedName');
    if (!refused.includes('names a function other.name, where its own start with its name and a dot')) throw new Error(`the probe named a function of another's: ${refused}`);
    const refusedRole = await invoke('probe.refusedRole');
    if (!refusedRole.includes("calls onDownload, which the holder of the host's page-downloads alone does")) {
        throw new Error(`the probe took the page's downloads without the role: ${refusedRole}`);
    }
    // Its onStart ran once, before the window it saw open, which is the app's, of the app's id; Android's app has no
    // window an extension reaches.
    const lifecycle = await invoke('probe.lifecycle');
    const appId = isAndroid ? 'dev.crossbind.crossbind_e2e_desktop_app' : 'dev.crossbind.crossbind-e2e-desktop-app';
    if (lifecycle.starts !== 1 || !lifecycle.isStartFirst || lifecycle.windows !== (isAndroid ? 0 : 1) || lifecycle.isAppWindow === isAndroid || lifecycle.appId !== appId) {
        throw new Error(`the probe started and saw the app's window as ${JSON.stringify(lifecycle)}`);
    }
    const started = await events.held('probe.started');
    if (JSON.stringify(started) !== '[{"isStartFirst":true}]') throw new Error(`the event the probe held as it started reached the page as ${JSON.stringify(started)}`);
    if (!isAndroid) {
        const thrown = await invoke('probe.throwOnMain').then(() => 'answered', (error) => error.message);
        if (!thrown.includes('probe.throwOnMain gave no answer')) throw new Error(`a task that threw on the main thread: ${thrown}`);
    }
    if (isDesktop) {
        await invoke('probe.close');
        const closes = await invoke('probe.closes');
        if (closes !== 1) throw new Error(`the probe was asked ${closes} times as the window closed, not once`);
    }
    if (!((await invoke('probe.actives')) >= 1)) throw new Error("the probe heard nothing of the app's state before its user");
    // The probe tells a macOS, iOS or Windows app it became inactive and active again, or the other way round, as its
    // system does, and the page hears both changes in that order; Linux's focus and Android's activity take no telling.
    if (!isAndroid && (!isDesktop || /Macintosh|Windows/.test(navigator.userAgent))) {
        const heard = [];
        const stops = ['active', 'inactive'].map((name) => events.on(name, () => heard.push(name)));
        const changed = Promise.all([nextEvent('active'), nextEvent('inactive')]);
        const was = await invoke('probe.flipActive');
        await changed;
        for (const stop of stops) stop();
        const told = was ? ['inactive', 'active'] : ['active', 'inactive'];
        if (JSON.stringify(heard) !== JSON.stringify(told)) throw new Error(`the page heard ${JSON.stringify(heard)} as the app was told ${JSON.stringify(told)}`);
    }
    if (isDesktop) {
        const asked = nextEvent('probe.quit-request');
        await host.requestQuit();
        await asked;
    }
    if (isAndroid) {
        const probed = await invoke('probe.android');
        if (probed.meta !== 'manifest' || probed.resource !== 'resource' || !probed.permission || !probed.webView || probed.kotlin !== 'kotlin' || probed.maven !== 'maven') {
            throw new Error(`the app took not all of the probe's Android parts, its Kotlin and its Maven library among them: ${JSON.stringify(probed)}`);
        }
        if (!(probed.resumes >= 1)) throw new Error("the probe's Java heard no resume of the activity, of which the e2e app's page-permissions, before it, fails as each");
        const failed = await invoke('probe.javaThrows').then(() => 'answered', (error) => error.message);
        if (!failed.includes('probe.javaThrows gave no answer')) throw new Error(`an answer of the Java whose done threw: ${failed}`);
    } else if (!isDesktop || navigator.userAgent.includes('Macintosh')) {
        const apple = await invoke('probe.apple');
        if (apple.plist !== 'plist' || (!isDesktop && !apple.privacy) || apple.swift !== 5 || apple.swiftClass !== 'swift') {
            throw new Error(`the app took not all of the probe's Apple parts, its Swift among them: ${JSON.stringify(apple)}`);
        }
    } else if (navigator.userAgent.includes('Windows')) {
        // WinRT's ABI headers compile in an extension's C++, and its classes activate in the app.
        const toast = await invoke('probe.toastTemplate');
        if (toast !== 'ok') throw new Error(`the probe's WinRT gave no toast template: ${toast}`);
    } else {
        // A Linux extension compiles and links against a library beyond crossbind's sysroot, from the packages it pins.
        const zstd = await invoke('probe.zstd');
        if (!(zstd >= 10400)) throw new Error(`the probe's zstd gave the version ${zstd}`);
    }
}

// The probe's URLs, which its route answers: a body whole, with the query and a header it was asked with; a file the
// host reads, the part a Range asks for as 206, from the end too, and the whole file without one, under a path the route
// gets decoded; and refused, a range past the end, any method but GET and HEAD, a path that leaves its folder, a request
// the route answers nothing, and an extension without a route.
async function checkRoutes() {
    const size = await invoke('probe.routeFile');
    const byteAt = (i) => i % 251;
    // A request that fails names what it asked for.
    const fetched = (url, init = {}) => fetch(url, init).catch((error) => {
        throw new Error(`${init.method ?? 'GET'} ${url} ${JSON.stringify(init.headers ?? {})} failed: ${error.message}`);
    });
    const hello = await fetched(routeUrl('probe', '/hello.txt?who=page'), { headers: { 'X-Probe': 'page' } });
    const said = await hello.text();
    if (hello.status !== 200 || said !== 'hello who=page' || hello.headers.get('X-Probe-Header') !== 'page' || hello.headers.get('X-Probe-Page') !== 'yes') {
        throw new Error(`the probe's route answered ${hello.status} ${JSON.stringify(said)}, as asked with ${hello.headers.get('X-Probe-Header')} by page ${hello.headers.get('X-Probe-Page')}`);
    }
    const file = routeUrl('probe', '/a%20b/file.bin');
    const part = await fetched(file, { headers: { Range: 'bytes=100-199' } });
    const partBytes = new Uint8Array(await part.arrayBuffer());
    if (part.status !== 206 || part.headers.get('Content-Range') !== `bytes 100-199/${size}` || partBytes.length !== 100 || partBytes.some((byte, i) => byte !== byteAt(100 + i))) {
        throw new Error(`a part of the probe's file came as ${part.status} ${part.headers.get('Content-Range')}, ${partBytes.length} bytes`);
    }
    const tail = new Uint8Array(await (await fetched(file, { headers: { Range: 'bytes=-10' } })).arrayBuffer());
    if (tail.length !== 10 || tail[9] !== byteAt(size - 1)) throw new Error(`the last 10 bytes of the probe's file came as ${tail.length} bytes`);
    const whole = await fetched(file);
    const wholeBytes = new Uint8Array(await whole.arrayBuffer());
    if (whole.status !== 200 || wholeBytes.length !== size || wholeBytes.some((byte, i) => byte !== byteAt(i))) {
        throw new Error(`the probe's file came as ${whole.status}, ${wholeBytes.length} bytes`);
    }
    const statuses = await Promise.all([
        fetched(file, { headers: { Range: `bytes=${size}-` } }),
        fetched(file, { method: 'HEAD' }),
        fetched(file, { method: 'POST', body: 'x' }),
        fetched(routeUrl('probe', '/a%2F..%2Fsecret')),
        fetched(routeUrl('probe', '/unanswered')),
        fetched(routeUrl('nobody', '/x')),
    ].map((request) => request.then(({ status }) => status)));
    if (JSON.stringify(statuses) !== JSON.stringify([416, 200, 405, 400, 500, 404])) throw new Error(`the probe's route answered ${JSON.stringify(statuses)}`);
}

// An iOS app's App Group, which the probe's targets share: the probe writes into it, and app.paths() names its folder.
// Elsewhere there is none.
async function checkAppGroup(isIos) {
    const { group } = await host.paths();
    if (!isIos) {
        if (group !== '') throw new Error(`an app of no App Group has app.paths() name its folder ${JSON.stringify(group)}`);
        return;
    }
    const written = await invoke('probe.writeGroup');
    if (written?.id !== 'group.dev.crossbind.crossbind-e2e-desktop-app' || !written.folder.startsWith('/') || group !== written.folder) {
        throw new Error(`the iOS app's App Group is ${JSON.stringify(written)}, and app.paths() names ${JSON.stringify(group)}`);
    }
}

// The calls of the probe's functions, from its native code and on Android from its Java as well: their messages, which
// reach onMessage in order, each with its byte, all of them before the call resolves; their cancel, which the function
// hears of; and bytes both ways, in the message and in a frame, and from native code as a large result too.
async function checkCalls(isAndroid) {
    for (const prefix of isAndroid ? ['probe.', 'probe.java'] : ['probe.']) {
        const name = (base) => (prefix === 'probe.' ? `probe.${base}` : `probe.java${base[0].toUpperCase()}${base.slice(1)}`);
        const got = [];
        const counted = await invoke(name('count'), { count: 50 }, { onMessage: (message) => got.push(message) });
        if (counted !== 'counted' || got.length !== 50 || got.some(({ n, bytes }, i) => n !== i + 1 || !(bytes instanceof Uint8Array) || bytes[0] !== i + 1)) {
            throw new Error(`${name('count')} gave ${counted} after ${got.length} messages, the first ${JSON.stringify(got[0])}`);
        }
        const before = await invoke(name('cancels'));
        const controller = new AbortController();
        const waited = await invoke(name('wait'), {}, { signal: controller.signal, onMessage: () => controller.abort() })
            .then(() => 'answered', (error) => error.name);
        if (waited !== 'AbortError') throw new Error(`${name('wait')}, cancelled, ended as ${waited}`);
        let cancels = before;
        for (let tries = 0; tries < 50 && cancels === before; tries += 1) {
            await new Promise((resolve) => { setTimeout(resolve, 100); });
            cancels = await invoke(name('cancels'));
        }
        if (cancels !== before + 1) throw new Error(`${name('wait')}'s function heard of ${cancels - before} cancels, not one`);
        const small = await invoke(name('bytes'), { data: new Uint8Array([1, 2, 3]) });
        const large = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
        const echoed = await invoke(name('bytes'), { data: large.buffer });
        if (small.size !== 3 || !(small.back instanceof Uint8Array) || small.back.join() !== '3,2,1' || echoed.size !== 70000 || echoed.back[0] !== large[69999]) {
            throw new Error(`${name('bytes')} gave back ${small.size} and ${echoed.size} bytes`);
        }
    }
    const big = await invoke('probe.bigBytes');
    if (!(big instanceof Uint8Array) || big.length !== 100000 || big.some((byte, i) => byte !== i % 251)) throw new Error(`probe.bigBytes came as ${big?.length} bytes`);
}

// The page of another window of the app's, which e2e/run.mjs never reads: it reaches the module as the first does,
// holding its own objects, and tells the first what it is and what it hears through BroadcastChannel.
async function runOtherWindow(role) {
    const channel = new BroadcastChannel('e2e-windows');
    const post = (kind, value = {}) => channel.postMessage({ kind, role, ...value });
    try {
        const m = await initNative();
        const box = await new m.ConfBox(4, 5);
        for (const name of ['probe.every', 'probe.front', 'probe.mine', 'probe.later']) events.on(name, (value) => post(name, { value }));
        await events.held('probe.later');
        const own = await windows.current();
        localStorage.setItem('e2e-windows', role);
        post('ready', { id: own.id, name: own.name, title: own.title, area: await box.area() });
    } catch (error) {
        post('failed', { message: error?.message ?? String(error) });
    }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The app's windows: the page's own first; a second of another page of the app's, which reaches the same module, holds
// its objects alone, talks to this one through BroadcastChannel and localStorage, and hears the events for every page,
// for the page in front, which it is as it opened last, and the held one, but not one for this page alone; on the
// desktop a modal one and one without a frame; and as each closes, the app goes on with this one, whose objects stay.
// An iPhone shows one window, and an iPad's second is a scene iOS sizes and places itself.
async function checkWindows(m, isDesktop, isAndroid) {
    if (isAndroid) {
        const listed = await windows.list().then(() => 'listed', (error) => error.message);
        if (!listed.includes('an Android app has one window')) throw new Error(`windows.list() did not refuse on Android: ${listed}`);
        return;
    }
    const listed = await windows.list();
    const own = await windows.current();
    // A desktop app's first window is its first, and an iOS scene that connects anew gets an id of its own.
    if (listed.length !== 1 || listed[0].id !== own.id || (isDesktop && own.id !== 1) || own.name !== null) {
        throw new Error(`the app's windows are ${JSON.stringify(listed)}, and this page's ${JSON.stringify(own)}`);
    }
    await windows.set({ title: 'crossbind e2e' });
    const titled = (await windows.current()).title;
    if (titled !== 'crossbind e2e') throw new Error(`the page's window is titled ${JSON.stringify(titled)} after windows.set()`);
    if (!isDesktop && navigator.userAgent.includes('iPhone')) {
        const opened = await windows.open({ path: '/?window=second' }).then(() => 'opened', (error) => error.message);
        if (!opened.includes('an iPhone shows one window')) throw new Error(`windows.open() did not refuse on an iPhone: ${opened}`);
        return;
    }
    const box = await new m.ConfBox(2, 3);
    const channel = new BroadcastChannel('e2e-windows');
    const heard = [];
    channel.onmessage = ({ data }) => heard.push(data);
    // A run that stopped halfway may have left the value the second window writes, which would change nothing then.
    localStorage.removeItem('e2e-windows');
    const stored = [];
    const onStorage = ({ key, newValue }) => stored.push({ key, newValue });
    addEventListener('storage', onStorage);
    const told = [];
    const names = ['probe.every', 'probe.front', 'probe.mine', 'probe.later', 'window-opened', 'window-closed'];
    const stops = names.map((name) => events.on(name, (value) => told.push({ name, value })));
    await events.held('probe.later');
    const waitFor = async (list, find, what) => {
        for (let tries = 0; tries < 200; tries += 1) {
            const failed = heard.find((data) => data.kind === 'failed');
            if (failed) throw new Error(`the ${failed.role} window failed: ${failed.message}`);
            const found = list.find(find);
            if (found) return found;
            await sleep(50);
        }
        throw new Error(`no window told ${what}`);
    };
    // Reads what the host tells until it holds what is asked, naming what it told last.
    const waitUntil = async (read, holds, what) => {
        let told;
        for (let tries = 0; tries < 200; tries += 1) {
            told = await read();
            if (holds(told)) return told;
            await sleep(50);
        }
        throw new Error(`${what}: the host told ${JSON.stringify(told)}`);
    };
    const opened = await windows.open({ path: '/?window=second', name: 'second', title: 'Second', width: 480, height: 360 });
    // An iPad's scene takes its page, its title and its name alone.
    const sized = isDesktop ? [] : ['width', 'height'];
    if (opened.id === own.id || JSON.stringify(opened.ignored) !== JSON.stringify(sized)) throw new Error(`windows.open() gave ${JSON.stringify(opened)}`);
    const second = opened.id;
    const ready = await waitFor(heard, (data) => data.kind === 'ready' && data.role === 'second', 'the second window was ready');
    if (ready.id !== second || ready.name !== 'second' || ready.title !== 'Second' || ready.area !== 20) throw new Error(`the second window told ${JSON.stringify(ready)}`);
    await waitFor(told, ({ name, value }) => name === 'window-opened' && value.id === second && value.name === 'second', 'window-opened');
    await waitFor(stored, ({ key, newValue }) => key === 'e2e-windows' && newValue === 'second', 'the storage it wrote');
    if (isDesktop) {
        // The window keeps the size it opened at, which set() changes.
        const secondState = async () => (await windows.list()).find(({ id }) => id === second);
        await waitUntil(secondState, ({ width, height }) => width === 480 && height === 360, 'the second window is not at the 480 × 360 it opened at');
        await windows.set(second, { width: 520, height: 400 });
        await waitUntil(secondState, ({ width, height }) => width === 520 && height === 400, 'the second window is not at the 520 × 400 set() gave it');
    }
    if ((await windows.open({ name: 'second' })).id !== second) throw new Error('a name already open opened another window');
    const both = (await windows.list()).map(({ id, name }) => [id, name]);
    if (JSON.stringify(both) !== JSON.stringify([[own.id, null], [second, 'second']])) throw new Error(`the app's windows are ${JSON.stringify(both)}`);
    for (const name of ['probe.emitEvery', 'probe.emitFront', 'probe.emitMine']) await invoke(name);
    await invoke('probe.holdLater', { n: 1 });
    for (const kind of ['probe.every', 'probe.front', 'probe.later']) await waitFor(heard, (data) => data.kind === kind, `it heard ${kind}`);
    await waitFor(told, ({ name }) => name === 'probe.every', 'this page heard probe.every');
    await waitFor(told, ({ name }) => name === 'probe.mine', 'this page heard probe.mine');
    await sleep(500);
    if (told.some(({ name }) => name === 'probe.front' || name === 'probe.later') || heard.some((data) => data.kind === 'probe.mine')) {
        throw new Error(`the events reached the wrong pages: this one heard ${JSON.stringify(told.map(({ name }) => name))}, the second ${JSON.stringify(heard.map(({ kind }) => kind))}`);
    }
    const others = [second];
    if (isDesktop) {
        const modal = await windows.open({ path: '/?window=modal', parent: own.id, modal: true, width: 320, height: 200 });
        await waitFor(heard, (data) => data.kind === 'ready' && data.role === 'modal', 'the modal window was ready');
        await windows.close(modal.id);
        // A Wayland compositor places a window and keeps it among the others itself.
        const bare = await windows.open({ path: '/?window=bare', frame: false, alwaysOnTop: true, x: 40, y: 40, width: 300, height: 200 });
        const placed = bare.ignored.length === 0 || (navigator.userAgent.includes('Linux') && bare.ignored.join() === 'alwaysOnTop,x,y');
        if (!placed) throw new Error(`the window without a frame went without ${bare.ignored.join(', ')}`);
        await waitFor(heard, (data) => data.kind === 'ready' && data.role === 'bare', 'the window without a frame was ready');
        await windows.close(bare.id);
        others.push(modal.id, bare.id);
        // A move starts from a press of the primary button that is still down, which none is here: the window stays.
        const before = await windows.current();
        await windows.startDrag();
        await sleep(200);
        const after = await windows.current();
        if (after.x !== before.x || after.y !== before.y) throw new Error(`windows.startDrag() without a press moved the window from ${before.x}, ${before.y} to ${after.x}, ${after.y}`);
    } else {
        // iOS lets a window in front alone go, so the second, in the background now, comes to the front as it closes.
        await windows.focus(own.id);
        await waitUntil(() => windows.current(), ({ isFocused }) => isFocused, 'this window did not take the front again');
    }
    await windows.close(second);
    await waitFor(told, ({ name, value }) => name === 'window-closed' && value.id === second && value.name === 'second', 'window-closed');
    if (!isDesktop) {
        // A window in front hands the front to the app's window used last as it closes.
        const third = await windows.open({ path: '/?window=third', name: 'third' });
        await waitFor(heard, (data) => data.kind === 'ready' && data.role === 'third', 'the third window was ready');
        await windows.close(third.id);
        await waitFor(told, ({ name, value }) => name === 'window-closed' && value.id === third.id, 'the third window closed');
        await waitUntil(() => windows.current(), ({ isFocused }) => isFocused, 'this window did not take the front from the third');
        others.push(third.id);
    }
    const left = (await windows.list()).map(({ id }) => id);
    if (JSON.stringify(left) !== JSON.stringify([own.id])) throw new Error(`after the others closed, the app's windows are ${JSON.stringify(left)}`);
    if ((await box.area()) !== 6) throw new Error("an object of this page's went with another window");
    const closed = await invoke('probe.closedWindows');
    if (!others.every((id) => closed.includes(id))) throw new Error(`the probe saw the windows ${JSON.stringify(closed)} close`);
    // iOS shows an app's last window as long as the app runs.
    if (!isDesktop) {
        const last = await windows.close().then(() => 'closed', (error) => error.message);
        if (!last.includes("iOS shows an app's last window")) throw new Error(`windows.close() of the last window did not refuse on an iPad: ${last}`);
    }
    for (const stop of stops) stop();
    removeEventListener('storage', onStorage);
    localStorage.removeItem('e2e-windows');
    channel.close();
}

const otherWindow = new URLSearchParams(location.search).get('window');
if (otherWindow) runOtherWindow(otherWindow);
else initNative().then(async (m) => {
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
        await checkClipboard(!isAndroid && !isDesktop);
        await checkPageRequests();
        await checkNavigation(isDesktop, isAndroid);
        await checkDownloads();
        await checkCarried();
        await checkActivities(!isAndroid && (!isDesktop || navigator.userAgent.includes('Macintosh')), isDesktop);
        if (!isDesktop) await checkShortcuts(isAndroid);
        if (!isAndroid && (!isDesktop || navigator.userAgent.includes('Macintosh'))) await checkNotifications(isDesktop);
        await checkContract(isDesktop, isAndroid);
        await checkRoutes();
        await checkCalls(isAndroid);
        await checkAppGroup(!isAndroid && !isDesktop);
        await checkWindows(m, isDesktop, isAndroid);
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
            // The page reaches a folder outside the app's once it is allowed, as a dialog allows what its user picked, with
            // what is in it; the app's own code reaches any path at once, and names its own functions.
            const probed = await invoke('probe.folder');
            const unpicked = await shell.trash(`${probed}${separator}page.txt`).then(() => 'trashed', (error) => error.message);
            if (!unpicked.includes('what its dialogs picked')) throw new Error(`a file outside the app's folders was not refused the trash: ${unpicked}`);
            await invoke('probe.trash', { path: `${probed}${separator}app.txt` });
            await invoke('probe.allowPath', { path: `${probed}${separator}` });
            const picked = await shell.trash(`${probed}${separator}page.txt`).then(() => 'trashed', (error) => error.message);
            if (picked !== 'trashed') throw new Error(`a file in a folder the app allowed did not go to the trash: ${picked}`);
            const relative = await invoke('probe.openRelative');
            if (!relative.startsWith('crossbind: openPath takes an absolute path')) throw new Error(`the app's own openPath took a relative path: ${relative}`);
        }
        await checkMenus(isDesktop);
        // A development session opens the app with no link.
        await checkLaunchUrls(isDesktop && !import.meta.env.DEV);
        if (!isDesktop || !import.meta.env.DEV) await checkLaunch(isDesktop);
        // A phone's system ends its apps, and its store updates them.
        if (!isDesktop) {
            const quit = await host.quit().then(() => 'quit', (error) => error.message);
            if (!quit.includes('does not quit itself')) throw new Error(`app.quit() did not refuse on a phone: ${quit}`);
            const requested = await host.requestQuit().then(() => 'requested', (error) => error.message);
            if (!requested.includes('does not quit itself')) throw new Error(`app.requestQuit() did not refuse on a phone: ${requested}`);
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
            if (navigator.userAgent.includes('Macintosh')) {
                await checkReopen();
                await checkOpenFile();
            }
            if (navigator.userAgent.includes('Windows')) await checkEndSession();
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
        // The app quits for it whatever the probe's onClose says, which keeps the window open, as app.quit() asks none.
        if (isDesktop && !import.meta.env.DEV && result.pass === result.run) await host.relaunch();
    } catch (error) {
        console.error(`CONFORMANCE ERR: ${error?.message ?? error}`);
    }
});
