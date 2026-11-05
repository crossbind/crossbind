// The origins whose pages load in the app beside its own, as app.navigation.load lists them: http and https ones alone,
// each as a URL's origin is, as 'https://login.example.com'.
function checkedNavigation(navigation) {
    if (navigation === null || typeof navigation !== 'object' || Array.isArray(navigation)) {
        throw new Error(`crossbind: app.navigation ${JSON.stringify(navigation)} is no object, as { load: ['https://login.example.com'] } is.`);
    }
    const unknown = Object.keys(navigation).filter((key) => key !== 'load');
    if (unknown.length > 0) throw new Error(`crossbind: app.navigation takes load alone; ${unknown.join(', ')} is none of it.`);
    const load = navigation.load ?? [];
    if (!Array.isArray(load)) throw new Error(`crossbind: app.navigation.load ${JSON.stringify(load)} is no list of origins, as ['https://login.example.com'] is.`);
    for (const origin of load) {
        const url = typeof origin === 'string' && URL.canParse(origin) ? new URL(origin) : null;
        if (!url || !['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
            throw new Error(`crossbind: app.navigation.load's ${JSON.stringify(origin)} is no http or https origin, as 'https://login.example.com' is, with no path, no default port and its host in lower case.`);
        }
    }
    return { load: [...load] };
}

export default function pageNavigation() {
    return {
        name: 'page-navigation',
        contract: 1,
        root: import.meta.dirname,
        holds: ['page-authentication', 'page-navigation'],
        reads: ['navigation'],
        fromApp: (api) => checkedNavigation(api.config.app.navigation ?? {}),
        app: {
            macos: { sources: ['native/navigation.cpp'] },
            ios: { sources: ['native/navigation.cpp'] },
            linux: { sources: ['native/navigation.cpp'] },
            windows: { sources: ['native/navigation.cpp'] },
            android: { sources: ['native/navigation.cpp'] },
        },
    };
}
