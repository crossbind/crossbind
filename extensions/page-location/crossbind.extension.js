export default function pageLocation() {
    return {
        name: 'page-location',
        contract: 1,
        root: import.meta.dirname,
        reads: ['permissions.location'],
        // WKWebView gives a macOS page no location of its own.
        fromApp: (api) => (api.platform === 'macos' && api.config.app.permissions?.location !== undefined ? {} : null),
        app: {
            macos: { sources: ['native/darwin.mm'], frameworks: ['CoreLocation'] },
        },
    };
}
