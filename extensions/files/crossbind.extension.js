export default function files() {
    return {
        name: 'files',
        contract: 1,
        root: import.meta.dirname,
        reads: ['fileTypes'],
        // An app that opens files of any owner, whose files no extension owns it hands the page.
        fromApp: (api) => (api.app.fileTypes.length > 0 ? {} : null),
        app: {
            sources: ['native/files.cpp'],
        },
    };
}
