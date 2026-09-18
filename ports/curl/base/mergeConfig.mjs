export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'curl',
        alias: { package: '@crossbind/port-curl' },
    },
    export: {
        type: 'cmake',
        bundle: false,
        // curl/easy.h and its siblings rely on CURL_EXTERN and the types curl/curl.h defines before including them.
        headerPrelude: ['curl/curl.h'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        { platform: 'wasm', specs: { binary: { emccFlags: ['-s', 'FETCH'] } } },
        ...(newConfig.targetSpecs || []),
    ],
});
