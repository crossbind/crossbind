// The fixture's hooks, which its page and a previewed project's page call: e2e/run.mjs's next step and the report of
// one, through the run's endpoint on the device's loopback; the preview's end, as the preview's own menu will end it;
// whether an origin is served now; on iOS a site's link, handed as iOS hands one; on Android the preview's key of the
// Keystore broken; and the preview's question of a project's devices, asked as an extension asks it, and on macOS, iOS
// and Linux read and answered as its user would.
export default function hooks({ endpoint }) {
    return {
        name: 'e2e-hooks',
        contract: 4,
        root: import.meta.dirname,
        options: { endpoint },
        app: {
            sources: ['hooks.cpp'],
            macos: { sources: ['macos.mm'] },
            ios: { sources: ['ios.mm'] },
            linux: { sources: ['linux.cpp'] },
            android: { java: 'android', class: 'dev.crossbind.e2e.hooks.HooksExtension' },
        },
    };
}
