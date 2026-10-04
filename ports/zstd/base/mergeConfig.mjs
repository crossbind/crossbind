export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'zstd',
        alias: { package: '@crossbind/port-zstd' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['zstd.h', 'zdict.h', 'zstd_errors.h'],
        libName: ['zstd'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
