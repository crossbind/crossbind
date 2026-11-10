export default function dialog() {
    return {
        name: 'dialog',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['native/dialog.cpp'],
            macos: { sources: ['native/darwin.mm'], frameworks: ['UniformTypeIdentifiers'] },
            ios: { sources: ['native/ios.mm'], frameworks: ['UniformTypeIdentifiers'] },
            linux: { sources: ['native/linux.cpp'] },
            windows: { sources: ['native/windows.cpp'], libraries: ['comctl32'] },
            android: { sources: ['native/android.cpp'], java: 'native/android', class: 'dev.crossbind.extension.dialog.DialogExtension' },
        },
    };
}
