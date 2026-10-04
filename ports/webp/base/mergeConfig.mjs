export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'webp',
        alias: { package: '@crossbind/port-webp' },
    },
    export: {
        type: 'cmake',
        // demux.h and mux.h stay out until libName links webpdemux and webpmux.
        publicHeaders: ['webp/decode.h', 'webp/encode.h', 'webp/types.h'],
        libName: ['webp', 'sharpyuv'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
