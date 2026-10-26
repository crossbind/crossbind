import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import config from '../crossbind.config.mjs';
import { LAUNCH_ARGS, LAUNCH_URL, NOTIFICATION, PHONE_URL, TRASHED_FILE, TRAY } from './launch.mjs';
import { UPDATE_PORT, signUpdate } from './updates.mjs';

// Opens the app `pnpm build` made, whose page runs the conformance suite and logs its summary last, and closes it
// once the summary is in, or a desktop app once it has opened anew, as its page asks then. With
// CROSSBIND_APP_PLATFORM=ios the app is an Xcode project, built and opened in the Simulator,
// and with android a Gradle project, built and opened on the attached device. With --installed a desktop app opens
// from where its installer put it: from its disk image on macOS, and on Linux and Windows from where its Debian package
// or setup program, which the runner ran first, installed it.
const RUN_TIMEOUT_MS = 300000;
// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const CONFORMANCE = /^CONFORMANCE (\d+)\/\1\b.*$/m;
// A whole line: the run ends the app once it reads it.
const FINISHED = /^(CONFORMANCE .*|CONFORMANCE ERR: .*)\r?\n/m;
const LAUNCH_AGAIN = /^LAUNCH AGAIN$/m;
const OPEN_LINK = /^OPEN LINK$/m;
const FILL_SCREEN = /^FILL SCREEN$/m;
const CLICK_TRAY = /^CLICK TRAY$/m;
const NO_NOTIFICATION_AREA = /^NO NOTIFICATION AREA: .*\r?\n/m;
const TRAY_HOST_READY = /^TRAY HOST READY$/m;
const TRAY_HOST_FAIL = /^TRAY HOST FAIL: (.*)$/m;
const TRAY_HOST_REMOVED = 'TRAY HOST REMOVED';
// Below the page's wait for the launch or the link, so a launch that stays or an adb that hangs says so.
const ASKED_TIMEOUT_MS = 20000;
// WebView2's DevTools, through which the run does on Windows what only a user's click could.
const DEVTOOLS_PORT = 9223;
// How long a window takes to fill the screen once the page asks.
const SETTLE_MS = 1000;
// How long the page's button waits for DevTools' click, which comes at once.
const CLICK_TIMEOUT_MS = 5000;
// How long an app takes to quit and open anew after app.relaunch(), and for its output to arrive after its exit.
const RELAUNCH_TIMEOUT_MS = 30000;
const EXIT_SETTLE_MS = 1000;
// Tells the window the scale of its screen went up by half, as Windows does when its user changes it, reads where the
// window is, and goes back. Anything that fails stops the script, and a window that takes 5 s to answer fails.
const SCALE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Screen {
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, ref Rect l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
    public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }
    // WM_DPICHANGED carries the place Windows suggests for the window, which webview leaves aside, and which Windows
    // copies into the window's process: the window's own place.
    static void Scale(IntPtr window, int dpi) {
        Rect suggested;
        IntPtr result;
        if (!GetWindowRect(window, out suggested)) throw new Exception("where the window is cannot be read");
        if (SendMessageTimeout(window, 0x02E0, (IntPtr)(dpi * 65536 + dpi), ref suggested, 2, 5000, out result) == IntPtr.Zero) throw new Exception("the window did not take the new scale: error " + Marshal.GetLastWin32Error());
    }
    public static string Check(IntPtr window) {
        int dpi = (int)GetDpiForWindow(window);
        if (dpi == 0) throw new Exception("the window has no scale");
        Scale(window, dpi * 3 / 2);
        Rect rect;
        MonitorInfo info = new MonitorInfo();
        info.Size = Marshal.SizeOf(info);
        if (!GetWindowRect(window, out rect) || !GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) throw new Exception("where the window is cannot be read");
        Scale(window, dpi);
        Rect m = info.Monitor;
        if (rect.Left == m.Left && rect.Top == m.Top && rect.Right == m.Right && rect.Bottom == m.Bottom) return "covered";
        return string.Format("is at {0},{1},{2},{3}, not the screen's {4},{5},{6},{7}", rect.Left, rect.Top, rect.Right, rect.Bottom, m.Left, m.Top, m.Right, m.Bottom);
    }
}
'@
[Screen]::Check((Get-Process -Id APP_PID).MainWindowHandle)
`;
// Tells the window the system goes to sleep, then that it woke, as Windows does with WM_POWERBROADCAST's PBT_APMSUSPEND
// and PBT_APMRESUMEAUTOMATIC. A window that takes 5 s to answer fails.
const SLEEP_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class Power {
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    public static void Sleep(IntPtr window) {
        foreach (int kind in new[] { 4, 18 }) {
            IntPtr result;
            if (SendMessageTimeout(window, 0x0218, (IntPtr)kind, IntPtr.Zero, 2, 5000, out result) == IntPtr.Zero) throw new Exception("the window did not take WM_POWERBROADCAST: error " + Marshal.GetLastWin32Error());
        }
    }
}
'@
[Power]::Sleep((Get-Process -Id APP_PID).MainWindowHandle)
`;
// Clicks the tray's icon, an item of its menu and the notification, with the messages Windows sends the window of a tray
// icon of NOTIFYICON_VERSION_4: WM_APP + 3, with what happened beside the icon's id, 1. WM_CONTEXTMENU opens the menu,
// whose loop takes the keys posted to it: Down to each item up to the one clicked, and Return. A window that takes 5 s
// to answer fails.
const TRAY_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class Tray {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string type, string title);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    static IntPtr Find(string type, int app, bool isShown) {
        IntPtr window = IntPtr.Zero;
        while ((window = FindWindowEx(IntPtr.Zero, window, type, null)) != IntPtr.Zero) {
            uint process;
            GetWindowThreadProcessId(window, out process);
            if (process == app && (!isShown || IsWindowVisible(window))) return window;
        }
        return IntPtr.Zero;
    }
    static void Tell(IntPtr tray, int what) {
        IntPtr result;
        if (SendMessageTimeout(tray, 0x8003, IntPtr.Zero, (IntPtr)(0x10000 | what), 2, 5000, out result) == IntPtr.Zero) throw new Exception("the tray's window did not answer: error " + Marshal.GetLastWin32Error());
    }
    public static void Click(int app, int downs) {
        IntPtr tray = Find("crossbind_tray", app, false);
        if (tray == IntPtr.Zero) throw new Exception("the app has no tray window");
        Tell(tray, 0x400);
        if (!PostMessage(tray, 0x8003, (IntPtr)(200 * 65536 + 200), (IntPtr)(0x10000 | 0x7B))) throw new Exception("the tray's menu was not asked for: error " + Marshal.GetLastWin32Error());
        IntPtr menu = IntPtr.Zero;
        for (int i = 0; i < 50 && menu == IntPtr.Zero; i += 1) {
            Thread.Sleep(100);
            menu = Find("#32768", app, true);
        }
        if (menu == IntPtr.Zero) throw new Exception("the tray's menu did not open");
        for (int i = 0; i < downs; i += 1) PostMessage(menu, 0x0100, (IntPtr)0x28, IntPtr.Zero);
        PostMessage(menu, 0x0100, (IntPtr)0x0D, IntPtr.Zero);
        Tell(tray, 0x405);
    }
}
'@
[Tray]::Click(APP_PID, DOWNS)
`;

const root = resolve(import.meta.dirname, '..');
const { name } = config.general;
// The app's id: app.id's default, which the e2e app keeps.
const id = `dev.crossbind.${name}`;
const platform = process.env.CROSSBIND_APP_PLATFORM;
const env = { CROSSBIND_APP_CONSOLE: '1' };
if (process.platform === 'win32' && !platform) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${DEVTOOLS_PORT}`;

function missing(file) {
    console.error(`FAIL: ${file} is missing - run \`pnpm build\` first.`);
    process.exit(1);
}

// The start of a 256 × 256 PNG, the largest image of a Windows app's icon.
const PNG_256 = Buffer.from('89504e470d0a1a0a0000000d494844520000010000000100', 'hex');

const has = (file, part) => existsSync(file) && (!part || readFileSync(file).includes(part));

// The build gave the app the icon app.icon names.
function checkIcon() {
    const app = `${root}/dist/${name}`;
    const checks = {
        ios: () => has(`${app}-ios/Assets.xcassets/AppIcon.appiconset/icon.png`),
        android: () => has(`${app}-android/app/src/main/res/mipmap-anydpi/ic_launcher.xml`),
        darwin: () => has(`${app}.app/Contents/Resources/icon.icns`) && has(`${app}.app/Contents/Info.plist`, '<key>CFBundleIconFile</key>'),
        linux: () => has(`${app}-linux-${process.arch}/resources/icon.png`),
        win32: () => has(`${app}-win32-${process.arch}/${name}.exe`, PNG_256),
    };
    // A platform the runner does not open is left to open() to refuse.
    const check = checks[platform ?? process.platform];
    if (check && !check()) {
        console.error(`FAIL: the ${platform ?? process.platform} app has no icon from app.icon.`);
        process.exit(1);
    }
}

// The build declared app.urlSchemes where macOS and iOS read them from the app; an Android app is opened with a link,
// and the installers' registrations are checked where they run.
function checkUrlSchemes() {
    const plist = { darwin: `${root}/dist/${name}.app/Contents/Info.plist`, ios: `${root}/dist/${name}-ios/Info.plist` }[platform ?? process.platform];
    if (plist && !(existsSync(plist) && readFileSync(plist, 'utf8').includes(`<string>${config.app.urlSchemes[0]}</string>`))) {
        console.error(`FAIL: the ${platform ?? process.platform} app declares no scheme of app.urlSchemes.`);
        process.exit(1);
    }
}

// The build gave the app app.copyright and app.category where the system shows them: a macOS app's Info.plist, a
// Windows executable's details and, once its Debian package installed it, a Linux app's menu entry.
function checkMetadata() {
    const app = `${root}/dist/${name}`;
    const checks = {
        darwin: () => has(`${app}.app/Contents/Info.plist`, '<key>NSHumanReadableCopyright</key>')
            && has(`${app}.app/Contents/Info.plist`, `<string>public.app-category.${config.app.category}</string>`),
        linux: () => !process.argv.includes('--installed') || has(`/usr/share/applications/${name}.desktop`, 'Categories=Development;'),
        win32: () => has(`${app}-win32-${process.arch}/${name}.exe`, Buffer.from(config.app.copyright, 'utf16le')),
    };
    const check = checks[platform ?? process.platform];
    if (check && !check()) {
        console.error(`FAIL: the ${platform ?? process.platform} app does not carry app.copyright and app.category where the system shows them.`);
        process.exit(1);
    }
}

// A file in a desktop app's data folder, where its host makes the folder, which src/main.js moves to the trash.
function leaveFileToTrash() {
    const folders = {
        darwin: () => join(homedir(), 'Library', 'Application Support', id),
        win32: () => join(process.env.APPDATA, id),
        linux: () => join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), id),
    };
    const folder = !platform && folders[process.platform]?.();
    if (!folder) return;
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, TRASHED_FILE), 'src/main.js moves this file to the trash');
}

async function open() {
    if (platform) {
        const project = `${root}/dist/${name}-${platform}`;
        if (!existsSync(project)) missing(project);
        const { buildForSimulator, openInSimulator, buildApk, openOnDevice } = await import('crossbind');
        return platform === 'ios' ? openInSimulator(buildForSimulator(project), { env }) : openOnDevice(buildApk(project), { env });
    }
    // A macOS app is a bundle; a Linux or Windows app a directory named after its platform and arch.
    const { executable, close } = process.argv.includes('--installed') ? installedApp() : {
        executable: process.platform === 'darwin'
            ? `${root}/dist/${name}.app/Contents/MacOS/${name}`
            : `${root}/dist/${name}-${process.platform}-${process.arch}/${name}${process.platform === 'win32' ? '.exe' : ''}`,
        close: () => {},
    };
    if (!existsSync(executable)) missing(executable);
    // The link, as Windows and Linux hand an app one, which src/main.js asks the app for.
    return { child: spawn(executable, [LAUNCH_URL], { env: { ...process.env, ...env } }), close, executable };
}

// Where the installer put the app: in the disk image, mounted until the run ends, in /usr/bin, or in the user's
// programs.
function installedApp() {
    if (process.platform === 'darwin') {
        const image = `${root}/dist/${name}.dmg`;
        if (!existsSync(image)) missing(image);
        const mount = mkdtempSync(join(tmpdir(), 'crossbind-dmg-'));
        execFileSync('hdiutil', ['attach', '-quiet', '-nobrowse', '-readonly', '-mountpoint', mount, image]);
        const executable = `${mount}/${name}.app/Contents/MacOS/${name}`;
        const close = () => execFileSync('hdiutil', ['detach', '-quiet', '-force', mount]);
        if (!existsSync(executable)) {
            close();
            missing(executable);
        }
        return { executable, close };
    }
    if (process.platform === 'win32') return { executable: join(process.env.LOCALAPPDATA, 'Programs', config.app.name ?? name, `${name}.exe`), close: () => {} };
    return { executable: `/usr/bin/${name}`, close: () => {} };
}

// A desktop app's page asks app.relaunch() once its summary is out: the app leaves with 0, and the one it opens anew,
// which is no child of the run's and which the run ends, asks for an update first.
const relaunch = { isAsked: false, hasLeft: false, hasOpened: false };
function awaitRelaunch() {
    if (relaunch.isAsked) return;
    relaunch.isAsked = true;
    setTimeout(() => finish(relaunch.hasLeft ? 'the app did not open anew after app.relaunch()' : 'the app did not quit after app.relaunch()'), RELAUNCH_TIMEOUT_MS);
}

function checkRelaunch() {
    if (relaunch.hasLeft && relaunch.hasOpened) finish();
}

// The update app.updater finds, which src/main.js installs twice: a newer version whose file its signature covers, which
// unpacks to no app, then the same version with that file changed, as one tampered with would be.
function serveUpdates() {
    const target = `${process.platform}-${process.arch}`;
    const file = Buffer.from('an update that unpacks to no app');
    const manifest = JSON.stringify({ version: '99.0.0', file: 'update.bin', signature: signUpdate(id, target, '99.0.0', file) });
    let downloads = 0;
    const server = createServer((request, response) => {
        if (request.url === `/${target}.update.json`) {
            response.end(manifest);
            // After the summary, it is the app app.relaunch() opened anew that asks.
            if (relaunch.isAsked) {
                relaunch.hasOpened = true;
                checkRelaunch();
            }
        } else if (request.url === '/update.bin') {
            downloads += 1;
            response.end(downloads === 1 ? file : Buffer.from('a tampered update'));
        } else {
            response.statusCode = 404;
            response.end();
        }
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(UPDATE_PORT, '127.0.0.1', resolve);
    });
}

// What a child of the run writes until it matches, within ASKED_TIMEOUT_MS.
function awaitOutput(child, pattern) {
    return new Promise((resolve, reject) => {
        let text = '';
        const timeout = setTimeout(() => reject(new Error(`it wrote nothing that matches ${pattern} in time`)), ASKED_TIMEOUT_MS);
        const read = (chunk) => {
            text += chunk;
            if (!pattern.test(text)) return;
            clearTimeout(timeout);
            child.stdout.off('data', read);
            resolve(text);
        };
        child.stdout.on('data', read);
        child.once('error', reject);
        child.once('exit', (code) => reject(new Error(`it exited with ${code}: ${text}`)));
    });
}

// On Linux a session bus of the run's own, on which e2e/tray-host.py plays the desktop's tray and notification server
// for the app.
async function startTrayHost() {
    if (platform || process.platform !== 'linux') return null;
    try {
        // Each goes as the run ends, however it ends.
        const bus = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1'], { stdio: ['ignore', 'pipe', 'inherit'] });
        process.once('exit', () => bus.kill());
        const address = (await awaitOutput(bus, /\n/)).trim();
        const host = spawn('python3', [join(import.meta.dirname, 'tray-host.py'), JSON.stringify({ tray: TRAY, notification: NOTIFICATION })], {
            env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address },
        });
        process.once('exit', () => host.kill());
        host.stderr.on('data', (chunk) => {
            out += `[tray host] ${chunk}`;
        });
        await awaitOutput(host, TRAY_HOST_READY);
        env.DBUS_SESSION_BUS_ADDRESS = address;
        return { bus, host };
    } catch (error) {
        console.error(`FAIL: the run's tray and notification server did not start, which needs dbus-daemon and python3 with PyGObject (apt install dbus python3-gi): ${error.message}\n${out}`);
        process.exit(1);
    }
}

let out = '';
checkIcon();
checkUrlSchemes();
checkMetadata();
leaveFileToTrash();
// A phone's app does not update itself.
if (!platform) await serveUpdates();
const trayHost = await startTrayHost();
const { child: app, close, executable } = await open();
// The adb crossbind opened the Android app with, which opens it with a link as well.
const adb = platform === 'android' ? (await import('crossbind')).adbPath() : undefined;

// The page asks for it once it listens: the app, launched again with LAUNCH_ARGS and the folder it is launched in,
// which the first app does not share, hands them to that app and leaves.
let isLaunchedAgain = false;
let hasLeft = false;
function launchAgain() {
    if (isLaunchedAgain || !executable || !LAUNCH_AGAIN.test(out)) return;
    isLaunchedAgain = true;
    try {
        const cwd = realpathSync.native(join(root, 'dist'));
        const again = spawn(executable, [...LAUNCH_ARGS, cwd], { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
        const timeout = setTimeout(() => {
            again.kill();
            finish('the app launched again did not leave');
        }, ASKED_TIMEOUT_MS);
        again.stderr.on('data', (chunk) => {
            out += `[launched again] ${chunk}`;
        });
        again.once('error', (error) => finish(`the app cannot be launched again: ${error.message}`));
        again.on('exit', (code) => {
            clearTimeout(timeout);
            if (code !== 0) finish(`the app launched again exited with ${code}, not 0`);
            hasLeft = true;
        });
    } catch (error) {
        finish(`the app cannot be launched again: ${error.message}`);
    }
}

// The page of an Android app asks for it once it listens: the system opens the app with a link, as when its user taps
// one.
let isLinkOpened = false;
function openLink() {
    if (isLinkOpened || platform !== 'android' || !OPEN_LINK.test(out)) return;
    isLinkOpened = true;
    const opened = spawnSync(adb, ['shell', `am start -W -a android.intent.action.VIEW -d '${PHONE_URL}'`], { encoding: 'utf8', timeout: ASKED_TIMEOUT_MS });
    if (opened.status !== 0) finish(`the app cannot be opened with a link: ${opened.error?.message ?? `${opened.stdout}${opened.stderr}`.trim()}`);
}

// Sends commands to the page through WebView2's DevTools, in order, and gives the last one's result. The page has the
// focus a user's click gives it.
async function devTools(...commands) {
    const signal = AbortSignal.timeout(ASKED_TIMEOUT_MS);
    const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`, { signal })).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('WebView2 lists no page');
    const sent = [{ method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }, ...commands];
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    try {
        const { error, result } = await new Promise((done, fail) => {
            signal.addEventListener('abort', () => fail(new Error('DevTools did not answer in time')));
            socket.onerror = () => fail(new Error('DevTools refused the connection'));
            socket.onopen = () => sent.forEach((command, index) => socket.send(JSON.stringify({ id: index + 1, ...command })));
            socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id === sent.length) done(message);
            };
        });
        if (error || result?.exceptionDetails) throw new Error(JSON.stringify(error ?? result.exceptionDetails));
        return result;
    } finally {
        socket.close();
    }
}

// Runs an expression in the page, after the commands given before it, as a user's click would unless userGesture is
// false, and gives its value.
async function inPage(expression, userGesture = true, ...before) {
    const { result } = await devTools(...before, { method: 'Runtime.evaluate', params: { expression, userGesture, awaitPromise: true, returnByValue: true } });
    return result.value;
}

// The page reads the clipboard on its user's click alone: a button at its corner reads it when DevTools clicks it with
// the mouse, as the page's user would, and the run waits for the read, which may come after the click's answer.
async function readClipboard() {
    const read = "navigator.clipboard.readText().then(() => 'read', (error) => error.message)";
    const mouse = (type) => ({ method: 'Input.dispatchMouseEvent', params: { type, x: 20, y: 20, button: 'left', clickCount: 1 } });
    try {
        const unclicked = await inPage(read, false);
        if (unclicked === 'read') finish("the page read the clipboard without its user's click");
        await inPage(`void (globalThis.crossbindRead = new Promise((resolve) => {
            const button = document.body.appendChild(document.createElement('button'));
            button.style.cssText = 'position: fixed; left: 0; top: 0; width: 40px; height: 40px; z-index: 2147483647';
            button.onclick = () => { resolve(${read}); button.remove(); };
            setTimeout(() => resolve('the click missed its button'), ${CLICK_TIMEOUT_MS});
        }))`, false);
        const clicked = await inPage('globalThis.crossbindRead', false, mouse('mousePressed'), mouse('mouseReleased'));
        if (clicked !== 'read') finish(`the page could not read the clipboard on its user's click: ${clicked}`);
    } catch (error) {
        finish(`the clipboard could not be checked: ${error.message}`);
    }
}

// The page asks for it on Windows once it listens: the system's sleep and wake, reads of the clipboard, then its element
// full screen, then a new scale of the screen, after which the window must cover the screen still, then the page out of
// full screen.
let isScreenFilled = false;
async function fillScreen() {
    if (isScreenFilled || !FILL_SCREEN.test(out)) return;
    isScreenFilled = true;
    try {
        execFileSync('powershell', ['-NoProfile', '-Command', SLEEP_SCRIPT.replace('APP_PID', String(app.pid))], { encoding: 'utf8', timeout: ASKED_TIMEOUT_MS });
    } catch (error) {
        finish(`the window could not be told the system sleeps and wakes: ${error.message}`);
    }
    await readClipboard();
    try {
        await inPage('document.documentElement.requestFullscreen()');
        await new Promise((done) => { setTimeout(done, SETTLE_MS); });
        const script = SCALE_SCRIPT.replace('APP_PID', String(app.pid));
        const covered = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: ASKED_TIMEOUT_MS }).trim();
        if (covered !== 'covered') finish(`after a new scale of its screen, the window that fills the screen ${covered}`);
        await inPage('document.exitFullscreen()');
    } catch (error) {
        finish(`the window full screen could not be checked: ${error.message}`);
    }
}

// The page asks for them once it shows its notification and listens: clicks of the tray's icon, of the menu's first
// item with checked and of the notification, which the tray host makes on Linux.
let isTrayClicked = false;
function clickTray() {
    if (isTrayClicked || !CLICK_TRAY.test(out)) return;
    isTrayClicked = true;
    if (trayHost) {
        trayHost.host.stdin.write('click\n');
        return;
    }
    const clicked = TRAY.menu.findIndex((item) => 'checked' in item);
    const downs = TRAY.menu.slice(0, clicked + 1).filter((item) => item.type !== 'separator').length;
    try {
        const script = TRAY_SCRIPT.replace('APP_PID', String(app.pid)).replace('DOWNS', String(downs));
        execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: ASKED_TIMEOUT_MS });
    } catch (error) {
        finish(`the tray could not be clicked: ${error.message}`);
    }
}

// The page tells it when Windows took no tray icon, which a session without Explorer, as a CI runner's may be, has no
// notification area for; with Explorer it is the app's failure.
let isAreaChecked = false;
function checkNotificationArea() {
    const refused = out.match(NO_NOTIFICATION_AREA);
    if (isAreaChecked || !refused) return;
    isAreaChecked = true;
    const shells = spawnSync('tasklist', ['/FI', 'IMAGENAME eq explorer.exe', '/NH'], { encoding: 'utf8', timeout: ASKED_TIMEOUT_MS });
    if (shells.status !== 0) finish(`the Windows session's Explorer could not be looked for: ${shells.error?.message ?? shells.stderr}`);
    else if (/explorer\.exe/i.test(shells.stdout)) finish('Windows took no tray icon while Explorer runs');
    else console.log(`note: this Windows session runs no Explorer, so its tray and notification went unclicked: ${refused[0].trim()}`);
}

function finish(problem) {
    clearTimeout(timer);
    app.kill();
    // Whatever the run found, the app app.relaunch() may have opened anew holds the app's one instance from the next.
    if (relaunch.isAsked) {
        if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/IM', `${name}.exe`]);
        else spawnSync('pkill', ['-f', `/${name}$`]);
    }
    // The disk image an app ran from detaches once the app is stopped; a failure to does not change the suite's result.
    try {
        close();
    } catch (error) {
        console.error(`warning: ${error.message}`);
    }
    const summary = out.match(CONFORMANCE);
    // A runner that trusts the key the app is signed with has the updater hold an update to that signer.
    const signer = process.env.CROSSBIND_E2E_UPDATE_SIGNER;
    // The tray took the icon away as the page asked, before the app quit to open anew.
    const removed = out.indexOf(TRAY_HOST_REMOVED);
    const failure = problem
        ?? (isLaunchedAgain && !hasLeft ? 'the app launched again had not left when the suite finished' : undefined)
        ?? (signer && summary && !out.includes(`is not signed by ${signer}`) ? `the updater did not hold the update to the app's signer, ${signer}` : undefined)
        ?? (trayHost && summary && !(removed >= 0 && removed < summary.index) ? "the tray kept the app's icon after tray.remove()" : undefined);
    if (failure || !summary) {
        console.error(`FAIL: ${failure ?? 'the app failed the conformance suite'}:\n${out}`);
        process.exit(1);
    }
    console.log(`ok: ${platform ?? `${process.platform}-${process.arch}`} app: ${summary[0]}`);
    process.exit(0);
}

const timer = setTimeout(() => finish('the suite did not finish in time'), RUN_TIMEOUT_MS);
// A desktop app that passed opens anew, which the run waits for; any other summary ends the run.
const summarized = () => (!platform && CONFORMANCE.test(out) ? awaitRelaunch() : finish());
app.stdout.on('data', (chunk) => {
    out += chunk;
    launchAgain();
    openLink();
    fillScreen();
    clickTray();
    checkNotificationArea();
    if (FINISHED.test(out)) summarized();
});
app.stderr.on('data', (chunk) => {
    out += chunk;
    launchAgain();
    openLink();
    fillScreen();
    clickTray();
    checkNotificationArea();
    if (FINISHED.test(out)) summarized();
});
trayHost?.host.stdout.on('data', (chunk) => {
    out += chunk;
    const found = out.match(TRAY_HOST_FAIL);
    if (found) finish(`the tray host found that ${found[1]}`);
});
// An app that leaves at once, having said nothing, handed its launch to another instance of it. What it wrote last may
// come after its exit.
app.on('exit', (code) => setTimeout(() => {
    if (!relaunch.isAsked) {
        finish(code === 0 && !out ? 'the app handed its launch to an instance of it that runs already: close that one' : `the app exited with ${code} before the suite finished`);
    }
    if (code !== 0) finish(`the app exited with ${code} after app.relaunch(), not 0`);
    relaunch.hasLeft = true;
    checkRelaunch();
}, EXIT_SETTLE_MS));
