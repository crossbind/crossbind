export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'gdal',
        alias: { package: '@crossbind/port-gdal' },
    },
    export: {
        type: 'cmake',
        // Declared but never defined by GDAL (OGRStrdup, VRTAverageFilteredSource), or a name that only a
        // header macro maps onto the real symbol (GDALExtractRPCInfoV1 -> GDALExtractRPCInfoV2): their
        // bindings cannot link.
        ignoredDeclarations: {
            'gdal.h': ['GDALExtractRPCInfoV1'],
            'ogr_core.h': ['OGRStrdup'],
            'vrtdataset.h': ['VRTAverageFilteredSource'],
        },
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
                data: { 'share/gdal': 'gdal' },
                env: {
                    GDAL_DATA: '_CROSSBIND_DATA_PATH_/gdal',
                    DXF_FEATURE_LIMIT_PER_BLOCK: '-1',
                    GDAL_ENABLE_DEPRECATED_DRIVER_GTM: 'YES',
                    CPL_LOG_ERRORS: 'ON',
                },
            },
        },
        {
            platform: 'wasm',
            specs: {
                env: {
                    GDAL_NUM_THREADS: (state, target) => (target.runtime === 'st' ? '0' : '1'),
                },
            },
        },
        {
            platform: 'wasi',
            specs: {
                env: { GDAL_CACHEMAX: '64' },
            },
        },
        // GDAL reads XML through the libxml2 of the macOS SDK, as the iOS pod does.
        { platform: 'darwin', specs: { binary: { addonFlags: ['-lxml2'] } } },
        // Process memory queries on Windows.
        { platform: 'win32', specs: { binary: { addonFlags: ['-lpsapi'] } } },
        ...(newConfig.targetSpecs || []),
    ],
});
