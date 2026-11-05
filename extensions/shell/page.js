import { invoke } from 'crossbind/app/core';

// Opening an address or a file outside the app, as a page calls it.
function checkedPath(name, path) {
    if (typeof path !== 'string' || !path) throw new TypeError(`crossbind: ${name} takes a path.`);
    return { path };
}

export const shell = {
    // An http, https or mailto address in the default browser or mail app.
    openExternal: async (url) => {
        if (typeof url !== 'string' && !(url instanceof URL)) throw new TypeError('crossbind: shell.openExternal takes an address.');
        return invoke('shell.openExternal', { url: String(url) });
    },
    // A file in the app the system opens its kind with. Opening a program runs it, and a script in the page could ask for
    // any path, so the host opens files where app.openPath in crossbind.config.js lets it alone; native code opens any.
    openPath: async (path) => invoke('shell.openPath', checkedPath('shell.openPath', path)),
    // A file, selected, in the system's file manager: one in the app's folders, or one a dialog picked during this run.
    revealInFolder: async (path) => invoke('shell.revealInFolder', checkedPath('shell.revealInFolder', path)),
    // A file or folder moved to the system's trash, where its user can take it back: one in the app's folders, not one of
    // them itself, or one a dialog picked during this run. Where the system has no trash, nothing moves.
    trash: async (path) => invoke('shell.trash', checkedPath('shell.trash', path)),
};

