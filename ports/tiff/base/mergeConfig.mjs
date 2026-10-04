export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'tiff',
        alias: { package: '@crossbind/port-tiff' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['tiffio.h', 'tiff.h', 'tiffvers.h', 'tiffio_crossbind.h'],
        libName: ['tiff', 'tiffxx'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
