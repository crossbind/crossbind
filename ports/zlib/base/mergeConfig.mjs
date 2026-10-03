export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'z',
        alias: { package: '@crossbind/port-zlib' },
    },
    export: {
        type: 'cmake',
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        ...(newConfig.paths || {}),
    },
    targetSpecs: [
        { platform: 'android', specs: { libType: 'static' } },
        ...(newConfig.targetSpecs || []),
    ],
});
