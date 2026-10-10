# @crossbind/port-proj
**Precompiled PROJ coordinate-transformation library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-proj">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-proj/beta?style=for-the-badge" />
</a>
<a href="https://github.com/OSGeo/PROJ">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-proj%2Fbeta&query=%24.nativeVersion&style=for-the-badge&label=PROJ" />
</a>
<a href="https://github.com/OSGeo/PROJ/blob/master/COPYING">
    <img alt="License" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.npmjs.org%2F%40crossbind%2Fport-proj%2Fbeta&query=%24.license&style=for-the-badge&label=license" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/proj](https://crossbind.dev/ports/proj/#apps)** run this package in your browser:

- **Projection atlas.** Any projected CRS, by its EPSG or ESRI code, WKT or PROJ string, drawn over its area of use as a graticule and circles that are all the same size on the ground; click the map to measure the distortion there with `proj_factors`. Equal Earth keeps every area at ×1.000 while angles are off by up to 36.03° at 60°E 60°N; World Mercator draws areas at 60°N 3.98 times too big.
- **CRS detective.** Paste a `.prj`, WKT, PROJJSON, PROJ string or code, and PROJ names its EPSG code, where it applies and its axis order, writes it in four formats and lists every transformation path to a second CRS. A shapefile's `.prj` for UTM zone 35N is EPSG:32635 at 100%; of the 10 operations EPSG knows from NAD27 to NAD83, 9 need a grid file this build does not ship.
- **Why flights curve.** The shortest route between two cities on the WGS 84 ellipsoid, next to the route that keeps one compass heading, on Mercator, on a map centred on the departure and on a globe. Istanbul to New York JFK is 8,080.310 km and reaches 54.20°N; holding a heading of 269.73° takes 8,668.4 km.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-proj`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-proj).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-proj@beta @crossbind/port-proj-wasm@beta @crossbind/port-proj-android@beta @crossbind/port-proj-ios@beta
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import projWasm from '@crossbind/port-proj-wasm/crossbind.config.js';
+import projAndroid from '@crossbind/port-proj-android/crossbind.config.js';
+import projIos from '@crossbind/port-proj-ios/crossbind.config.js';

export default {
    dependencies: [
+        projWasm,
+        projAndroid,
+        projIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon (`crossbind build -e node`) links the build of its platform: `-p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-proj-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one transforms coordinates between two coordinate reference systems with PROJ's C API. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/transformer.h
#pragma once

#include <proj.h>

#include <cmath>
#include <cstdio>
#include <stdexcept>
#include <string>

// Converts coordinates between two coordinate reference systems given as EPSG or ESRI codes, WKT,
// PROJJSON or PROJ strings. Axis order is normalised to longitude or easting first, so EPSG:4326
// takes (longitude, latitude) although EPSG defines it latitude first.
class Transformer {
public:
    Transformer(const std::string& source, const std::string& target) : context(proj_context_create()) {
        proj_log_func(context, &error, remember);
        PJ* chosen = proj_create_crs_to_crs(context, source.c_str(), target.c_str(), nullptr);
        if (chosen) {
            name = proj_get_name(chosen);
            transformation = proj_normalize_for_visualization(context, chosen);
            proj_destroy(chosen);
        }
        if (!transformation) {
            const std::string reason = error.empty() ? proj_context_errno_string(context, proj_context_errno(context)) : error;
            proj_context_destroy(context);
            throw std::runtime_error(reason);
        }
    }

    ~Transformer() {
        proj_destroy(transformation);
        proj_context_destroy(context);
    }

    Transformer(const Transformer&) = delete;
    Transformer& operator=(const Transformer&) = delete;

    // Both return the point as a JSON array, [x, y].
    std::string forward(double x, double y) { return apply(PJ_FWD, x, y); }
    std::string inverse(double x, double y) { return apply(PJ_INV, x, y); }

    // The operation PROJ picked, e.g. "UTM zone 35N".
    std::string operation() const { return name; }

private:
    std::string apply(PJ_DIRECTION direction, double x, double y) {
        proj_errno_reset(transformation);
        const PJ_COORD out = proj_trans(transformation, direction, proj_coord(x, y, 0, HUGE_VAL));
        if (out.xy.x == HUGE_VAL) throw std::runtime_error(proj_context_errno_string(context, proj_errno(transformation)));
        char json[64];
        std::snprintf(json, sizeof json, "[%.17g,%.17g]", out.xy.x, out.xy.y);
        return json;
    }

    // PROJ reports why a definition failed through its log, e.g. "crs not found: EPSG:99999".
    static void remember(void* error, int level, const char* message) {
        if (level == PJ_LOG_ERROR) *static_cast<std::string*>(error) = message;
    }

    PJ_CONTEXT* context;
    PJ* transformation = nullptr;
    std::string name;
    std::string error;
};
```

Then call it from JavaScript:

```js
import { initNative, Transformer } from './native/transformer.h';

await initNative();
const toUtm = await new Transformer('EPSG:4326', 'EPSG:32635'); // WGS 84 to UTM zone 35N
console.log(await toUtm.operation()); // UTM zone 35N
const [easting, northing] = JSON.parse(await toUtm.forward(28.9784, 41.0082)); // Istanbul, longitude first
console.log(easting.toFixed(2), northing.toFixed(2)); // 666370.51 4541552.49
const [longitude, latitude] = JSON.parse(await toUtm.inverse(easting, northing));
console.log(longitude.toFixed(6), latitude.toFixed(6)); // 28.978400 41.008200
const toWebMap = await new Transformer('EPSG:4326', 'EPSG:3857'); // WGS 84 to Web Mercator
console.log(await toWebMap.operation()); // Popular Visualisation Pseudo-Mercator
const [x, y] = JSON.parse(await toWebMap.forward(28.9784, 41.0082));
console.log(x.toFixed(2), y.toFixed(2)); // 3225860.73 5013551.24
```

- Coordinates cross the binding as numbers and come back as a JSON array, `[x, y]`.
- Longitude, or easting, comes first: `proj_normalize_for_visualization` puts it there, although EPSG defines EPSG:4326 latitude first.
- `proj_create_crs_to_crs` chooses the operation from PROJ's database, `proj.db`, which the WebAssembly build preloads: the first load downloads 10,690,537 bytes of data with the module.
- When PROJ cannot read a definition, the wrapper throws the reason PROJ logged: `new Transformer('EPSG:4326', 'EPSG:99999')` rejects with `std::runtime_error: proj_create: crs not found: EPSG:99999`.

### More examples
Each one runs in your browser on [crossbind.dev/ports/proj](https://crossbind.dev/ports/proj/#usage), next to the code shown there:

- [Write a CRS as WKT, a .prj, PROJJSON or a PROJ string](https://crossbind.dev/ports/proj/#02-formats): `proj_create`, `proj_as_wkt` for WKT2 and ESRI WKT, `proj_as_projjson` and `proj_as_proj_string`.
- [Read where a CRS applies and the order of its axes](https://crossbind.dev/ports/proj/#03-area-axes): `proj_get_area_of_use`, `proj_crs_get_coordinate_system` and `proj_cs_get_axis_info`.
- [Measure distances, headings and areas on the ellipsoid](https://crossbind.dev/ports/proj/#04-geodesic): `geod_inverse`, `geod_direct` and `geod_polygonarea` from `geodesic.h`.
- [Find the EPSG code of a .prj, and the UTM zone of a point](https://crossbind.dev/ports/proj/#05-identify): `proj_identify` and `proj_get_crs_info_list_from_database`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/proj/wasm/) · [Android](https://crossbind.dev/ports/proj/android/) · [iOS](https://crossbind.dev/ports/proj/ios/) · [macOS](https://crossbind.dev/ports/proj/darwin/) · [Linux](https://crossbind.dev/ports/proj/linux/) · [Windows](https://crossbind.dev/ports/proj/win32/) · [WASI](https://crossbind.dev/ports/proj/wasi/), which also has a command-line program built with `crossbind build -p wasi -e wasi`.

## What this build includes
- PROJ 9.9.0 as a static library, `libproj`, with its C API (`proj.h`), the geodesic library (`geodesic.h`) and the C++ API headers. SQLite 3.53.4 reads its database and libtiff 4.7.2 its GeoTIFF grid files.
- PROJ's data, `share/proj`: 16 files, 10,690,537 bytes. `proj.db` is 10,551,296 of them: EPSG v13.102 of 2026-08-27, ESRI (ArcGIS Pro 3.6), IGNF 3.1.0 and NKG 1.0.w, with 7,468 current EPSG CRSs and 4,717 from other authorities. The WebAssembly build preloads all 16 files with the module.
- No transformation grids and no network: grid files do not ship, and downloading them from cdn.proj.org is compiled out (`-DENABLE_CURL=OFF`). A datum shift that needs a grid falls back to a less accurate path. From NAD27 to NAD83, 9 of the 10 operations EPSG knows need a grid; at 118.2°W 45.2°N PROJ runs NAD27 to WGS 84 (6) + Inverse of NAD83 to WGS 84 (1), accurate to 11 m by EPSG's figures, where the CONUS grid gives 0.15 m. Helmert shifts, such as ETRS89 and CH1903+ to WGS 84, are unaffected.
- The module behind the five examples and three apps is 6,036,834 bytes of WebAssembly and 144,595 bytes of JavaScript, plus the data.
- PROJ's own tools are not in the library packages; `@crossbind/port-proj-standalone-wasi` ships them as WASI commands.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-proj-wasm`](https://www.npmjs.com/package/@crossbind/port-proj-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-proj-android`](https://www.npmjs.com/package/@crossbind/port-proj-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-proj-ios`](https://www.npmjs.com/package/@crossbind/port-proj-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-proj-darwin`](https://www.npmjs.com/package/@crossbind/port-proj-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-proj-linux`](https://www.npmjs.com/package/@crossbind/port-proj-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Linux (musl) | [`@crossbind/port-proj-linuxmusl`](https://www.npmjs.com/package/@crossbind/port-proj-linuxmusl) | `x64`, `arm64` — musl 1.2.5 or later (Alpine 3.21 and later), native Node.js addons |
| Windows | [`@crossbind/port-proj-win32`](https://www.npmjs.com/package/@crossbind/port-proj-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-proj-wasi`](https://www.npmjs.com/package/@crossbind/port-proj-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-proj-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-proj-standalone-wasi) | the upstream `proj`, `cct`, `cs2cs`, `geod`, `gie` and `projinfo` as `-wasi` commands (wasmtime 47+) |
| Node.js, ready-made | [`@crossbind/port-proj-standalone-napi`](https://www.npmjs.com/package/@crossbind/port-proj-standalone-napi) | prebuilt addons for macOS, Linux (glibc and musl) and Windows, `arm64` and `x64`: nothing to build |

## License
This project includes the precompiled PROJ library, which is distributed under the [MIT License](https://github.com/OSGeo/PROJ/blob/master/COPYING). The libraries it links ship in their own packages under their own licences: SQLite, which is in the public domain, and libtiff.

PROJ Homepage: [https://proj.org/](https://proj.org/)
