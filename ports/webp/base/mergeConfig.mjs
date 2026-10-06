export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'webp',
        alias: { package: '@crossbind/port-webp' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['webp/decode.h', 'webp/encode.h', 'webp/types.h', 'webp/demux.h', 'webp/mux.h'],
        libName: ['webpmux', 'webpdemux', 'webp', 'sharpyuv'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
