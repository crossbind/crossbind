export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'expat',
        alias: { package: '@crossbind/port-expat' },
    },
    export: {
        type: 'cmake',
        // expat.h declares its limit setters (XML_SetBillionLaughsAttackProtection*,
        // XML_SetAllocTracker*) only when XML_DTD or XML_GE is set, which expat_config.h does.
        headerPrelude: ['expat_config.h'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
