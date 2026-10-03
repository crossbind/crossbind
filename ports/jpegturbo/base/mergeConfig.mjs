export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'jpeg',
        alias: { package: '@crossbind/port-jpegturbo' },
    },
    export: {
        type: 'cmake',
        libName: ['jpeg'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
