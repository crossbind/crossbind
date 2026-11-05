export default {
    general: {
        name: 'crossbind-e2e-app-page-requests',
    },
    target: {
        runtimeEnv: 'app',
    },
    // The host's own page-dialogs and page-permissions, whose dialogs show this name, which e2e/run.mjs finds them by.
    app: {
        name: 'crossbind page requests',
        // e2e/run.mjs opens the app from its folder, which an installer would only add to.
        installers: [],
    },
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};
