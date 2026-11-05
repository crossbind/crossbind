export default function pageFiles() {
    return {
        name: 'page-files',
        contract: 1,
        root: import.meta.dirname,
        app: {
            macos: { sources: ['native/darwin.mm'] },
            android: { java: 'native/android', class: 'dev.crossbind.extension.pagefiles.PageFilesExtension' },
        },
    };
}
