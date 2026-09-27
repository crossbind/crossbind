# @crossbind/port-geotiff
**Precompiled libgeotiff (GeoTIFF) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-geotiff">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-geotiff?style=for-the-badge" />
</a>
<a href="https://github.com/OSGeo/libgeotiff">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-geotiff%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=GeoTIFF" />
</a>
<a href="https://github.com/OSGeo/libgeotiff/blob/master/libgeotiff/LICENSE">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-geotiff?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/geotiff](https://crossbind.dev/ports/geotiff/#apps)** run this package in your browser:

- **Where is this GeoTIFF?** Open a GeoTIFF and see its coordinate system by name, its corners in degrees, its outline on a world map and listgeo's report. The Istanbul sample, 1830 × 1830 pixels of 60 m in WGS 84 / UTM zone 35N, has its upper-left corner at 28.198970 E, 41.545594 N.
- **Georeference any picture.** A picture and a longitude and latitude box, or an EPSG code, a corner and a pixel size, become a GeoTIFF in five compressions. The 384 × 256 sample placed over Istanbul takes 295,368 bytes uncompressed, 101,434 with Deflate, 105,162 with ZSTD, 132,690 with LZW and 21,002 as JPEG, and GDAL reads each of them back at the same corners.
- **Elevation probe.** A float elevation model shaded as relief, with the longitude, latitude and height under the cursor, then saved again losslessly or with LERC. The 512 × 512 sample takes 607,670 bytes with Deflate and 283,298 with LERC within 10 cm, where the largest change read back is 0.100006 m. A cloud-optimized file is read from the smallest overview that fills the view.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-geotiff`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-geotiff).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-geotiff @crossbind/port-geotiff-wasm @crossbind/port-geotiff-android @crossbind/port-geotiff-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import geotiffWasm from '@crossbind/port-geotiff-wasm/crossbind.config.js';
+import geotiffAndroid from '@crossbind/port-geotiff-android/crossbind.config.js';
+import geotiffIos from '@crossbind/port-geotiff-ios/crossbind.config.js';

export default {
    dependencies: [
+        geotiffWasm,
+        geotiffAndroid,
+        geotiffIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

> In a web build, list only `geotiffWasm` for now: with the Android or iOS config beside it, the build also tries to preload their PROJ data and fails. See [known issues](https://github.com/crossbind/crossbind/blob/main/docs/known-issues.md).

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one writes a GeoTIFF in memory and reads back where it is: the coordinate system its GeoKeys name, and two corners in map units and in degrees. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/geotiff_locator.h
#pragma once

#include <geo_normalize.h>
#include <geotiff.h>
#include <geovalues.h>
#include <tiffio.hxx>
#include <xtiffio.h>

#include <cstdint>
#include <cstdio>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>

// Where is a GeoTIFF? Reads the coordinate system from its GeoKeys, puts two corners in map
// coordinates and turns them into longitude and latitude. Files travel as bytes, one per character,
// and libtiff's C++ stream API reads and writes them in memory.
class GeoTiffLocator {
public:
    static std::string version() { return LIBGEOTIFF_STRING_VERSION; }

    // A blank 8-bit image in the projected system `epsg`, its upper-left corner at (x, y), with
    // square pixels `pixelSize` map units wide.
    static std::u16string write(int epsg, int width, int height, double x, double y, double pixelSize) {
        std::ostringstream out;
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("sample.tif", &out), XTIFFClose);
        if (!tif) throw std::runtime_error("libtiff could not start a file");
        TIFFSetField(tif.get(), TIFFTAG_IMAGEWIDTH, width);
        TIFFSetField(tif.get(), TIFFTAG_IMAGELENGTH, height);
        TIFFSetField(tif.get(), TIFFTAG_BITSPERSAMPLE, 8);
        TIFFSetField(tif.get(), TIFFTAG_SAMPLESPERPIXEL, 1);
        TIFFSetField(tif.get(), TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK);
        TIFFSetField(tif.get(), TIFFTAG_ROWSPERSTRIP, height);
        const double tiepoint[6] = {0, 0, 0, x, y, 0};  // pixel (0, 0) sits at map (x, y)
        const double scale[3] = {pixelSize, pixelSize, 0};
        TIFFSetField(tif.get(), TIFFTAG_GEOTIEPOINTS, 6, tiepoint);
        TIFFSetField(tif.get(), TIFFTAG_GEOPIXELSCALE, 3, scale);

        Keys keys(GTIFNew(tif.get()), GTIFFree);
        GTIFKeySet(keys.get(), GTModelTypeGeoKey, TYPE_SHORT, 1, ModelTypeProjected);
        GTIFKeySet(keys.get(), GTRasterTypeGeoKey, TYPE_SHORT, 1, RasterPixelIsArea);
        GTIFKeySet(keys.get(), ProjectedCSTypeGeoKey, TYPE_SHORT, 1, epsg);
        GTIFWriteKeys(keys.get());
        keys.reset();

        std::string row(width, '\0');
        for (int y = 0; y < height; y += 1) {
            if (TIFFWriteScanline(tif.get(), row.data(), y, 0) < 0) throw std::runtime_error("libtiff could not write a row");
        }
        tif.reset();
        const std::string bytes = out.str();
        return std::u16string(bytes.begin(), bytes.end());
    }

    // JSON: the EPSG code and name, the size in pixels, and the upper-left and lower-right corners
    // in map units and in degrees.
    static std::string locate(const std::u16string& bytes) {
        std::istringstream in(std::string(bytes.begin(), bytes.end()));
        XTIFFInitialize();
        Tiff tif(TIFFStreamOpen("input.tif", &in), XTIFFClose);
        if (!tif) throw std::runtime_error("not a TIFF file");
        Keys keys(GTIFNew(tif.get()), GTIFFree);
        GTIFDefn defn;
        if (!keys || !GTIFGetDefn(keys.get(), &defn)) throw std::runtime_error("no coordinate system in the GeoKeys");

        uint32_t width = 0;
        uint32_t height = 0;
        TIFFGetField(tif.get(), TIFFTAG_IMAGEWIDTH, &width);
        TIFFGetField(tif.get(), TIFFTAG_IMAGELENGTH, &height);
        double x[2] = {0, static_cast<double>(width)};
        double y[2] = {0, static_cast<double>(height)};
        for (int i = 0; i < 2; i += 1) {
            if (!GTIFImageToPCS(keys.get(), &x[i], &y[i])) throw std::runtime_error("no tiepoint and pixel scale to place the pixels");
        }
        double lon[2] = {x[0], x[1]};
        double lat[2] = {y[0], y[1]};
        if (defn.Model == ModelTypeProjected && !GTIFProj4ToLatLong(&defn, 2, lon, lat)) throw std::runtime_error("PROJ could not unproject the corners");

        const bool projected = defn.Model == ModelTypeProjected;
        char* name = nullptr;
        if (projected) GTIFGetPCSInfo(defn.PCS, &name, nullptr, nullptr, nullptr);
        else GTIFGetGCSInfo(defn.GCS, &name, nullptr, nullptr, nullptr);
        const std::string crs = name ? name : "unnamed";
        GTIFFreeMemory(name);

        char json[640];
        std::snprintf(json, sizeof json,
                      "{\"epsg\":%d,\"name\":\"%s\",\"width\":%u,\"height\":%u,\"upperLeft\":[%.17g,%.17g],\"lowerRight\":[%.17g,%.17g],"
                      "\"upperLeftLonLat\":[%.17g,%.17g],\"lowerRightLonLat\":[%.17g,%.17g]}",
                      projected ? defn.PCS : defn.GCS, crs.c_str(), width, height, x[0], y[0], x[1], y[1], lon[0], lat[0], lon[1], lat[1]);
        return json;
    }

private:
    using Tiff = std::unique_ptr<TIFF, void (*)(TIFF*)>;
    using Keys = std::unique_ptr<GTIF, void (*)(GTIF*)>;
};
```

Then call it from JavaScript:

```js
import { initNative, GeoTiffLocator } from './native/geotiff_locator.h';

await initNative();
// 100 x 100 pixels of 30 m in WGS 84 / UTM zone 33N, the upper-left corner at 500000, 4650000
const tiff = await GeoTiffLocator.write(32633, 100, 100, 500000, 4650000, 30);
const where = JSON.parse(await GeoTiffLocator.locate(tiff));
console.log(`libgeotiff ${await GeoTiffLocator.version()}, ${tiff.length} B: EPSG:${where.epsg} ${where.name}, ${where.width} x ${where.height} pixels`); // libgeotiff 1.7.4, 10262 B: EPSG:32633 WGS 84 / UTM zone 33N, 100 x 100 pixels
const degrees = ([lon, lat]) => `${lon.toFixed(6)} E, ${lat.toFixed(6)} N`;
console.log(`upper left ${where.upperLeft.join(', ')} = ${degrees(where.upperLeftLonLat)}`); // upper left 500000, 4650000 = 15.000000 E, 42.002015 N
console.log(`lower right ${where.lowerRight.join(', ')} = ${degrees(where.lowerRightLonLat)}`); // lower right 503000, 4647000 = 15.036210 E, 41.974990 N
```

- Files cross the binding as bytes, one per character, and libtiff's C++ stream API (`TIFFStreamOpen` from `tiffio.hxx`, after `XTIFFInitialize` has registered the GeoTIFF tags) reads and writes them in memory, the same way on every platform. A file on disk opens with `XTIFFOpen(path, "r")` instead.
- `GTIFGetDefn` and the EPSG names read PROJ's `proj.db`. A WebAssembly build that depends on this package preloads PROJ's data, 10,690,537 bytes, next to its `.wasm`; the WASI page shows a command-line program mounting it.
- `GTIFProj4ToLatLong` gives degrees on the file's own datum, through the PROJ string libgeotiff builds. The corners above match the Krüger series for transverse Mercator to 1e-13°. libgeotiff 1.7.4 writes transverse Mercator scale factors into that string with six decimals, `+k=0.999601` for British National Grid's 0.9996012717, which moves the corners of the London sample by up to 9 cm.

### More examples
Each one runs in your browser on [crossbind.dev/ports/geotiff](https://crossbind.dev/ports/geotiff/#usage), next to the code shown there:

- [Write a compressed GeoTIFF](https://crossbind.dev/ports/geotiff/#02-write): `TIFFTAG_GEOTIEPOINTS` and `TIFFTAG_GEOPIXELSCALE`, `GTIFKeySet` and `GTIFWriteKeys`, Deflate with a predictor, and `GTIFPrint` for the dump listgeo prints.
- [Read the GeoKeys, the tiepoint and the pixel scale](https://crossbind.dev/ports/geotiff/#03-keys): `GTIFDirectoryInfo`, `GTIFKeyInfo`, `GTIFKeyGet` and `GTIFValueNameEx`, and `TIFFGetField` for the tags.
- [Expand an EPSG code into a full definition](https://crossbind.dev/ports/geotiff/#04-definition): `GTIFGetDefn`, the EPSG name functions and `GTIFGetProj4Defn`.
- [Convert between pixels and longitude, latitude](https://crossbind.dev/ports/geotiff/#05-pixels): `GTIFProj4FromLatLong` and `GTIFPCSToImage` one way, `GTIFImageToPCS` and `GTIFProj4ToLatLong` the other.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/geotiff/wasm/) · [Android](https://crossbind.dev/ports/geotiff/android/) · [iOS](https://crossbind.dev/ports/geotiff/ios/) · [WASI](https://crossbind.dev/ports/geotiff/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- libgeotiff 1.7.4 as the static library `libgeotiff`, linked against libtiff 4.7.2 and PROJ 9.9.0 from their own crossbind packages. libtiff's C++ stream API, which the examples use, ships as `libtiffxx`.
- In the WebAssembly build, libtiff writes and reads Deflate, LZW, JPEG, ZSTD and LERC: the apps above use all five, and GDAL, or tifffile for LERC, reads their files back.
- PROJ's data: `GTIFGetDefn` and the EPSG name lookups read `proj.db`, so every WebAssembly build that uses this package preloads PROJ's `share/proj`, 16 files and 10,690,537 bytes of which `proj.db` is 10,551,296, as a `.data.txt` file next to the module. The module behind the five examples and three apps is 6,139,509 bytes of WebAssembly, 144,658 bytes of JavaScript and that data file.
- libgeotiff's own `listgeo`, `geotifcp` and `applygeo` tools are not in the library packages; `@crossbind/port-geotiff-bin-wasi` ships them as WASI commands.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-geotiff-wasm`](https://www.npmjs.com/package/@crossbind/port-geotiff-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-geotiff-android`](https://www.npmjs.com/package/@crossbind/port-geotiff-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-geotiff-ios`](https://www.npmjs.com/package/@crossbind/port-geotiff-ios) | device (`arm64`), simulator (`arm64`) |
| WASI library | [`@crossbind/port-geotiff-wasi`](https://www.npmjs.com/package/@crossbind/port-geotiff-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-geotiff-bin-wasi`](https://www.npmjs.com/package/@crossbind/port-geotiff-bin-wasi) | the upstream `listgeo`, `geotifcp` and `applygeo` CLIs as `listgeo-wasi`, `geotifcp-wasi` and `applygeo-wasi` commands (wasmtime 47+) |

## License
This project includes the precompiled libgeotiff library, which is distributed under the [MIT License](https://github.com/OSGeo/libgeotiff/blob/master/libgeotiff/LICENSE). It links libtiff (libtiff licence) and PROJ (MIT) from their own packages, and through them SQLite, zlib, libjpeg-turbo, zstd and LERC, each under its own licence.

GeoTIFF Homepage: [https://github.com/OSGeo/libgeotiff](https://github.com/OSGeo/libgeotiff)
