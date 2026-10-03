export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'zstd',
        alias: { package: '@crossbind/port-zstd' },
    },
    export: {
        type: 'cmake',
        libName: ['zstd'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
