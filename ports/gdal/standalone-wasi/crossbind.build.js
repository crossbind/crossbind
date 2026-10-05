import base from '@crossbind/port-gdal/build.mjs';

const multicallEntry = { kind: 'multicall-entry', publish: true };

// The library recipe with the upstream apps switched on: GDAL's own build produces the CLI.
export default {
    ...base,
    // Single source for the tool surface (contract C); crossbind derives crossbind-bin.json,
    // .npmignore and the multitool binary from this map after every build.
    bin: {
        multicall: { linkTarget: 'gdal_app', sourcesDir: 'apps' },
        tools: {
            gdal: { kind: 'binary', publish: true },
            gdal_contour: multicallEntry,
            gdal_create: multicallEntry,
            gdal_footprint: multicallEntry,
            gdal_grid: multicallEntry,
            gdal_rasterize: multicallEntry,
            gdal_translate: multicallEntry,
            gdal_viewshed: multicallEntry,
            gdaladdo: multicallEntry,
            gdalbuildvrt: multicallEntry,
            gdaldem: multicallEntry,
            gdalenhance: multicallEntry,
            gdalinfo: multicallEntry,
            gdallocationinfo: multicallEntry,
            gdalmanage: multicallEntry,
            gdalmdiminfo: multicallEntry,
            gdalmdimtranslate: multicallEntry,
            gdalsrsinfo: multicallEntry,
            gdaltindex: multicallEntry,
            gdaltransform: multicallEntry,
            gdalwarp: multicallEntry,
            gnmanalyse: multicallEntry,
            gnmmanage: multicallEntry,
            nearblack: multicallEntry,
            ogr2ogr: multicallEntry,
            ogrinfo: multicallEntry,
            ogrlineref: multicallEntry,
            ogrtindex: multicallEntry,
            sozip: multicallEntry,
        },
    },
    getBuildParams: (target, depPaths, ext, buildPath) => [
        ...base.getBuildParams(target, depPaths, ext, buildPath)
            .filter((param) => param !== '-DBUILD_APPS=OFF'),
        '-DBUILD_APPS=ON',
        // Static libcurl carries no dep metadata: append OpenSSL (+ emulation tail) at the end of C++ links; CURL_LIBRARY must stay one file for FindCURL.
        ...(depPaths.ssl && depPaths.crypto
            ? [`-DCMAKE_CXX_STANDARD_LIBRARIES=${depPaths.ssl.lib} ${depPaths.crypto.lib} -lwasi-emulated-signal -lwasi-emulated-process-clocks -lwasi-emulated-mman -lwasi-emulated-getpid`]
            : []),
    ],
};
