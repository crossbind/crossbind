# @crossbind/port-gdal
**Precompiled GDAL geospatial library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-gdal">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-gdal/beta?style=for-the-badge" />
</a>
<a href="https://github.com/OSGeo/gdal">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-gdal%2Fbeta&query=%24.nativeVersion&style=for-the-badge&label=GDAL" />
</a>
<a href="https://github.com/OSGeo/gdal/blob/master/LICENSE.TXT">
    <img alt="License" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-gdal%2Fbeta&query=%24.license&style=for-the-badge&label=license" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/gdal](https://crossbind.dev/ports/gdal/#apps)** run this package in your browser:

- **Vector converter.** Opens twenty vector formats, from zipped Shapefiles and GeoPackages to Esri File Geodatabases, and writes seventeen of them in another coordinate system, filtered by a SQL condition. The sample, a GeoPackage of eight cities, the lines between some of them and two regions, comes out of every writer with the layers, feature counts and extents the host's own ogr2ogr 3.13.0 writes; as a zipped File Geodatabase it is 28 files.
- **Terrain studio.** Hillshade, slope, aspect, roughness, TPI, contour lines and a viewshed on a generated 512 × 512 landscape of 30 m cells. It has 346 contour lines every 100 m, and from its centre, 10 m above the ground, 3,123 of its 262,144 cells are seen.
- **Pixels to polygons.** Paint on a grid and GDAL traces it. The sample grid, with specks under 5 pixels sieved out, becomes 3 polygons with 1 hole, of 1,500, 1,400 and 1,257 pixels, as the host's gdal_sieve.py and gdal_polygonize.py make them.

Their C++ wrappers, and the self-check the site build runs against values from the host's own GDAL 3.13.0 on the same inputs, are in [`landing/demos/lib-gdal`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-gdal).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-gdal@beta @crossbind/port-gdal-wasm@beta @crossbind/port-gdal-android@beta @crossbind/port-gdal-ios@beta
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import gdalWasm from '@crossbind/port-gdal-wasm/crossbind.config.js';
+import gdalAndroid from '@crossbind/port-gdal-android/crossbind.config.js';
+import gdalIos from '@crossbind/port-gdal-ios/crossbind.config.js';

export default {
    dependencies: [
+        gdalWasm,
+        gdalAndroid,
+        gdalIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon (`crossbind build -e node`) links the build of its platform: `-p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-gdal-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one converts GeoJSON text to other vector formats, reprojected, as the ogr2ogr tool does. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/vector_converter.h
#pragma once

#include <cpl_error.h>
#include <cpl_string.h>
#include <cpl_vsi.h>
#include <gdal.h>
#include <gdal_utils.h>
#include <ogr_srs_api.h>
#include <ogrsf_frmts.h>

#include <cmath>
#include <stdexcept>
#include <string>

// Converts GeoJSON text to another vector format, reprojected, and reports what was written.
// It registers only the drivers it uses, so GDAL opens and writes these formats and no others.
class VectorConverter {
public:
    VectorConverter() {
        RegisterOGRGeoJSON();
        RegisterOGRGeoPackage();
        RegisterOGRFlatGeobuf();
        RegisterOGRShape();
    }

    std::string convert(const std::string& geojson, const std::string& format, const std::string& targetCrs,
                        const std::string& outputPath) {
        const char* input = "/vsimem/input.geojson";
        VSIFCloseL(VSIFileFromMemBuffer(input, reinterpret_cast<GByte*>(const_cast<char*>(geojson.data())), geojson.size(), FALSE));
        GDALDatasetH source = GDALOpenEx(input, GDAL_OF_VECTOR, nullptr, nullptr, nullptr);
        if (!source) fail(input);

        CPLStringList args;
        args.AddString("-f");
        args.AddString(format.c_str());
        args.AddString("-t_srs");
        args.AddString(targetCrs.c_str());
        GDALVectorTranslateOptions* options = GDALVectorTranslateOptionsNew(args.List(), nullptr);
        VSIUnlink(outputPath.c_str()); // replace the output of an earlier call
        GDALDatasetH written = GDALVectorTranslate(outputPath.c_str(), nullptr, 1, &source, options, nullptr);
        GDALVectorTranslateOptionsFree(options);
        GDALClose(source);
        if (!written) fail(input);

        OGRLayerH layer = GDALDatasetGetLayer(written, 0);
        OGREnvelope extent;
        OGR_L_GetExtent(layer, &extent, TRUE);
        OGRSpatialReferenceH crs = OGR_L_GetSpatialRef(layer);
        const char* authority = crs ? OSRGetAuthorityName(crs, nullptr) : nullptr;
        const char* code = crs ? OSRGetAuthorityCode(crs, nullptr) : nullptr;
        const std::string summary = format + ": " + std::to_string(OGR_L_GetFeatureCount(layer, TRUE)) + " features, " +
            (authority && code ? std::string(authority) + ":" + code : std::string("no CRS")) + ", extent " +
            std::to_string(std::llround(extent.MinX)) + " " + std::to_string(std::llround(extent.MinY)) + " " +
            std::to_string(std::llround(extent.MaxX)) + " " + std::to_string(std::llround(extent.MaxY));
        GDALClose(written);
        VSIUnlink(input);
        return summary;
    }

private:
    [[noreturn]] static void fail(const char* input) {
        const std::string reason = CPLGetLastErrorMsg();
        VSIUnlink(input);
        throw std::runtime_error(reason.empty() ? "GDAL could not convert the data" : reason);
    }
};
```

Then call it from JavaScript:

```js
import { initNative, VectorConverter } from './native/vector_converter.h';

await initNative();
const converter = await new VectorConverter();
const cities = JSON.stringify({
    type: 'FeatureCollection',
    features: [
        ['Istanbul', 28.9784, 41.0082],
        ['Ankara', 32.8597, 39.9334],
        ['Izmir', 27.1428, 38.4237],
    ].map(([name, lon, lat]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
});
console.log(await converter.convert(cities, 'GPKG', 'EPSG:3857', '/vsimem/cities.gpkg')); // GPKG: 3 features, EPSG:3857, extent 3021523 4639455 3657925 5013551
console.log(await converter.convert(cities, 'ESRI Shapefile', 'EPSG:32635', '/vsimem/cities.shp.zip')); // ESRI Shapefile: 3 features, EPSG:32635, extent 512465 4252837 1000822 4541552
```

- GDAL's C API takes paths, so text goes in through `/vsimem/`, GDAL's in-memory file system: `VSIFileFromMemBuffer` names the string's bytes as a file without copying them. To let a visitor download a result, write it under `/memfs/<general.name>/` instead and read it with `m.getFileBytes(path)`.
- Register the drivers you use, one by one, rather than calling `GDALAllRegister()`, so GDAL opens only the formats you expect. On WebAssembly that alone does not make the module smaller; see the sizes below.
- When GDAL fails, the wrapper throws GDAL's last error message; for an unknown format JavaScript catches an error reading ``std::runtime_error: Unable to find driver `NoSuchFormat'.``, and for an unknown code `std::runtime_error: Failed to process SRS definition: EPSG:999999`.

### More examples
Each one runs in your browser on [crossbind.dev/ports/gdal](https://crossbind.dev/ports/gdal/#usage), next to the code shown there:

- [Write a GeoTIFF and read its georeferencing back](https://crossbind.dev/ports/gdal/#02-raster-info): `GDALCreate`, `GDALSetGeoTransform` and `OSRImportFromEPSG`, then `GDALOpenEx`, `GDALGetGeoTransform`, `GDALGetSpatialRef` and the `gdalinfo` report from `GDALInfo`.
- [Reproject a raster and write a Cloud-Optimized GeoTIFF](https://crossbind.dev/ports/gdal/#03-cog): `GDALWarp` into a virtual raster, then `GDALTranslate` with `-of COG`.
- [Hillshade, slope and contour lines from an elevation model](https://crossbind.dev/ports/gdal/#04-terrain): `GDALDEMProcessing` and `GDALContourGenerateEx`.
- [Read features and filter them by attribute and area](https://crossbind.dev/ports/gdal/#05-features): `OGR_L_SetAttributeFilter`, `OGR_L_SetSpatialFilterRect` and `OGR_L_GetNextFeature` over a CSV opened with open options.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/gdal/wasm/) · [Android](https://crossbind.dev/ports/gdal/android/) · [iOS](https://crossbind.dev/ports/gdal/ios/) · [macOS](https://crossbind.dev/ports/gdal/darwin/) · [Linux](https://crossbind.dev/ports/gdal/linux/) · [Windows](https://crossbind.dev/ports/gdal/win32/) · [WASI](https://crossbind.dev/ports/gdal/wasi/), which also has a command-line program built with `crossbind build -p wasi -e wasi`.

## What this build includes
- GDAL 3.13.3 as one static library, `libgdal`, with its dependencies from their own crossbind packages: PROJ 9.9.0, GEOS 3.15.0, SQLite 3.53.4, SpatiaLite 5.1.0, libtiff 4.7.2, libgeotiff 1.7.4, libjpeg-turbo 3.2.0, libwebp 1.6.0, zstd 1.5.7, LERC 4.2.0, zlib 1.3.2, Expat 2.8.5, libiconv 1.19, curl 8.22.0 and OpenSSL 4.0.2.
- 180 drivers: `GDALAllRegister()` registers 180, 127 of them for rasters and 62 for vectors (some do both), among them GTiff and COG, GPKG, OpenFileGDB, Shapefile, KML, PMTiles, MBTiles, Zarr and GRIB. There is no Arrow or Parquet (GeoParquet), JPEG 2000, netCDF, HDF4, HDF5 or LIBKML driver.
- GDAL's data files (155 files, 2,855,622 bytes) and PROJ's, with `proj.db` (16 files, 10,690,537 bytes). A browser build preloads both as one 13,546,159-byte `<name>-….browser.data.txt` next to its `.wasm`, however few drivers it registers; a WASI build copies them to `dist/data`.
- Size on WebAssembly: registering drivers one by one is not enough on its own, because `GDALDataset::ExecuteSQL` reaches `GDALAllRegister` through the SQLite dialect and links every driver. The module behind the apps above registers 5 raster and 20 vector drivers, redirects that call with the linker's `--wrap` and leaves curl, OpenSSL, SpatiaLite, WebP, LERC and JPEG out with `crossbind.overrides.js` ([its config](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-gdal)). It is 16,451,235 bytes of WebAssembly and 166,019 bytes of JavaScript; the same headers without those steps link to 38,702,527 bytes.

  | Step, applied to the full link | WebAssembly |
  |---|---:|
  | Every driver, as linked by `GDALAllRegister` | 38,702,527 B |
  | `--wrap=GDALAllRegister`: only the drivers registered | 30,118,507 B |
  | also without the `gdal` command-line framework, which GPKG, OpenFileGDB and COG declare | 27,786,568 B |
  | also without curl and OpenSSL, which a page cannot use | 23,565,075 B |
  | also without SpatiaLite, with `SPATIALITE_LOAD=FALSE` | 17,296,769 B |
  | also without WebP, LERC and JPEG | 16,451,235 B |

- Single-threaded WebAssembly has no threads. The single-threaded build runs a job of GDAL's thread pool where it is submitted, so `GDALViewshedGenerate` returns, but the GeoPackage driver starts threads of its own: ogr2ogr's Arrow path fails on GeoPackage input unless `OGR2OGR_USE_ARROW_API=NO` is set, as the module above does.
- The GDAL command-line tools are not in the library packages; `@crossbind/port-gdal-standalone-wasi` ships the `gdal` program with the classic tools, `gdalinfo` and `ogr2ogr` among them, as WASI commands.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-gdal-wasm`](https://www.npmjs.com/package/@crossbind/port-gdal-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-gdal-android`](https://www.npmjs.com/package/@crossbind/port-gdal-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-gdal-ios`](https://www.npmjs.com/package/@crossbind/port-gdal-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-gdal-darwin`](https://www.npmjs.com/package/@crossbind/port-gdal-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-gdal-linux`](https://www.npmjs.com/package/@crossbind/port-gdal-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Linux (musl) | [`@crossbind/port-gdal-linuxmusl`](https://www.npmjs.com/package/@crossbind/port-gdal-linuxmusl) | `x64`, `arm64` — musl 1.2.5 or later (Alpine 3.21 and later), native Node.js addons |
| Windows | [`@crossbind/port-gdal-win32`](https://www.npmjs.com/package/@crossbind/port-gdal-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-gdal-wasi`](https://www.npmjs.com/package/@crossbind/port-gdal-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-gdal-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-gdal-standalone-wasi) | the upstream `gdal` CLI and its classic tools as `<tool>-wasi` commands (wasmtime 47+) |
| Node.js, ready-made | [`@crossbind/port-gdal-standalone-napi`](https://www.npmjs.com/package/@crossbind/port-gdal-standalone-napi) | prebuilt addons for macOS, Linux (glibc and musl) and Windows, `arm64` and `x64`: nothing to build |

## License
This project includes the precompiled GDAL library, which is distributed under the [MIT License](https://github.com/OSGeo/gdal/blob/master/LICENSE.TXT).

The platform packages link GDAL's dependencies statically, and some have other licences: GEOS and libiconv are LGPL-2.1-or-later, and SpatiaLite is MPL-1.1, GPL-2.0-or-later or LGPL-2.1-or-later. An app that ships them conveys them, a web app included: carry their licences and point to their sources. The [LGPL playbook](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/licensing-lgpl.md) covers the rest, such as keeping the WebAssembly a separate, replaceable file.

GDAL Homepage: [https://gdal.org/](https://gdal.org/)
