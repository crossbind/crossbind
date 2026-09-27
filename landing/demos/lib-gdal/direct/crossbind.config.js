import gdalWasm from '@crossbind/port-gdal-wasm/crossbind.config.js';

export default {
    general: { name: 'gdaldirect' },
    dependencies: [gdalWasm],
    paths: { config: import.meta.url },
    targetSpecs: [
        {
            platform: 'wasm',
            specs: {
                // SpatiaLite is left out of the link (crossbind.overrides.js), and a
                // single-threaded build has no threads for GeoPackage or for the Arrow
                // path of ogr2ogr to use.
                env: {
                    SPATIALITE_LOAD: 'FALSE',
                    OGR2OGR_USE_ARROW_API: 'NO',
                    OGR_GPKG_NUM_THREADS: '1',
                },
            },
        },
    ],
};
