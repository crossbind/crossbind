export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'geotiff',
        alias: { package: '@crossbind/port-geotiff' },
    },
    export: {
        type: 'cmake',
        publicHeaders: ['geotiff.h', 'geotiffio.h', 'xtiffio.h', 'geo_normalize.h', 'geokeys.h', 'geovalues.h', 'geotiff_crossbind.h'],
        headerPrelude: { 'geo_keyp.h': ['geo_tiffp.h'], 'geonames.h': ['geokeys.h', 'geovalues.h'] },
        // Their key and code enums are filled from .inc files included inside the enum bodies.
        swigInlineIncludes: {
            'geokeys.h': ['geokeys.inc', 'geokeys_v1_1.inc'],
            'geovalues.h': [
                'epsg_gcs.inc', 'epsg_datum.inc', 'epsg_units.inc', 'epsg_ellipse.inc', 'epsg_pm.inc', 'epsg_pcs.inc', 'epsg_proj.inc',
                'geo_ctrans.inc', 'epsg_vertcs.inc',
            ],
        },
        ...(newConfig.export || {}),
    },
    paths: {
        output: 'dist',
        base: '../..',
        ...(newConfig.paths || {}),
    },
});
