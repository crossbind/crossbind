import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import config from '../crossbind.config.mjs';
import { STEPS } from './steps.mjs';

// Opens the app `pnpm build` made, whose page opens STEPS' dialogs through the host's own page-dialogs, and answers each
// as the app's user would: on Linux under X with xdotool, and on Windows with the messages a dialog's buttons and text box
// take. A dialog is found by the app's name, which it shows. The page then logs what it got.
const RUN_TIMEOUT_MS = 180000;
// How long a dialog takes to show: the first comes once the app has opened and, on Windows, PowerShell has compiled.
const DIALOG_TIMEOUT_MS = 60000;
const TOOL_TIMEOUT_MS = 10000;
const POLL_MS = 200;
const RESULT = /^RESULT (.*)$/m;

const name = config.general.name;
const title = config.app.name;
const appDir = join(import.meta.dirname, '..', 'dist', `${name}-${process.platform}-${process.arch}`);
const executable = join(appDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`);

const sleep = (ms) => new Promise((done) => { setTimeout(done, ms); });

async function until(find, what) {
    const deadline = Date.now() + DIALOG_TIMEOUT_MS;
    for (;;) {
        const found = find();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} never came`);
        await sleep(POLL_MS);
    }
}

const tool = (program, args) => execFileSync(program, args, { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS });

// The app's dialogs: its visible windows of its name that another window of the app's is transient for. One that closes
// between the search and the look at it, as an answered dialog does, is none.
function linuxDialogs() {
    const listed = spawnSync('xdotool', ['search', '--onlyvisible', '--name', `^${title}$`], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS });
    return (listed.stdout ?? '').split('\n').filter(Boolean).filter((window) => {
        const transient = spawnSync('xprop', ['-id', window, 'WM_TRANSIENT_FOR'], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS });
        return transient.status === 0 && transient.stdout.includes('window id');
    });
}

async function answerOnLinux() {
    for (const program of ['xdotool', 'xprop']) {
        if (spawnSync(program, ['-version']).error) throw new Error(`${program} is not installed: apt-get install xdotool x11-utils`);
    }
    for (const step of STEPS) {
        const [dialog] = await until(() => {
            const dialogs = linuxDialogs();
            return dialogs.length > 0 && dialogs;
        }, `a dialog titled ${title} for the page's ${step.ask}()`);
        tool('xdotool', ['windowfocus', '--sync', dialog]);
        const keys = {
            ok: [['key', 'Return']],
            cancel: [['key', 'Escape']],
            type: [['key', 'ctrl+a'], ['type', step.typed], ['key', 'Return']],
        }[step.answer];
        for (const args of keys) tool('xdotool', args);
        await until(() => !linuxDialogs().includes(dialog), `the close of the page's ${step.ask}() dialog`);
    }
}

// A task dialog's button is clicked through TDM_CLICK_BUTTON; a prompt takes its text through WM_SETTEXT and its button
// through WM_COMMAND, as its controls would from its user.
const WINDOWS_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PageDialogs {
    delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string type, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr w, string l);
    [DllImport("user32.dll")] static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr w, IntPtr l);
    public static IntPtr Find(uint process, string title) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, data) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            var type = new StringBuilder(256);
            var text = new StringBuilder(512);
            GetClassNameW(window, type, type.Capacity);
            GetWindowTextW(window, text, text.Capacity);
            if (owner != process || !IsWindowVisible(window) || type.ToString() != "#32770" || text.ToString() != title) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
    public static void Answer(IntPtr dialog, string answer, string typed) {
        IntPtr button = (IntPtr)(answer == "cancel" ? 2 : 1);
        IntPtr text = FindWindowExW(dialog, IntPtr.Zero, "Edit", null);
        if (text == IntPtr.Zero) {
            SendMessageW(dialog, 0x0400 + 102, button, IntPtr.Zero);
            return;
        }
        if (answer == "type") SendMessageW(text, 0x000C, IntPtr.Zero, typed);
        SendMessageW(dialog, 0x0111, button, IntPtr.Zero);
    }
}
'@
$process = [uint32]$env:CROSSBIND_E2E_PID
foreach ($step in ($env:CROSSBIND_E2E_STEPS | ConvertFrom-Json)) {
    $deadline = (Get-Date).AddMilliseconds(${DIALOG_TIMEOUT_MS})
    while (($dialog = [PageDialogs]::Find($process, $env:CROSSBIND_E2E_TITLE)) -eq [IntPtr]::Zero) {
        if ((Get-Date) -gt $deadline) { throw "a dialog titled $env:CROSSBIND_E2E_TITLE for the page's $($step.ask)() never came" }
        Start-Sleep -Milliseconds ${POLL_MS}
    }
    [PageDialogs]::Answer($dialog, $step.answer, [string]$step.typed)
    while ([PageDialogs]::IsWindow($dialog)) { Start-Sleep -Milliseconds ${POLL_MS} }
}
`;

async function answerOnWindows(pid) {
    // Windows PowerShell started from PowerShell 7, as a CI step is, would look for its modules in 7's folders.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
        env: { ...env, CROSSBIND_E2E_PID: String(pid), CROSSBIND_E2E_TITLE: title, CROSSBIND_E2E_STEPS: JSON.stringify(STEPS) },
        timeout: RUN_TIMEOUT_MS,
    });
}

if (!['linux', 'win32'].includes(process.platform)) {
    console.error('FAIL: e2e/run.mjs answers the dialogs of a Linux or a Windows app alone.');
    process.exit(1);
}
if (!existsSync(executable)) {
    console.error(`FAIL: ${executable} is missing: run \`pnpm build\` first.`);
    process.exit(1);
}
// The page's console reaches the app's output with CROSSBIND_APP_CONSOLE alone.
const app = spawn(executable, [], { env: { ...process.env, CROSSBIND_APP_CONSOLE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
app.stdout.on('data', (chunk) => { out += chunk; });
app.stderr.on('data', (chunk) => { out += chunk; });
const exited = new Promise((done) => {
    app.on('exit', (code) => done({ failure: `the app exited with ${code} before its page logged what it got` }));
});
function finish(failure) {
    app.kill();
    if (!failure) return;
    console.error(`FAIL: ${failure}\n${out}`);
    process.exit(1);
}
const answered = (process.platform === 'win32' ? answerOnWindows(app.pid) : answerOnLinux()).then(() => ({}), (error) => ({ failure: error.message }));
const { failure } = await Promise.race([answered, exited]);
if (failure) finish(failure);
const logged = until(() => out.match(RESULT)?.[1], "the page's RESULT line").then((line) => ({ line }), (error) => ({ failure: error.message }));
const result = await Promise.race([logged, exited]);
if (result.failure) finish(result.failure);
const { got, notification } = JSON.parse(result.line);
const expected = STEPS.map((step) => step.expected);
if (JSON.stringify(got) !== JSON.stringify(expected)) finish(`the page got ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`);
if (notification !== 'denied') finish(`the page's notification permission is ${notification}, not denied`);
finish();
console.log(`ok: ${process.platform}-${process.arch} page requests: ${STEPS.length} dialogs answered, notifications denied`);
process.exit(0);
