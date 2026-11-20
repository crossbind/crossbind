// The page's crossbind.js in an app: initNative() resolves to the module the app's host runs, with the contract of a
// worker-backed web build.
import {
    callApp, listenForClient, on, token, transport,
} from './channel.js';
import { connect } from './lean-client.js';

let booted = null;

function initNative(config = {}) {
    if (!booted) {
        booted = token
            ? Promise.resolve(transport).then((chosen) => connect({ ...chosen, listen: listenForClient }, config.env))
            : Promise.reject(new Error("crossbind: only the top frame of an app's own page reaches the app's module"));
    }
    return booted;
}

initNative.terminate = () => {
    booted = null;
};

// An element with data-crossbind-drag moves its window as a title bar does, a double click toggling its size, unless the
// press is on what takes it, as a button or a field, or within an element of data-crossbind-drag="false". A platform
// without such windows refuses, and nothing comes of it.
const TAKES_PRESS = 'button, a[href], input, select, textarea, label, [contenteditable=""], [contenteditable="true"]';
if (token && typeof addEventListener === 'function') {
    addEventListener('mousedown', (event) => {
        if (event.button !== 0 || !(event.target instanceof Element)) return;
        const region = event.target.closest('[data-crossbind-drag]');
        if (!region || region.dataset.crossbindDrag === 'false') return;
        const taker = event.target.closest(TAKES_PRESS);
        if (taker && region.contains(taker)) return;
        event.preventDefault();
        callApp(event.detail === 2 ? 'windows.toggleMaximize' : 'windows.startDrag', {}).catch(() => {});
    }, true);
}

// takesMessages: the third argument of crossbind/app's invoke() reaches the host.
globalThis.Crossbind = {
    initNative, app: callApp, on, takesMessages: true,
};
