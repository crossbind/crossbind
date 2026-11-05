// The e2e app's page-dialogs, which takes the host's place and answers the page's dialogs at once for src/main.js to
// check.
export default function pageDialogs() {
    const native = { sources: ['dialogs.cpp'] };
    return {
        name: 'e2e-page-dialogs',
        contract: 1,
        replaces: 'page-dialogs',
        root: import.meta.dirname,
        app: {
            macos: native,
            ios: native,
            linux: native,
            windows: native,
            android: { java: 'android', class: 'dev.crossbind.e2e.pagedialogs.PageDialogsExtension' },
        },
    };
}
