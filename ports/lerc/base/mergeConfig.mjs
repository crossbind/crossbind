export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'Lerc',
        alias: { package: '@crossbind/port-lerc' },
    },
    export: {
        type: 'cmake',
        libName: ['Lerc'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
