// The file e2e/run.mjs leaves in a desktop app's data folder, which src/main.js moves to the trash.
export const TRASHED_FILE = 'crossbind-trash-me';
// The link e2e/run.mjs launches a desktop app with, which src/main.js asks the app for.
export const LAUNCH_URL = 'crossbind-e2e://launch?ü=1';
// The arguments e2e/run.mjs launches a desktop app with among its links and files, then --cwd= and the folder it launches
// it in, which src/main.js checks app.launchArgs() gives without the links and files: those that start with "-", as an
// app that opens files takes each other one for a file, and a file: URL whose path holds a NUL, which names none.
export const FIRST_ARGS = ['--first', '--ünïcode=✓', 'file:///n%00ul.cbe2e'];
// The files e2e/run.mjs launches a desktop app with, by their names in the folder it launches it in: one of the app's
// type and one no type takes, which reach the page, and one of the page's once more as a file: URL, escaped and with a
// query and a fragment, and one of the probe's, its extension in capitals, which reaches it. None of them need be there.
export const FIRST_FILES = { page: ['first.cbe2e', 'first.txt'], url: 'url ü.cbe2e', probe: 'First.CbProbe' };
// The file e2e/run.mjs launches the app again with, and opens a macOS app that runs on, as Finder does.
export const AGAIN_FILE = 'again.cbe2e';
export const OPENED_FILE = 'opened.cbe2e';
// The https links e2e/run.mjs opens an Android app with after PHONE_URL, of app.links' and the probe's, and the files
// it opens the app on, which the probe's provider serves, each holding PHONE_FILE_TEXT: the page's, and the probe's
// twice, the second of its MIME type and a name without its extension; and before them the page's file of a provider
// no other app may read, which the app takes not.
export const PHONE_LINKS = { page: 'https://example.com/e2e/invite?x=1', probe: 'https://example.com/probe/invite?x=1' };
export const PHONE_FILES = { page: 'note.cbe2e', probe: 'note.cbprobe', bare: 'download', refused: 'secret.cbe2e' };
export const PHONE_FILE_TEXT = 'crossbind e2e';
// The link e2e/run.mjs opens an Android app with through adb once its page listens.
export const PHONE_URL = 'crossbind-e2e://phone?x=1';
// The arguments e2e/run.mjs launches a desktop app again with, which src/main.js checks the app that runs gets: an empty
// one, which is no file, and one beyond ASCII among them, and the last a link of the app's scheme, which reaches the page
// as open-url alone.
export const LAUNCH_ARGS = ['--from-e2e', '', '--ünïcode=✓', 'crossbind-e2e://again?ü=1'];
// The scheme of the probe extension, whose links reach the probe alone: e2e/run.mjs launches a desktop app with the first
// beside LAUNCH_URL and again with the second beside LAUNCH_ARGS, and opens an Android app with the third after PHONE_URL.
export const PROBE_SCHEME = 'crossbind-probe';
export const PROBE_URLS = { launch: `${PROBE_SCHEME}://launch?x=1`, again: `${PROBE_SCHEME}://again?x=1`, phone: `${PROBE_SCHEME}://phone?x=1` };
// The user activities the probe hands an iOS or macOS app's delegate, as Handoff does, which src/main.js checks reach
// their owners: one of app.activityTypes, the page's, one of the probe's, and one no one continues.
export const ACTIVITIES = { page: 'dev.crossbind.e2e.page-activity', probe: 'dev.crossbind.e2e.probe-activity', nobody: 'dev.crossbind.e2e.no-activity' };
// The quick actions of a phone app's icon, whose taps the probe makes as the system does, which src/main.js checks reach
// their owners: one of app.shortcutItems, the page's, one of the probe's, and one no one owns.
export const SHORTCUTS = { page: 'dev.crossbind.e2e.new-note', probe: 'dev.crossbind.e2e.probe-action', nobody: 'dev.crossbind.e2e.no-action' };
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
