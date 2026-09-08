const withoutPythonBindings = ['-DCMAKE_DISABLE_FIND_PACKAGE_Python=ON', '-DBUILD_PYTHON_BINDINGS=OFF'];

const platformCmake = {
    'wasm': ['-DBUILD_SHARED_LIBS=OFF'],
    'wasi': [
        // Probes can't carry the trailing -lunwind; seed the stdc++ link check.
        '-D_TEST_LINK_STDCPP:INTERNAL=1',
        // Jail finds to the passed prefixes; host configs (Homebrew Arrow, ...) leak otherwise.
        '-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=ONLY',
        '-DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=ONLY',
        '-DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=ONLY',
        // Codec deps have no wasi prebuilts; use GDAL's internal copies.
        '-DGDAL_USE_PNG_INTERNAL=ON', '-DGDAL_USE_JPEG_INTERNAL=ON',
        '-DGDAL_USE_JPEG12_INTERNAL=ON', '-DGDAL_USE_GIF_INTERNAL=ON',
        // GPKG needs the explicit SQLITE pair or it stays silently disabled.
        '-DOGR_ENABLE_DRIVER_SQLITE=ON', '-DOGR_ENABLE_DRIVER_GPKG=ON',
        '-DGDAL_USE_ICONV=OFF',
    ],
    'android': ['-DCMAKE_ANDROID_STL_TYPE=c++_shared', ...withoutPythonBindings],
    // GDAL's top-level project probes a host Python interpreter even though this port removes the
    // SWIG subdirectory and ships no Python bindings. New CMake versions reject that probe while
    // cross-compiling unless an emulator is configured (CMP0190), so disable the unused package.
    'ios': withoutPythonBindings,
};

const ifDep = (dep, params) => (dep ? params(dep) : []);

// GDAL-internal codec copies compiled into the library (GDAL_USE_*_INTERNAL);
// declared per platform so notices/SBOM track exactly what each artifact embeds.
const internalPng = { name: 'libpng', version: '1.6.43', license: 'libpng-2.0', files: ['frmts/png/libpng/LICENSE'], notes: 'GDAL internal copy (GDAL_USE_PNG_INTERNAL)' };
const internalGif = { name: 'giflib', license: 'MIT', files: ['frmts/gif/giflib/COPYING'], notes: 'GDAL internal copy (GDAL_USE_GIF_INTERNAL)' };
const internalJpeg = { name: 'libjpeg', version: '6b', license: 'IJG', files: ['frmts/jpeg/libjpeg/README'], notes: 'GDAL internal copy, 8- and 12-bit variants (GDAL_USE_JPEG_INTERNAL, GDAL_USE_JPEG12_INTERNAL)' };

export default {
    sha256: '5e0c388d83da2d686cc00a40272882432cdb54edff43d4af173e532844a0a0ea', // gdal-3.13.3.tar.gz
    getURL: (version) => `https://github.com/OSGeo/gdal/releases/download/v${version}/gdal-${version}.tar.gz`,
    copyToSource: { 'assets/gdal_empty_file.cpp': 'gcore/gdal_empty_file.cpp' },
    bundled: {
        wasi: [internalPng, internalJpeg, internalGif],
        wasm: [internalPng, internalGif],
        android: [internalPng, internalGif],
        ios: [internalPng, internalGif],
    },
    replaceList: [
        {
            regex: ' iconv_open',
            replacement: ' libiconv_open',
            paths: ['port/cpl_recode_iconv.cpp'],
        },
        {
            regex: '        iconv',
            replacement: '        libiconv',
            paths: ['port/cpl_recode_iconv.cpp'],
        },
        {
            regex: '#include <iconv.h>',
            replacement: '# include <iconv.h>\nextern "C" {\n    extern __attribute__((__visibility__("default"))) iconv_t libiconv_open (const char* tocode, const char* fromcode);\n    extern __attribute__((__visibility__("default"))) size_t libiconv (iconv_t cd,  ICONV_CPP_CONST char* * inbuf, size_t *inbytesleft, char* * outbuf, size_t *outbytesleft);\n}',
            paths: ['port/cpl_recode_iconv.cpp'],
        },
        {
            regex: '  add_subdirectory\\(swig\\)',
            replacement: '',
            paths: ['gdal.cmake'],
        },
        {
            regex: 'add_library\\(\\$\\{GDAL_LIB_TARGET_NAME\\} gcore/gdal.h\\)',
            replacement: 'add_library(${GDAL_LIB_TARGET_NAME} gcore/gdal.h gcore/gdal_empty_file.cpp)',
            paths: ['gdal.cmake'],
        },
        // __wasi__-guarded patches: other platforms compile the untouched upstream body.
        {
            regex: '#include "cpl_port.h"\n#include "cpl_spawn.h"',
            replacement: '#include "cpl_port.h"\n#include "cpl_spawn.h"\n\n/* WASI: no processes on WASI - every spawn entry point fails\n   cleanly instead of referencing fork/exec/wait. */\n#ifdef __wasi__\n#include "cpl_error.h"\n\nint CPLSpawn(const char *const *, VSILFILE *, VSILFILE *, int bDisplayErr)\n{\n    if (bDisplayErr)\n        CPLError(CE_Failure, CPLE_NotSupported, "CPLSpawn not supported on WASI");\n    return -1;\n}\n\nCPLSpawnedProcess *CPLSpawnAsync(int (*)(CPL_FILE_HANDLE, CPL_FILE_HANDLE),\n                                 const char *const *, int, int, int, char **)\n{\n    CPLError(CE_Failure, CPLE_NotSupported, "CPLSpawnAsync not supported on WASI");\n    return nullptr;\n}\n\nCPL_PID CPLSpawnAsyncGetChildProcessId(CPLSpawnedProcess *) { return -1; }\nint CPLSpawnAsyncFinish(CPLSpawnedProcess *, int, int) { return -1; }\nCPL_FILE_HANDLE CPLSpawnAsyncGetInputFileHandle(CPLSpawnedProcess *) { return -1; }\nCPL_FILE_HANDLE CPLSpawnAsyncGetOutputFileHandle(CPLSpawnedProcess *) { return -1; }\nCPL_FILE_HANDLE CPLSpawnAsyncGetErrorFileHandle(CPLSpawnedProcess *) { return -1; }\nvoid CPLSpawnAsyncCloseInputFileHandle(CPLSpawnedProcess *) {}\nvoid CPLSpawnAsyncCloseOutputFileHandle(CPLSpawnedProcess *) {}\nvoid CPLSpawnAsyncCloseErrorFileHandle(CPLSpawnedProcess *) {}\nint CPLPipeRead(CPL_FILE_HANDLE, void *, int) { return FALSE; }\nint CPLPipeWrite(CPL_FILE_HANDLE, const void *, int) { return FALSE; }\n\n#else /* !__wasi__ */',
            paths: ['port/cpl_spawn.cpp'],
        },
        {
            regex: '    return p->ferr;\n}',
            replacement: '    return p->ferr;\n}\n\n#endif /* !__wasi__ */',
            paths: ['port/cpl_spawn.cpp'],
        },
        {
            regex: '    int fd = mkstemp\\(osTmpFilename\\.data\\(\\)\\);',
            replacement: '#ifdef __wasi__\n    // wasi-libc has no mkstemp; take the plain-path fallback below\n    int fd = -1;\n#else\n    int fd = mkstemp(osTmpFilename.data());\n#endif',
            paths: ['port/cpl_vsil_unix_stdio_64.cpp'],
        },
        {
            regex: '#include "gdalalg_external.h"\n#include "gdalalg_materialize.h"',
            replacement: '#include "gdalalg_external.h"\n\n/* WASI: the external subcommand launches child processes, which do not\n   exist on WASI - fail cleanly instead. */\n#ifdef __wasi__\n#include "cpl_error.h"\n\nGDALExternalAlgorithmBase::~GDALExternalAlgorithmBase() = default;\n\nbool GDALExternalAlgorithmBase::Run(const std::vector<std::string> &,\n                                    std::vector<GDALArgDatasetValue> &,\n                                    const std::string &, GDALArgDatasetValue &)\n{\n    CPLError(CE_Failure, CPLE_NotSupported,\n             "External pipeline steps are not supported on WASI");\n    return false;\n}\n\nGDALExternalRasterOrVectorAlgorithm::~GDALExternalRasterOrVectorAlgorithm() =\n    default;\nGDALExternalRasterAlgorithm::~GDALExternalRasterAlgorithm() = default;\nGDALExternalVectorAlgorithm::~GDALExternalVectorAlgorithm() = default;\n\n#else /* !__wasi__ */\n#include "gdalalg_materialize.h"',
            paths: ['apps/gdalalg_external.cpp'],
        },
        {
            regex: '//! @endcond',
            replacement: '//! @endcond\n\n#endif /* !__wasi__ */',
            paths: ['apps/gdalalg_external.cpp'],
        },
        // wasi-sdk 34's libc++ no longer surfaces std::strtoull here; the global name is portable.
        {
            regex: 'std::strtoull',
            replacement: 'strtoull',
            paths: [
                'alg/zonal.cpp',
                'apps/gdal_create.cpp',
                'apps/gdalalg_vsi_sozip.cpp',
                'frmts/airsar/airsardataset.cpp',
                'frmts/basisu_ktx2/basisudataset.cpp',
                'frmts/basisu_ktx2/ktx2dataset.cpp',
                'frmts/e57/e57driver.cpp',
                'frmts/grib/gribdataset.cpp',
                'frmts/gtiff/gtiffdataset_read.cpp',
                'frmts/jp2kak/jp2kakdataset.cpp',
                'frmts/jpegxl/jpegxl.cpp',
                'frmts/netcdf/netcdfmultidim.cpp',
                'frmts/nitf/nitffile.cpp',
                'frmts/pds/pds4dataset.cpp',
                'frmts/tiledb/tiledbdense.cpp',
                'frmts/tiledb/tiledbmultidim.cpp',
                'frmts/tiledb/tiledbmultidimarray.cpp',
                'frmts/tiledb/tiledbsparse.cpp',
                'frmts/vrt/vrtmultidim.cpp',
                'frmts/vrt/vrtrasterband.cpp',
                'frmts/zarr/vsikerchunk_json_ref.cpp',
                'frmts/zarr/vsikerchunk_parquet_ref.cpp',
                'frmts/zarr/zarr_array.cpp',
                'frmts/zarr/zarr_v2_array.cpp',
                'frmts/zarr/zarr_v3_array.cpp',
                'gcore/gdalpamrasterband.cpp',
                'ogr/ogrsf_frmts/gpkg/ogrgeopackagetablelayer.cpp',
                'ogr/ogrsf_frmts/pds/ogrpdsdatasource.cpp',
                'port/cpl_minizip_zip.cpp',
                'port/cpl_vsil_cache.cpp',
                'port/cpl_vsil_curl.cpp',
                'port/cpl_vsil_stdin.cpp',
            ],
        },
        // libc++ hygiene: <atomic> is no longer transitively included here.
        {
            regex: '#include <limits>',
            replacement: '#include <atomic>\n#include <limits>',
            paths: ['apps/gdalalg_raster_tile.h'],
        },
    ],
    buildType: 'cmake',
    getBuildParams: (target, depPaths) => [
        ...(platformCmake[target.platform] || []),
        '-DBUILD_APPS=OFF', '-DBUILD_TESTING=OFF', '-DACCEPT_MISSING_SQLITE3_MUTEX_ALLOC=ON',
        '-DOGR_ENABLE_DRIVER_GPSBABEL=OFF', '-DGDAL_USE_HDF5=OFF', '-DGDAL_USE_HDFS=OFF',
        '-DGDAL_ENABLE_DRIVER_PDS=OFF',
        '-DGDAL_USE_OPENMP=OFF',
        ...ifDep(depPaths.sqlite3, (d) => [`-DSQLite3_INCLUDE_DIR=${d.header}`, `-DSQLite3_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.proj, (d) => [`-DPROJ_INCLUDE_DIR=${d.header}`, `-DPROJ_LIBRARY_RELEASE=${d.lib}`]),
        ...ifDep(depPaths.tiff, (d) => [`-DTIFF_INCLUDE_DIR=${d.header}`, `-DTIFF_LIBRARY_RELEASE=${d.lib}`]),
        ...ifDep(depPaths.jpeg, (d) => ['-DGDAL_USE_JPEG=ON', `-DJPEG_INCLUDE_DIR=${d.header}`, `-DJPEG_LIBRARY_RELEASE=${d.lib}`]),
        ...ifDep(depPaths.zstd, (d) => ['-DGDAL_USE_ZSTD=ON', `-DZSTD_INCLUDE_DIR=${d.header}`, `-DZSTD_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.Lerc, (d) => ['-DGDAL_USE_LERC=ON', `-DLERC_INCLUDE_DIR=${d.header}`, `-DLERC_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.geotiff, (d) => [`-DGEOTIFF_INCLUDE_DIR=${d.header}`, `-DGEOTIFF_LIBRARY_RELEASE=${d.lib}`]),
        ...ifDep(depPaths.z, (d) => [`-DZLIB_INCLUDE_DIR=${d.header}`, `-DZLIB_LIBRARY_RELEASE=${d.lib}`]),
        ...ifDep(depPaths.spatialite, (d) => [`-DSPATIALITE_INCLUDE_DIR=${d.header}`, `-DSPATIALITE_LIBRARY=${d.lib}`]),
        ...(depPaths.geos && depPaths.geos_c
            ? [`-DGEOS_INCLUDE_DIR=${depPaths.geos.header}`, `-DGEOS_LIBRARY=${depPaths.geos_c.lib}`]
            : []),
        ...ifDep(depPaths.webp, (d) => [`-DWEBP_INCLUDE_DIR=${d.header}`, `-DWEBP_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.expat, (d) => [`-DEXPAT_INCLUDE_DIR=${d.header}`, `-DEXPAT_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.iconv, (d) => [`-DIconv_INCLUDE_DIR=${d.header}`, `-DIconv_LIBRARY=${d.lib}`]),
        ...ifDep(depPaths.curl, (d) => ['-DGDAL_USE_CURL=ON', `-DCURL_INCLUDE_DIR=${d.header}`, `-DCURL_LIBRARY=${d.lib}`]),
    ],
    env: [
        'CFLAGS="-DRENAME_INTERNAL_LIBTIFF_SYMBOLS"',
        'CPPFLAGS="-DRENAME_INTERNAL_LIBTIFF_SYMBOLS"',
        'EMCC_CFLAGS="-DRENAME_INTERNAL_LIBTIFF_SYMBOLS"',
    ],
};
