export default function pageFeel() {
    return {
        name: 'page-feel',
        contract: 1,
        root: import.meta.dirname,
        app: {
            sources: ['native/feel.cpp'],
            macos: { sources: ['native/apple.mm'] },
            ios: { sources: ['native/apple.mm'] },
            linux: { sources: ['native/linux.cpp'] },
            windows: { sources: ['native/windows.cpp'] },
            android: { java: 'native/android', class: 'dev.crossbind.extension.pagefeel.PageFeelExtension' },
        },
    };
}
