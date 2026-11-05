// What app.openPath can let the page's shell.openPath open: the app's folders as app.paths() names them, and what a
// dialog picked during this run.
const OPEN_PATH_PLACES = ['data', 'cache', 'logs', 'picked'];

// Where the page's shell.openPath opens a file: nowhere unless app.openPath lists it, as opening a program runs it.
function checkedOpenPath(places) {
    if (!Array.isArray(places)) {
        throw new Error(`crossbind: app.openPath ${JSON.stringify(places)} is no list of ${OPEN_PATH_PLACES.join(', ')}, as ['logs', 'picked'] is.`);
    }
    const unknown = places.filter((place) => !OPEN_PATH_PLACES.includes(place));
    if (unknown.length > 0) {
        throw new Error(`crossbind: app.openPath takes ${OPEN_PATH_PLACES.join(', ')}; ${unknown.map((place) => JSON.stringify(place)).join(', ')} is none of them.`);
    }
    return [...places];
}

export default function shell() {
    return {
        name: 'shell',
        contract: 1,
        root: import.meta.dirname,
        reads: ['openPath'],
        fromApp: (api) => ({ openPath: checkedOpenPath(api.config.app.openPath ?? []) }),
        app: {
            sources: ['native/shell.cpp'],
            macos: { sources: ['native/darwin.mm'] },
            ios: { sources: ['native/ios.mm'] },
            linux: { sources: ['native/linux.cpp'] },
            windows: { sources: ['native/windows.cpp'], libraries: ['shell32', 'ole32'] },
            android: { sources: ['native/android.cpp'] },
        },
    };
}
