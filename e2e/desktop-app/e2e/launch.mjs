// The file e2e/run.mjs leaves in a desktop app's data folder, which src/main.js moves to the trash.
export const TRASHED_FILE = 'crossbind-trash-me';
// The link e2e/run.mjs launches a desktop app with, which src/main.js asks the app for.
export const LAUNCH_URL = 'crossbind-e2e://launch?ü=1';
// The link e2e/run.mjs opens an Android app with through adb once its page listens.
export const PHONE_URL = 'crossbind-e2e://phone?x=1';
// The arguments e2e/run.mjs launches a desktop app again with, which src/main.js checks the app that runs gets: an empty
// one and one beyond ASCII among them, and the last a link of the app's scheme, which reaches the page as open-url alone.
export const LAUNCH_ARGS = ['--from-e2e', '', 'ünïcode ✓', 'crossbind-e2e://again?ü=1'];
// The scheme of the probe extension, whose links reach the probe alone: e2e/run.mjs launches a desktop app with the first
// beside LAUNCH_URL and again with the second beside LAUNCH_ARGS, and opens an Android app with the third after PHONE_URL.
export const PROBE_SCHEME = 'crossbind-probe';
export const PROBE_URLS = { launch: `${PROBE_SCHEME}://launch?x=1`, again: `${PROBE_SCHEME}://again?x=1`, phone: `${PROBE_SCHEME}://phone?x=1` };
// The tray src/main.js sets and the notification it shows, whose clicks e2e/run.mjs makes: the icon's, the first item's
// with checked, and the notification's. A Linux tray shows each label's underscore, and its server the body's markup.
export const TRAY = {
    tooltip: 'crossbind e2e',
    menu: [
        { label: 'Show', id: 'show' },
        { label: 'Pinned', id: 'pinned', checked: false },
        { type: 'separator' },
        { label: 'More', items: [{ label: 'Snake_case', id: 'snake', enabled: false }] },
    ],
};
export const NOTIFICATION = { title: 'crossbind e2e', body: 'Saved & done <now>' };
