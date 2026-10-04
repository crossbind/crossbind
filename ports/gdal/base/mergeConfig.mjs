export default (newConfig = {}) => ({
    ...newConfig,
    general: {
        name: 'gdal',
        alias: { package: '@crossbind/port-gdal' },
    },
    export: {
        type: 'cmake',
        // GDAL's C API; its C++ headers come without a stable ABI.
        publicHeaders: [
            'gdal.h', 'gdal_alg.h', 'gdal_utils.h', 'gdalwarper.h', 'gdal_vrt.h', 'gdal_version.h', 'gdalalgorithm_c.h',
            'ogr_api.h', 'ogr_core.h', 'ogr_srs_api.h',
            'cpl_conv.h', 'cpl_error.h', 'cpl_string.h', 'cpl_vsi.h', 'cpl_progress.h', 'cpl_minixml.h',
        ],
        // Declared but never defined by GDAL (OGRStrdup, VRTAverageFilteredSource), or a name that only a
        // header macro maps onto the real symbol (GDALExtractRPCInfoV1 -> GDALExtractRPCInfoV2): their
        // bindings cannot link.
        ignoredDeclarations: {
            'gdal.h': ['GDALExtractRPCInfoV1'],
            'gdal_alg.h': ['GDALCreateRPCTransformerV1', 'RPCInfoV1ToMD'],
            'ogr_core.h': ['OGRStrdup'],
            'vrtdataset.h': ['VRTAverageFilteredSource'],
        },
        // GDAL keeps its C SRS API out of its own SWIG bindings, and VSIStatBufL is a typedef or a macro depending on
        // whether the platform defines VSI_STAT64_T: defined as itself, it keeps the name for every platform's compiler.
        swigPreamble: {
            'ogr_srs_api.h': ['#undef SWIG'],
            'cpl_vsi.h': ['#define VSI_STAT64_T VSI_STAT64_T'],
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
