// The clipboard extension as an app's crossbind.config.js lists it: extensions: [clipboard()].
export default function clipboard() {
    return {
        name: 'clipboard',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['native/clipboard.cpp'],
            macos: { sources: ['native/darwin.mm'] },
            ios: { sources: ['native/ios.mm'] },
            linux: { sources: ['native/linux.cpp'] },
            windows: { sources: ['native/windows.cpp'] },
            android: { sources: ['native/android.cpp'], java: 'native/android', class: 'dev.crossbind.extension.clipboard.ClipboardExtension' },
        },
    };
}
