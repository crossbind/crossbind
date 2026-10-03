export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'spatialite',
        alias: { package: '@crossbind/port-spatialite' },
    },
    export: {
        type: 'cmake',
        // Spatialite's public headers use sqlite3 and gaia types without including their headers.
        headerPrelude: ['sqlite3.h', 'spatialite/gaiageo.h', 'spatialite.h'],
        // Declared but not in this build of the library, so bindings of the headers would not
        // link: a misspelling the library never defines (it has spatialite_set_verbose_mode),
        // and loaders that need minizip or FreeXL, which the port leaves out.
        ignoredDeclarations: ['spatialite_set_verbode_mode', 'load_zip_shapefile', 'load_zip_dbf', 'load_XL'],
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
