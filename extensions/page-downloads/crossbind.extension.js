export default function pageDownloads() {
    return {
        name: 'page-downloads',
        contract: 1,
        root: import.meta.dirname,
        app: {
            macos: { sources: ['native/downloads.cpp'] },
            ios: { sources: ['native/downloads.cpp'] },
            linux: { sources: ['native/downloads.cpp'] },
            windows: { sources: ['native/downloads.cpp'] },
            android: { sources: ['native/downloads.cpp'] },
        },
    };
}
