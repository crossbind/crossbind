export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'geotiff',
        alias: { package: '@crossbind/port-geotiff' },
    },
    export: {
        type: 'cmake',
        bundle: false,
        headerPrelude: { 'geo_keyp.h': ['geo_tiffp.h'], 'geonames.h': ['geokeys.h', 'geovalues.h'] },
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
