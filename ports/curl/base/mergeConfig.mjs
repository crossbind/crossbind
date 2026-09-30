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
        // Without IndexedDB support the fetch library opens no database while the module starts.
        { platform: 'wasm', specs: { binary: { emccFlags: ['-s', 'FETCH', '-sFETCH_SUPPORT_INDEXEDDB=0'] } } },
        // curl compresses with the zlib of the macOS SDK.
        { platform: 'darwin', specs: { binary: { addonFlags: ['-lz'] } } },
        // On Windows a consumer compiles against the static library, or curl.h expects a DLL; and it
        // links Winsock, the CNG random source, the certificate store and the adapter list curl uses.
        {
            platform: 'win32',
            specs: {
                cmake: { compileOptions: ['-DCURL_STATICLIB'] },
                binary: { addonFlags: ['-lws2_32', '-lbcrypt', '-ladvapi32', '-lcrypt32', '-liphlpapi'] },
            },
        },
        ...(newConfig.targetSpecs || []),
    ],
});
