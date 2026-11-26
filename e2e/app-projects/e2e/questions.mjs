import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
    mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

// The preview extension's question, as e2e/run.mjs reads and answers it: through the fixture's hooks on macOS, iOS and
// Linux, by the page the window shows; on Android from uiautomator's dump of the screen, with adb's taps and keys; on
// Windows through UI Automation from PowerShell, as the task dialog holds every answer to the window's pages until it
// closes. A question reads as { texts, buttons, preferred, focused }, null where none is up. And its store,
// preview/consents.json in the app's data folder, which the run reads and breaks: on Android through run-as.
const TOOL_MS = 30000;
const COMPILE_MS = 300000;
const DUMP_TRIES = 5;
const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

const decoded = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, name) => {
    if (name[0] !== '#') return ENTITIES[name] ?? all;
    return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
});

// Each node of the screen uiautomator dumps, as its attributes.
export function screenOf(adb) {
    for (let tries = 0; tries < DUMP_TRIES; tries += 1) {
        const { stdout = '' } = spawnSync(adb, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], { encoding: 'utf8', timeout: TOOL_MS });
        const end = stdout.lastIndexOf('</hierarchy>');
        if (end < 0) continue;
        const xml = stdout.slice(stdout.indexOf('<hierarchy'), end);
        return [...xml.matchAll(/<node\b([^>]*?)\/?>/g)].map(([, attributes]) => Object.fromEntries(
            [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decoded(value)]),
        ));
    }
    throw new Error('uiautomator dumped no screen');
}

export const centerOf = (node) => {
    const [left, top, right, bottom] = node.bounds.match(/\d+/g).map(Number);
    return [String(Math.round((left + right) / 2)), String(Math.round((top + bottom) / 2))];
};

// The app's own dialog of a title and a message, its buttons the platform's three.
function androidQuestion(nodes, applicationId) {
    const own = nodes.filter((node) => node.package === applicationId);
    const title = own.find((node) => node['resource-id'] === 'android:id/alertTitle');
    if (!title) return null;
    const message = own.find((node) => node['resource-id'] === 'android:id/message');
    const buttons = own.filter((node) => /^android:id\/button[123]$/.test(node['resource-id']));
    return {
        texts: [title.text, message?.text ?? ''], buttons: buttons.map((node) => node.text), preferred: null, focused: buttons.find((node) => node.focused === 'true')?.text ?? null, nodes: buttons,
    };
}

// A key to the app's dialog under X, which another window of the app's is transient for, focused first, as its user
// presses one: xdotool's, which the Linux run has.
function keyToLinuxDialog(title, key) {
    const listed = spawnSync('xdotool', ['search', '--onlyvisible', '--name', `^${title}$`], { encoding: 'utf8', timeout: TOOL_MS });
    const dialog = (listed.stdout ?? '').split('\n').filter(Boolean).find((window) => {
        const transient = spawnSync('xprop', ['-id', window, 'WM_TRANSIENT_FOR'], { encoding: 'utf8', timeout: TOOL_MS });
        return transient.status === 0 && transient.stdout.includes('window id');
    });
    if (!dialog) throw new Error(`no dialog titled ${title} is up for ${key}: ${listed.stderr ?? listed.error?.message ?? ''}`);
    spawnSync('xdotool', ['windowfocus', '--sync', dialog], { timeout: TOOL_MS });
    spawnSync('xdotool', ['key', key], { timeout: TOOL_MS });
}

// The system's own question for a runtime permission, and its button that gives it while the app is used.
function androidSystemQuestion(nodes) {
    const system = nodes.filter((node) => /permissioncontroller$/.test(node.package));
    if (system.length === 0) return null;
    const allow = system.find((node) => /:id\/permission_allow_(foreground_only_)?button$/.test(node['resource-id']));
    return { texts: system.map((node) => node.text).filter(Boolean), allow };
}

// A task dialog of the app's process titled with the app's name, read through UI Automation, or pressed at a button of
// its name, or sent the command Escape gives a dialog and the close of its window. UI Automation shows a task dialog's
// button as a pane of the class CCPushButton, which hosts a button window of its own: the dialog brought to the front,
// as a click on it would, the button is pressed by UI Automation's Invoke where it offers one, then, while the dialog
// stays, clicked at that window; the press says which went, or fails with what it tried. One Windows PowerShell answers
// the run's calls, a line of JSON each, as one started per call took seconds on the arm64 runner: its own types compiled
// once into a library of the system's temporary folder named by the script, it says it is ready, then answers each line.
const WINDOWS_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if (-not (Test-Path $env:CROSSBIND_E2E_TYPES)) {
Add-Type -OutputAssembly $env:CROSSBIND_E2E_TYPES -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Question {
    delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr data);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr w, StringBuilder l);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr window, bool revert);
    [DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
    [DllImport("user32.dll")] static extern uint GetMenuItemID(IntPtr menu, int at);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetMenuStringW(IntPtr menu, uint item, StringBuilder text, int most, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetSubMenu(IntPtr menu, int at);
    // The app's own window: its process's visible window that is no dialog.
    public static IntPtr AppWindow(uint process) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((window, data) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            var type = new StringBuilder(256);
            GetClassNameW(window, type, type.Capacity);
            if (owner != process || !IsWindowVisible(window) || type.ToString() == "#32770") return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
    // The command of the item of these words in a window's system menu or a submenu of it, or 0.
    public static uint Command(IntPtr window, string words) {
        return CommandIn(GetSystemMenu(window, false), words);
    }
    static uint CommandIn(IntPtr menu, string words) {
        for (int at = 0; menu != IntPtr.Zero && at < GetMenuItemCount(menu); at += 1) {
            IntPtr inner = GetSubMenu(menu, at);
            if (inner != IntPtr.Zero) {
                uint found = CommandIn(inner, words);
                if (found != 0) return found;
                continue;
            }
            var text = new StringBuilder(512);
            GetMenuStringW(menu, (uint)at, text, text.Capacity, 0x400);
            if (text.ToString().Replace("&&", "&") == words) return GetMenuItemID(menu, at);
        }
        return 0;
    }
    public static bool Gone(IntPtr dialog, int ms) {
        DateTime until = DateTime.Now.AddMilliseconds(ms);
        while (IsWindow(dialog) && IsWindowVisible(dialog)) {
            if (DateTime.Now > until) return false;
            System.Threading.Thread.Sleep(100);
        }
        return true;
    }
    public static string Front() {
        IntPtr front = GetForegroundWindow();
        uint owner;
        GetWindowThreadProcessId(front, out owner);
        var type = new StringBuilder(256);
        var text = new StringBuilder(512);
        GetClassNameW(front, type, type.Capacity);
        GetWindowTextW(front, text, text.Capacity);
        return type + " '" + text + "' of process " + owner;
    }
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
    public static IntPtr Button(IntPtr dialog, string title) {
        IntPtr found = IntPtr.Zero;
        EnumChildWindows(dialog, (window, data) => {
            var type = new StringBuilder(256);
            var text = new StringBuilder(512);
            GetClassNameW(window, type, type.Capacity);
            SendMessageW(window, 0x000D, (IntPtr)text.Capacity, text);
            if (type.ToString() != "Button" || text.ToString() != title) return true;
            found = window;
            return false;
        }, IntPtr.Zero);
        return found;
    }
}
'@
}
if (-not ('Question' -as [type])) { Add-Type -Path $env:CROSSBIND_E2E_TYPES }
# A helper that did not compile says why, where the run reads its first line.
if (-not ('Question' -as [type])) {
    [Console]::Out.WriteLine("no helper: $($Error -join ' | ')")
    [Console]::Out.Flush()
    exit 1
}
function Answer($asked) {
    if ($asked.mode -eq 'prepare') { return 'ready' }
    # The app's window: whether it takes its user's input, and an item of its system menu's command, as a click sends it.
    if ($asked.mode -eq 'input') { return [string][Question]::IsWindowEnabled([Question]::AppWindow([uint32]$asked.process)) }
    if ($asked.mode -eq 'command') {
        $main = [Question]::AppWindow([uint32]$asked.process)
        $command = [Question]::Command($main, $asked.button)
        if ($command -eq 0) { throw "the window's system menu has no item $($asked.button)" }
        [void][Question]::PostMessageW($main, 0x0112, [IntPtr][int]$command, [IntPtr]::Zero)
        return 'sent'
    }
    $dialog = [Question]::Find([uint32]$asked.process, $asked.title)
    if ($dialog -eq [IntPtr]::Zero) { return 'null' }
    $all = [System.Windows.Automation.AutomationElement]::FromHandle($dialog).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $buttons = @($all | Where-Object { $_.Current.Name -and ($_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $_.Current.ClassName -eq 'CCPushButton') })
    switch ($asked.mode) {
        'read' {
            $texts = @($all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name } | ForEach-Object { $_.Current.Name })
            $focused = @($buttons | Where-Object { $_.Current.HasKeyboardFocus } | ForEach-Object { $_.Current.Name })
            # Every element UI Automation shows of it, for the words of a failure.
            $seen = @($all | ForEach-Object { "$($_.Current.ControlType.ProgrammaticName) $($_.Current.ClassName): $($_.Current.Name)" })
            ConvertTo-Json -Compress -Depth 3 @{ texts = $texts; buttons = @($buttons | ForEach-Object { $_.Current.Name }); preferred = $null; focused = $(if ($focused.Count) { $focused[0] } else { $null }); seen = $seen }
        }
        'press' {
            $button = $buttons | Where-Object { $_.Current.Name -eq $asked.button } | Select-Object -First 1
            if (-not $button) { throw "the dialog has no button $($asked.button)" }
            $front = [Question]::Front()
            [void][Question]::SetForegroundWindow($dialog)
            $ways = @()
            $invoke = $null
            if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$invoke)) {
                $invoke.Invoke()
                $ways += 'invoked'
                if ([Question]::Gone($dialog, 2000)) { $ways -join ', then '; break }
            }
            $window = [Question]::Button($dialog, $asked.button)
            if ($window -ne [IntPtr]::Zero) {
                [void][Question]::PostMessageW($window, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
                $ways += 'clicked'
                if ([Question]::Gone($dialog, 2000)) { $ways -join ', then '; break }
            }
            throw "the dialog stayed after $(if ($ways.Count) { $ways -join ' and ' } else { 'nothing, its button offering no Invoke and having no window' }); in front before: $front; after: $([Question]::Front())"
        }
        'escape' { [void][Question]::PostMessageW($dialog, 0x0111, [IntPtr]2, [IntPtr]::Zero); 'sent' }
        'close' { [void][Question]::PostMessageW($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); 'sent' }
    }
}
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $answer = @{ value = [string]@(Answer (ConvertFrom-Json $line))[-1] }
    } catch {
        $answer = @{ error = "$_" }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress $answer))
    [Console]::Out.Flush()
}
`;

export function questionsOn({
    platform, endpoint, adb, applicationId, appPid, appTitle,
}) {
    const windowsTypes = join(tmpdir(), `crossbind-e2e-question-${createHash('sha256').update(WINDOWS_SCRIPT).digest('hex').slice(0, 16)}.dll`);
    // The run's Windows PowerShell, started by its first call; one that ran past a call's time or ended is put aside, and
    // the next call starts another.
    let powerShell = null;
    let calls = Promise.resolve();
    function startPowerShell() {
        // Windows PowerShell started from PowerShell 7, as a CI step is, would look for its modules in 7's folders.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
        const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], { env: { ...env, CROSSBIND_E2E_TYPES: windowsTypes } });
        let said = '';
        child.on('error', (error) => { said += String(error); });
        child.stdin.on('error', () => {});
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => { said += chunk; });
        const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
        // Its next line, or a failure past ms or at its end.
        async function next(ms) {
            let timer;
            const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`ran past ${ms / 1000} s`)), ms); });
            try {
                const { value, done } = await Promise.race([lines.next(), late]);
                if (done) throw new Error(`ended: ${said.trim()}`);
                return value;
            } finally {
                clearTimeout(timer);
            }
        }
        return { child, next };
    }
    function windows(mode, button = '') {
        const called = calls.then(async () => {
            try {
                if (!powerShell) {
                    powerShell = startPowerShell();
                    const ready = await powerShell.next(COMPILE_MS);
                    if (ready !== 'ready') throw new Error(`began with ${ready}`);
                }
                powerShell.child.stdin.write(`${JSON.stringify({ mode, button, process: appPid(), title: appTitle })}\n`);
                return JSON.parse(await powerShell.next(TOOL_MS));
            } catch (error) {
                powerShell?.child.kill();
                powerShell = null;
                throw new Error(`Windows PowerShell's ${mode} ${error.message}`, { cause: error });
            }
        }).then((answered) => {
            if (answered.error !== undefined) throw new Error(`Windows PowerShell's ${mode} failed: ${answered.error}`);
            return answered.value;
        });
        calls = called.catch(() => {});
        return called;
    }
    async function byPage(role, what) {
        const answered = await endpoint.step(role, what);
        if (answered.error !== undefined) throw new Error(`the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    }
    const adbShell = (...args) => spawnSync(adb(), ['shell', ...args], { encoding: 'utf8', timeout: TOOL_MS });

    return {
        // Windows' PowerShell started and its helper compiled, which an arm64 runner takes longer for than a read may.
        async prepare() {
            if (platform === 'windows') await windows('prepare');
        },
        // On Windows, read and pressed from outside, as a dialog up holds the page's answers: whether the app's window
        // takes its user's input, and an item of its system menu pressed by the command its click sends.
        windowTakesInput: async () => (await windows('input')) === 'True',
        pressMenu: (words) => windows('command', words),
        // The question up now, read by the page of this role where the hooks read it.
        async read(role) {
            if (platform === 'windows') return JSON.parse(await windows('read'));
            if (platform === 'android') return androidQuestion(screenOf(adb()), applicationId());
            return byPage(role, { do: 'question' });
        },
        // Its button of this title, the question known by its words where the hook reads them first, as on iOS. On
        // Windows, how it was pressed.
        async press(role, button, words) {
            if (platform === 'windows') return windows('press', button);
            if (platform !== 'android') {
                await byPage(role, { do: 'press', button, words });
                return;
            }
            // Android's theme draws a dialog's buttons in capitals.
            const node = androidQuestion(screenOf(adb()), applicationId())?.nodes.find((each) => each.text.toLowerCase() === button.toLowerCase());
            if (!node) throw new Error(`no question up has a button ${button}`);
            adbShell('input', 'tap', ...centerOf(node));
        },
        // The keys and closes its user may try, each a way out the question must not take, where the run can send
        // them: Escape's command on macOS, through the fixture's hook; Escape on Linux; Back and Escape on Android;
        // Escape's command and the window's close on Windows. None on iOS.
        waysOut(role) {
            const ways = {
                macos: { "Escape's command": () => byPage(role, { do: 'cancel' }) },
                linux: { Escape: () => keyToLinuxDialog(appTitle, 'Escape') },
                android: { Back: () => adbShell('input', 'keyevent', 'KEYCODE_BACK'), Escape: () => adbShell('input', 'keyevent', 'KEYCODE_ESCAPE') },
                windows: { "Escape's command": () => windows('escape'), 'the close': () => windows('close') },
            };
            return Object.entries(ways[platform] ?? {});
        },
        // A key that would press the default button: Return on Linux, Enter on Android.
        pressDefaultKey() {
            if (platform === 'linux') {
                keyToLinuxDialog(appTitle, 'Return');
                return 'Return';
            }
            if (platform === 'android') {
                adbShell('input', 'keyevent', 'KEYCODE_ENTER');
                return 'Enter';
            }
            return null;
        },
        // Android's own question for a runtime permission, which comes after the extension's: its words, or null.
        system: () => (platform === 'android' ? androidSystemQuestion(screenOf(adb())) : null),
        // What a phone's screen shows, for a failure's words: each package's texts.
        screen: () => (platform === 'android' ? screenOf(adb()).filter((node) => node.text).map((node) => `${node.package}: ${node.text}`) : []),
        allowSystem() {
            const asked = androidSystemQuestion(screenOf(adb()));
            if (!asked?.allow) throw new Error(`Android's question has no button that allows: ${JSON.stringify(asked)}`);
            adbShell('input', 'tap', ...centerOf(asked.allow));
        },
    };
}

export function storeOn({
    platform, adb, applicationId, data,
}, name = 'consents.json') {
    const file = join(data, 'preview', name);
    const shell = (command) => spawnSync(adb(), ['shell', `run-as ${applicationId()} sh -c '${command}'`], { encoding: 'utf8', timeout: TOOL_MS });
    const relative = `files/preview/${name}`;
    if (platform === 'android') {
        return {
            read() {
                const { status, stdout } = shell(`cat ${relative}`);
                try {
                    return status === 0 ? JSON.parse(stdout) : null;
                } catch {
                    return null;
                }
            },
            write: (text) => shell(`mkdir -p files/preview && rm -rf ${relative} && echo ${Buffer.from(text).toString('base64')} | base64 -d > ${relative}`),
            unreadable: () => shell(`rm -rf ${relative} && mkdir -p ${relative}`),
            // Its next write fails, a folder standing where the write goes first, and it is read as it was.
            unwritable: () => shell(`mkdir -p ${relative}.new`),
            writable: () => shell(`rm -rf ${relative}.new`),
            remove: () => shell(`rm -rf ${relative} ${relative}.new`),
        };
    }
    return {
        read() {
            try {
                return JSON.parse(readFileSync(file, 'utf8'));
            } catch {
                return null;
            }
        },
        write(text) {
            rmSync(file, { recursive: true, force: true });
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, text);
        },
        unreadable() {
            rmSync(file, { recursive: true, force: true });
            mkdirSync(file, { recursive: true });
        },
        unwritable: () => mkdirSync(`${file}.new`, { recursive: true }),
        writable: () => rmSync(`${file}.new`, { recursive: true, force: true }),
        remove() {
            for (const each of [file, `${file}.new`]) rmSync(each, { recursive: true, force: true });
        },
    };
}
