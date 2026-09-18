export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'spatialite',
        alias: { package: '@crossbind/port-spatialite' },
    },
    export: {
        type: 'cmake',
        bundle: false,
        // Spatialite's public headers use sqlite3 and gaia types without including their headers.
        headerPrelude: ['sqlite3.h', 'spatialite/gaiageo.h', 'spatialite.h'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
