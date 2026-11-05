// The e2e app's page-dialogs, in place of the host's, which answers the page's dialogs at once for src/main.js to check.
export default function pageDialogs() {
    const native = { sources: ['dialogs.cpp'] };
    return {
        name: 'page-dialogs',
        root: import.meta.dirname,
        app: {
            darwin: native,
            ios: native,
            linux: native,
            win32: native,
            android: { java: 'android', class: 'dev.crossbind.e2e.pagedialogs.PageDialogsExtension' },
        },
    };
}
