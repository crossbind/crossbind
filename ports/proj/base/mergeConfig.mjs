export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'proj',
        alias: { package: '@crossbind/port-proj' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['proj.h', 'geodesic.h'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        {
            specs: {
                data: { 'share/proj': 'proj' },
                env: { PROJ_DATA: '_CROSSBIND_DATA_PATH_/proj' },
            },
        },
        // The shell folders PROJ looks its user directory up in on Windows.
        { platform: 'win32', specs: { binary: { addonFlags: ['-lshell32', '-lole32'] } } },
        ...(newConfig.targetSpecs || []),
    ],
});
