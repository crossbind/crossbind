import { execFile, spawnSync } from 'node:child_process';
import {
    existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

// The preview extension's question, as e2e/run.mjs reads and answers it: through the fixture's hooks on macOS, iOS and
// Linux, by the page the window shows; on Android from uiautomator's dump of the screen, with adb's taps and keys; on
// Windows through UI Automation from PowerShell, as the task dialog holds every answer to the window's pages until it
// closes. A question reads as { texts, buttons, preferred, focused }, null where none is up. And its store,
// preview/consents.json in the app's data folder, which the run reads and breaks: on Android through run-as.
const TOOL_MS = 30000;
const DUMP_TRIES = 5;
const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

const decoded = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, name) => {
    if (name[0] !== '#') return ENTITIES[name] ?? all;
    return String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
});

// Each node of the screen uiautomator dumps, as its attributes.
function screenOf(adb) {
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

const centerOf = (node) => {
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
// its name, or sent the command Escape gives a dialog and the close of its window.
const WINDOWS_SCRIPT = String.raw`
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class Question {
    delegate bool EnumProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr window, StringBuilder text, int size);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr w, IntPtr l);
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
}
'@
$dialog = [Question]::Find([uint32]$env:CROSSBIND_E2E_PID, $env:CROSSBIND_E2E_TITLE)
if ($dialog -eq [IntPtr]::Zero) { 'null'; exit }
$all = [System.Windows.Automation.AutomationElement]::FromHandle($dialog).FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
$buttons = @($all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.Name })
switch ($env:CROSSBIND_E2E_MODE) {
    'read' {
        $texts = @($all | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and $_.Current.Name } | ForEach-Object { $_.Current.Name })
        $focused = @($buttons | Where-Object { $_.Current.HasKeyboardFocus } | ForEach-Object { $_.Current.Name })
        ConvertTo-Json -Compress -Depth 3 @{ texts = $texts; buttons = @($buttons | ForEach-Object { $_.Current.Name }); preferred = $null; focused = $(if ($focused.Count) { $focused[0] } else { $null }) }
    }
    'press' {
        $button = $buttons | Where-Object { $_.Current.Name -eq $env:CROSSBIND_E2E_BUTTON } | Select-Object -First 1
        if (-not $button) { throw "the dialog has no button $env:CROSSBIND_E2E_BUTTON" }
        $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
        'pressed'
    }
    'escape' { [void][Question]::PostMessageW($dialog, 0x0111, [IntPtr]2, [IntPtr]::Zero); 'sent' }
    'close' { [void][Question]::PostMessageW($dialog, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero); 'sent' }
}
`;

export function questionsOn({
    platform, endpoint, adb, applicationId, appPid, appTitle,
}) {
    async function windows(mode, button = '') {
        // Windows PowerShell started from PowerShell 7, as a CI step is, would look for its modules in 7's folders.
        const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
        const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], {
            env: {
                ...env, CROSSBIND_E2E_PID: String(appPid()), CROSSBIND_E2E_TITLE: appTitle, CROSSBIND_E2E_MODE: mode, CROSSBIND_E2E_BUTTON: button,
            },
            timeout: TOOL_MS,
        });
        return stdout.trim();
    }
    async function byPage(role, what) {
        const answered = await endpoint.step(role, what);
        if (answered.error !== undefined) throw new Error(`the ${role}'s page's ${what.do}: ${answered.error}`);
        return answered.value;
    }
    const adbShell = (...args) => spawnSync(adb(), ['shell', ...args], { encoding: 'utf8', timeout: TOOL_MS });

    return {
        // The question up now, read by the page of this role where the hooks read it.
        async read(role) {
            if (platform === 'windows') return JSON.parse(await windows('read'));
            if (platform === 'android') return androidQuestion(screenOf(adb()), applicationId());
            return byPage(role, { do: 'question' });
        },
        // Its button of this title, the question known by its words where the hook reads them first, as on iOS.
        async press(role, button, words) {
            if (platform === 'windows') {
                await windows('press', button);
                return;
            }
            if (platform !== 'android') {
                await byPage(role, { do: 'press', button, words });
                return;
            }
            const node = androidQuestion(screenOf(adb()), applicationId())?.nodes.find((each) => each.text === button);
            if (!node) throw new Error(`no question up has a button ${button}`);
            adbShell('input', 'tap', ...centerOf(node));
        },
        // The keys and closes its user may try, each a way out the question must not take, where the run can send
        // them: Escape on macOS, through the fixture's hook, and on Linux; Back and Escape on Android; Escape's command
        // and the window's close on Windows. None on iOS.
        waysOut(role) {
            const ways = {
                macos: { Escape: () => byPage(role, { do: 'key', key: 'Escape' }) },
                linux: { Escape: () => keyToLinuxDialog(appTitle, 'Escape') },
                android: { Back: () => adbShell('input', 'keyevent', 'KEYCODE_BACK'), Escape: () => adbShell('input', 'keyevent', 'KEYCODE_ESCAPE') },
                windows: { "Escape's command": () => windows('escape'), 'the close': () => windows('close') },
            };
            return Object.entries(ways[platform] ?? {});
        },
        // A key that would press the default button, as it comes up: Return on macOS and Linux, Enter on Android.
        async pressDefaultKey(role) {
            if (platform === 'macos') {
                await byPage(role, { do: 'key', key: 'Return' });
                return 'Return';
            }
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
}) {
    const file = join(data, 'preview', 'consents.json');
    const shell = (command) => spawnSync(adb(), ['shell', `run-as ${applicationId()} sh -c '${command}'`], { encoding: 'utf8', timeout: TOOL_MS });
    const relative = 'files/preview/consents.json';
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
            remove: () => shell(`rm -rf ${relative}`),
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
        remove: () => existsSync(file) && rmSync(file, { recursive: true, force: true }),
    };
}
