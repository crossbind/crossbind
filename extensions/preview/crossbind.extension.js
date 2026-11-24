// The clouds a build asks, each with its snapshot host: crossbind cloud's own two, and one on this machine's loopback,
// as CI's stand-in and the cloud's local run serve, which names its snapshot host itself.
const CLOUDS = Object.freeze({
    production: { api: 'https://api.crossbind.dev', snapshots: 'https://snapshots.crossbind.dev' },
    staging: { api: 'https://api-staging.crossbind.dev', snapshots: 'https://snapshots-staging.crossbind.dev' },
});
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):[1-9]\d{0,4}$/;
// Ubuntu 22.04's libsecret, its headers and its library for each architecture, as its Packages index pins them.
const LIBSECRET = [
    'amd64 libsecret-1-dev_0.20.5-2_amd64.deb eeecfa21bbc8f8e06ccbdaab98a50afb633f174e489399c41c409277c9be8765',
    'amd64 libsecret-1-0_0.20.5-2_amd64.deb 60bd53073b4d76ce67f2990eaf1e9b9c5279349a17d7a2bae0c2f9976f4ce58a',
    'arm64 libsecret-1-dev_0.20.5-2_arm64.deb 00794b363a53dda4440717d41fbee7cfb5a92e81e042b7b2a170e5c538bd91a8',
    'arm64 libsecret-1-0_0.20.5-2_arm64.deb a75bc5ca651822881b98d78ced2854baa7e37dde85c6135203d10d96b6f4774c',
];

function cloudOf(cloud, snapshots) {
    if (typeof cloud === 'string' && Object.hasOwn(CLOUDS, cloud) && snapshots === undefined) return CLOUDS[cloud];
    if (LOOPBACK.test(cloud ?? '') && LOOPBACK.test(snapshots ?? '')) return { api: cloud, snapshots };
    throw new Error(`crossbind: preview's cloud is 'production', 'staging', or one on this machine for a test, as { cloud: 'http://127.0.0.1:8686', snapshots: 'http://127.0.0.1:8687' }, not ${JSON.stringify({ cloud, snapshots })}.`);
}

// The crossbind app's previews of the account it is signed in to: the device sign-in and the token in the system's
// store, the account's list, the opener and the proxy of a session's origin, with links of the app's own scheme and,
// on a phone, of crossbind.dev/open.
export default function preview({ cloud = 'production', snapshots } = {}) {
    const asked = cloudOf(cloud, snapshots);
    const apple = {
        sources: ['native/apple.mm'],
        frameworks: ['Security', 'AuthenticationServices'],
        plist: {
            NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
            NSLocalNetworkUsageDescription: 'crossbind connects to crossbind app preview on your computer to open your project.',
        },
    };
    return {
        name: 'preview',
        contract: 4,
        root: import.meta.dirname,
        fromApp: (api) => ({ ...asked, version: api.app.version }),
        app: {
            urlSchemes: ['dev.crossbind.app'],
            links: ['crossbind.dev/open'],
            sources: ['native/preview.cpp', 'native/cloud.cpp', 'native/opener.cpp', 'native/values.cpp'],
            macos: apple,
            ios: apple,
            windows: { sources: ['native/windows.cpp'], libraries: ['advapi32', 'bcrypt'] },
            linux: { sources: ['native/linux.cpp'], packages: LIBSECRET, libraries: ['secret-1'], depends: ['libsecret-1-0'] },
            android: {
                sources: ['native/android.cpp'],
                java: 'native/android',
                class: 'dev.crossbind.extension.preview.PreviewExtension',
                // A dev server on the network is plain http.
                cleartext: true,
            },
        },
    };
}
