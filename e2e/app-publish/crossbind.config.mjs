export default {
    general: {
        name: 'crossbind-e2e-app-publish',
    },
    target: {
        runtimeEnv: 'app',
    },
    // The test app both stores have, which test-app-publish.yml publishes to Google Play's internal track and to
    // TestFlight. Its package.json version is the one the stores have.
    app: {
        id: 'dev.crossbind.storetest',
        name: 'crossbind test',
        icon: 'icon.png',
        encryption: false,
        team: '7ZZLDWBUVT',
    },
    paths: {
        config: import.meta.url,
        base: '../..',
    },
};
