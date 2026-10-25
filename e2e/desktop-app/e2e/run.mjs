import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import config from '../crossbind.config.mjs';
import { LAUNCH_ARGS, LAUNCH_URL, PHONE_URL } from './launch.mjs';
import { UPDATE_PORT, signUpdate } from './updates.mjs';

// Opens the app `pnpm build` made, whose page runs the conformance suite and logs its summary last, and closes it
// once the summary is in. With CROSSBIND_APP_PLATFORM=ios the app is an Xcode project, built and opened in the Simulator,
// and with android a Gradle project, built and opened on the attached device. With --installed a desktop app opens
// from where its installer put it: from its disk image on macOS, and on Linux and Windows from where its Debian package
// or setup program, which the runner ran first, installed it.
const RUN_TIMEOUT_MS = 300000;
// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const CONFORMANCE = /^CONFORMANCE (\d+)\/\1\b.*$/m;
const FINISHED = /^(CONFORMANCE .*|CONFORMANCE ERR: .*)$/m;
const LAUNCH_AGAIN = /^LAUNCH AGAIN$/m;
const OPEN_LINK = /^OPEN LINK$/m;
const FILL_SCREEN = /^FILL SCREEN$/m;
// Below the page's wait for the launch or the link, so a launch that stays or an adb that hangs says so.
const ASKED_TIMEOUT_MS = 20000;
// WebView2's DevTools, through which the run does on Windows what only a user's click could.
const DEVTOOLS_PORT = 9223;
// How long a window takes to fill the screen once the page asks.
const SETTLE_MS = 1000;
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

const root = resolve(import.meta.dirname, '..');
const { name } = config.general;
const platform = process.env.CROSSBIND_APP_PLATFORM;
const env = { CROSSBIND_APP_CONSOLE: '1' };
if (process.platform === 'win32' && !platform) env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-port=${DEVTOOLS_PORT}`;

function missing(file) {
    console.error(`FAIL: ${file} is missing - run \`pnpm build\` first.`);
    process.exit(1);
}

// The start of a 256 × 256 PNG, the largest image of a Windows app's icon.
const PNG_256 = Buffer.from('89504e470d0a1a0a0000000d494844520000010000000100', 'hex');

// The build gave the app the icon app.icon names.
function checkIcon() {
    const app = `${root}/dist/${name}`;
    const has = (file, part) => existsSync(file) && (!part || readFileSync(file).includes(part));
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

// The update app.updater finds, which src/main.js installs twice: a newer version whose file its signature covers, which
// unpacks to no app, then the same version with that file changed, as one tampered with would be.
function serveUpdates() {
    const target = `${process.platform}-${process.arch}`;
    const file = Buffer.from('an update that unpacks to no app');
    // The app's id: app.id's default, which the e2e app keeps.
    const id = `dev.crossbind.${name}`;
    const manifest = JSON.stringify({ version: '99.0.0', file: 'update.bin', signature: signUpdate(id, target, '99.0.0', file) });
    let downloads = 0;
    const server = createServer((request, response) => {
        if (request.url === `/${target}.update.json`) {
            response.end(manifest);
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

let out = '';
checkIcon();
checkUrlSchemes();
// A phone's app does not update itself.
if (!platform) await serveUpdates();
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

// Runs an expression in the page through WebView2's DevTools, as a user's click would unless userGesture is false, and
// gives its value. The page has the focus a click gives it.
async function inPage(expression, userGesture = true) {
    const signal = AbortSignal.timeout(ASKED_TIMEOUT_MS);
    const targets = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`, { signal })).json();
    const page = targets.find((target) => target.type === 'page');
    if (!page) throw new Error('WebView2 lists no page');
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    try {
        const { error, result } = await new Promise((done, fail) => {
            signal.addEventListener('abort', () => fail(new Error('DevTools did not answer in time')));
            socket.onerror = () => fail(new Error('DevTools refused the connection'));
            socket.onopen = () => {
                socket.send(JSON.stringify({ id: 1, method: 'Emulation.setFocusEmulationEnabled', params: { enabled: true } }));
                socket.send(JSON.stringify({ id: 2, method: 'Runtime.evaluate', params: { expression, userGesture, awaitPromise: true, returnByValue: true } }));
            };
            socket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.id === 2) done(message);
            };
        });
        if (error || result?.exceptionDetails) throw new Error(JSON.stringify(error ?? result.exceptionDetails));
        return result.result.value;
    } finally {
        socket.close();
    }
}

// The page reads the clipboard on its user's click alone.
async function readClipboard() {
    const read = "navigator.clipboard.readText().then(() => 'read', (error) => error.message)";
    try {
        const unclicked = await inPage(read, false);
        if (unclicked === 'read') finish("the page read the clipboard without its user's click");
        const clicked = await inPage(read);
        if (clicked !== 'read') finish(`the page could not read the clipboard on its user's click: ${clicked}`);
    } catch (error) {
        finish(`the clipboard could not be checked: ${error.message}`);
    }
}

// The page asks for it on Windows once it listens: reads of the clipboard, then its element full screen, then a new
// scale of the screen, after which the window must cover the screen still, then the page out of full screen.
let isScreenFilled = false;
async function fillScreen() {
    if (isScreenFilled || !FILL_SCREEN.test(out)) return;
    isScreenFilled = true;
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

function finish(problem) {
    clearTimeout(timer);
    app.kill();
    // The disk image an app ran from detaches once the app is stopped; a failure to does not change the suite's result.
    try {
        close();
    } catch (error) {
        console.error(`warning: ${error.message}`);
    }
    const summary = out.match(CONFORMANCE);
    // A runner that trusts the key the app is signed with has the updater hold an update to that signer.
    const signer = process.env.CROSSBIND_E2E_UPDATE_SIGNER;
    const failure = problem
        ?? (isLaunchedAgain && !hasLeft ? 'the app launched again had not left when the suite finished' : undefined)
        ?? (signer && summary && !out.includes(`is not signed by ${signer}`) ? `the updater did not hold the update to the app's signer, ${signer}` : undefined);
    if (failure || !summary) {
        console.error(`FAIL: ${failure ?? 'the app failed the conformance suite'}:\n${out}`);
        process.exit(1);
    }
    console.log(`ok: ${platform ?? `${process.platform}-${process.arch}`} app: ${summary[0]}`);
    process.exit(0);
}

const timer = setTimeout(() => finish('the suite did not finish in time'), RUN_TIMEOUT_MS);
app.stdout.on('data', (chunk) => {
    out += chunk;
    launchAgain();
    openLink();
    fillScreen();
    if (FINISHED.test(out)) finish();
});
app.stderr.on('data', (chunk) => {
    out += chunk;
    launchAgain();
    openLink();
    fillScreen();
    if (FINISHED.test(out)) finish();
});
// An app that leaves at once, having said nothing, handed its launch to another instance of it.
app.on('exit', (code) => finish(code === 0 && !out ? 'the app handed its launch to an instance of it that runs already: close that one' : `the app exited with ${code} before the suite finished`));
