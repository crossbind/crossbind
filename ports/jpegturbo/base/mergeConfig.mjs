export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'jpeg',
        alias: { package: '@crossbind/port-jpegturbo' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['jpeglib.h', 'jerror.h', 'jconfig.h', 'jpeglib_crossbind.h'],
        // jpeglib.h takes FILE and size_t from headers its users include first.
        headerPrelude: { 'jpeglib.h': ['stdio.h'] },
        // The Intel macOS build has no SIMD, so one binding of jconfig.h cannot carry WITH_SIMD for every platform.
        ignoredDeclarations: { 'jconfig.h': ['WITH_SIMD'] },
        libName: ['jpeg'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
