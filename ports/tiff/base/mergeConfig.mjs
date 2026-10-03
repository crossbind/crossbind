export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'tiff',
        alias: { package: '@crossbind/port-tiff' },
    },
    export: {
        type: 'cmake',
        libName: ['tiff', 'tiffxx'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
