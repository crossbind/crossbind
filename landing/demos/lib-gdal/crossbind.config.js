import gdalWasm from '@crossbind/port-gdal-wasm/crossbind.config.js';

// Link-time redirects, defined in src/native/site_link.cpp. The first three keep drivers and the gdal
// command-line framework nobody here calls out of the module; the last two run GDAL's thread-pool jobs
// in place, since a single-threaded build has no threads to run them.
const WRAPPED = [
    'GDALAllRegister',
    '_ZN10GDALDriver16DeclareAlgorithmERKNSt3__26vectorINS0_12basic_stringIcNS0_11char_traitsIcEENS0_9allocatorIcEEEENS5_IS7_EEEE',
    '_ZN27GDALGlobalAlgorithmRegistry12GetSingletonEv',
    '_ZN11CPLJobQueue9SubmitJobENSt3__28functionIFvvEEE',
    '_ZN19CPLWorkerThreadPool9SubmitJobENSt3__28functionIFvvEEE',
];

export default {
    general: { name: 'gdalapps' },
    dependencies: [gdalWasm],
    paths: { config: import.meta.url },
    targetSpecs: [
        {
            platform: 'wasm',
            specs: {
                // SpatiaLite is left out of the link (crossbind.overrides.js), and threads do not exist here.
                env: { SPATIALITE_LOAD: 'FALSE', OGR2OGR_USE_ARROW_API: 'NO', OGR_GPKG_NUM_THREADS: '1' },
                binary: { emccFlags: WRAPPED.map((symbol) => `-Wl,--wrap=${symbol}`) },
            },
        },
    ],
};
