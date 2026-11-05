// The e2e app's page-downloads, which takes the host's place, saves the page's downloads without asking and keeps how
// each ended, for src/main.js to check.
export default function pageDownloads() {
    return {
        name: 'e2e-page-downloads',
        contract: 1,
        replaces: 'page-downloads',
        root: import.meta.dirname,
        app: { sources: ['downloads.cpp'] },
    };
}
