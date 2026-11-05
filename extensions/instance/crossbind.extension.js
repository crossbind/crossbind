export default function instance() {
    return {
        name: 'instance',
        contract: 1,
        root: import.meta.dirname,
        reads: ['singleInstance'],
        fromApp(api) {
            if (!['macos', 'linux', 'windows'].includes(api.platform)) return null;
            // Windows and Linux start the app again for a link or a file; macOS hands them to the app that runs.
            const startsAgain = api.platform !== 'macos' && (api.app.urlSchemes.length > 0 || api.app.fileTypes.length > 0);
            const singleInstance = api.config.app.singleInstance ?? startsAgain;
            if (typeof singleInstance !== 'boolean') {
                throw new Error(`crossbind: app.singleInstance ${JSON.stringify(singleInstance)} is no boolean: set it to true to keep a desktop app to one instance, or to false to let each launch run.`);
            }
            // The app's id names the instance.
            return singleInstance ? { id: api.app.id } : null;
        },
        app: {
            sources: ['native/instance.cpp'],
            macos: { sources: ['native/posix.cpp'] },
            linux: { sources: ['native/posix.cpp'] },
            windows: { sources: ['native/windows.cpp'] },
        },
    };
}
