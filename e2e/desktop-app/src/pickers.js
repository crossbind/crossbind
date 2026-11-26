// macOS: the host's open panel, a sheet of the window of a page of a served origin, closes as the page goes: two windows
// of one origin, each with its panel up, as the origin ends, and a window that closes with its panel up. After each, no
// panel is on a window, on the screen or modal to the app, and a file input clicked on the page that came shows one
// again. A window of the check goes to the served page its URL names, and does nothing once the origin's end gives it
// the app's first page.
import { invoke, windows } from 'crossbind/app';

const PICKER = 'e2e-picker';
const PICKER_PAGE = 'page-picker.html';
const WINDOW_KEY = 'e2e-picker-window';
const POLL_MS = 100;
const SHOWN_MS = 15000;

export const isPickerWindow = () => new URLSearchParams(location.search).get('window') === 'picker' || sessionStorage.getItem(WINDOW_KEY) !== null;

export function runPickerWindow() {
    sessionStorage.setItem(WINDOW_KEY, 'picker');
    const to = new URLSearchParams(location.search).get('to');
    if (to) location.href = to;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// What the probe reads of the windows until it holds what is asked, naming what it read last.
async function until(holds, what) {
    let state;
    for (const deadline = Date.now() + SHOWN_MS; Date.now() < deadline; await sleep(POLL_MS)) {
        state = await invoke('probe.pickers');
        if (holds(state)) return state;
    }
    throw new Error(`${what}: ${JSON.stringify(state)}`);
}

const panelsOf = (state, ids) => state.windows.filter(({ id }) => ids.includes(id)).reduce((sum, { panels }) => sum + panels, 0);
const isClear = (state) => state.windows.every(({ panels }) => panels === 0) && state.visible === 0 && !state.modal;
const shows = (state, ids, origin) => ids.every((id) => state.windows.find((window) => window.id === id)?.url.startsWith(origin));

async function openShowing(page) {
    const { id } = await windows.open({ path: `/?window=picker&to=${encodeURIComponent(page)}` });
    await until((state) => shows(state, [id], new URL(page).origin), `the window ${id} did not show ${page}`);
    return id;
}

async function pagePicker() {
    return new URL(PICKER_PAGE, await invoke('probe.serveOrigin', { name: PICKER })).href;
}

export async function checkPickers() {
    const page = await pagePicker();
    const both = [await openShowing(page), await openShowing(page)];
    for (const id of both) await invoke('probe.clickFile', { window: id });
    await until((state) => panelsOf(state, both) === 2, "the two windows' panels did not come up");
    await invoke('probe.endOrigin', { name: PICKER });
    await until((state) => shows(state, both, location.origin), "the two windows did not show the app's first page once their origin ended");
    const ended = await until(isClear, 'a panel stayed as its origin ended');
    await invoke('probe.clickFile', { window: both[1] });
    await until((state) => panelsOf(state, [both[1]]) === 1, 'a file input clicked on the page that came showed no panel');
    await invoke('probe.dismissPickers');
    for (const id of both) await windows.close(id);
    const closing = await openShowing(await pagePicker());
    await invoke('probe.clickFile', { window: closing });
    await until((state) => panelsOf(state, [closing]) === 1, "the panel of the window to close did not come up");
    await windows.close(closing);
    const closed = await until(isClear, 'a panel stayed as its window closed');
    await invoke('probe.endOrigin', { name: PICKER });
    return { ended: { visible: ended.visible, modal: ended.modal }, closed: { visible: closed.visible, modal: closed.modal } };
}
