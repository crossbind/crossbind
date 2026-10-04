export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'Lerc',
        alias: { package: '@crossbind/port-lerc' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['Lerc_c_api.h', 'Lerc_types.h'],
        libName: ['Lerc'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        // On Windows Lerc_c_api.h imports its functions from a DLL unless told the library is static.
        { platform: 'win32', specs: { cmake: { compileOptions: ['-DLERC_STATIC'] } } },
        ...(newConfig.targetSpecs || []),
    ],
});
