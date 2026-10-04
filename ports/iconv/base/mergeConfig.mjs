export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'iconv',
        alias: { package: '@crossbind/port-iconv' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['iconv.h', 'localcharset.h'],
        libName: ['iconv', 'charset'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        { platform: 'wasm', specs: { ignoreLibName: ['charset'] } },
        ...(newConfig.targetSpecs || []),
    ],
});
