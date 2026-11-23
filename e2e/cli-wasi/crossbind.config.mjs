export default {
    general: {
        name: 'crossbind-e2e-cli-wasi',
    },
    paths: {
        config: import.meta.url,
        base: '../..',
        output: 'dist',
    },
    // The command as the npm command e2e-cli-wasi, as the package of an app's own command ships it.
    bin: { tools: { 'e2e-cli': { kind: 'binary', publish: true } } },
};
