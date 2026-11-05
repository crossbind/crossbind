// The e2e app's page-dialogs, in place of the host's, which answers the page's dialogs at once for src/main.js to check.
export default function pageDialogs() {
    const native = { sources: ['dialogs.cpp'] };
    return {
        name: 'page-dialogs',
        contract: 1,
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
