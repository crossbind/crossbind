export default function pageDialogs() {
    return {
        name: 'page-dialogs',
        contract: 1,
        root: import.meta.dirname,
        app: {
            macos: { sources: ['native/dialogs.cpp', 'native/darwin.mm'] },
            ios: { sources: ['native/dialogs.cpp', 'native/ios.mm'] },
            linux: { sources: ['native/dialogs.cpp', 'native/linux.cpp'] },
            windows: { sources: ['native/dialogs.cpp', 'native/windows.cpp'], libraries: ['comctl32'] },
            android: { java: 'native/android', class: 'dev.crossbind.extension.pagedialogs.PageDialogsExtension' },
        },
    };
}
