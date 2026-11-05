// The e2e app's page-navigation, which takes the host's place, refuses every navigation beyond the app's origins and
// keeps what each asked, for src/main.js to check.
export default function pageNavigation() {
    return {
        name: 'e2e-page-navigation',
        contract: 1,
        replaces: 'page-navigation',
        root: import.meta.dirname,
        app: { sources: ['navigation.cpp'] },
    };
}
