# @crossbind/port-geos
**Precompiled GEOS geometry library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-geos">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-geos?style=for-the-badge" />
</a>
<a href="https://github.com/libgeos/geos">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-geos%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=Geos" />
</a>
<a href="https://github.com/libgeos/geos/blob/main/COPYING">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-geos?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/geos](https://crossbind.dev/ports/geos/#apps)** run this package in your browser:

- **Geometry lab.** Fifteen GEOS operations on shapes you type as WKT, drawn over their inputs next to the DE-9IM matrix of how the shapes relate. A river crossing a park with a pond keeps 51.77 units of its length inside the park, and the two relate as `1F20F1102`.
- **Validity doctor.** Seven broken polygons, what GEOS finds wrong and where, and both of its repair methods side by side. A hole that leaks out of its shell repairs to 150 square units with the linework method and to 75 with the structure method.
- **Coverage simplifier.** A generated map of 36 regions simplified at tolerance 2. One region at a time, 356.917 square units of gaps and 186.433 of overlaps open between neighbours; simplified as one coverage, none do.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-geos`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-geos).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-geos @crossbind/port-geos-wasm @crossbind/port-geos-android @crossbind/port-geos-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import geosWasm from '@crossbind/port-geos-wasm/crossbind.config.js';
+import geosAndroid from '@crossbind/port-geos-android/crossbind.config.js';
+import geosIos from '@crossbind/port-geos-ios/crossbind.config.js';

export default {
    dependencies: [
+        geosWasm,
+        geosAndroid,
+        geosIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-geos-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one runs GEOS overlays on shapes written as WKT, through GEOS's reentrant C API. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/overlay.h
#pragma once

#include <geos_c.h>

#include <memory>
#include <stdexcept>
#include <string>

// Overlay of two geometries written as WKT. Every result is normalised, so the same shape always
// prints the same WKT whatever order its vertices came in.
class Overlay {
public:
    static std::string version() { return GEOSversion(); }

    static std::string intersection(const std::string& a, const std::string& b) { return apply(GEOSIntersection_r, a, b); }
    static std::string unite(const std::string& a, const std::string& b) { return apply(GEOSUnion_r, a, b); }
    static std::string difference(const std::string& a, const std::string& b) { return apply(GEOSDifference_r, a, b); }

    static double area(const std::string& wkt) {
        Session geos;
        double value = 0;
        if (!GEOSArea_r(geos.context, geos.read(wkt).get(), &value)) geos.fail();
        return value;
    }

private:
    using Operation = GEOSGeometry* (*)(GEOSContextHandle_t, const GEOSGeometry*, const GEOSGeometry*);

    static std::string apply(Operation operation, const std::string& a, const std::string& b) {
        Session geos;
        const auto left = geos.read(a);
        const auto right = geos.read(b);
        return geos.result(operation(geos.context, left.get(), right.get()));
    }

    // GEOS's reentrant C API: each call gets its own context, which also holds the last error message.
    struct Session {
        struct Destroy {
            GEOSContextHandle_t context;
            void operator()(GEOSGeometry* geometry) const { GEOSGeom_destroy_r(context, geometry); }
        };
        using Geometry = std::unique_ptr<GEOSGeometry, Destroy>;

        GEOSContextHandle_t context = GEOS_init_r();
        std::string error;

        Session() { GEOSContext_setErrorMessageHandler_r(context, remember, &error); }
        ~Session() { GEOS_finish_r(context); }
        Session(const Session&) = delete;
        Session& operator=(const Session&) = delete;

        Geometry own(GEOSGeometry* geometry) {
            if (!geometry) fail();
            return Geometry(geometry, Destroy{context});
        }

        Geometry read(const std::string& wkt) {
            GEOSWKTReader* reader = GEOSWKTReader_create_r(context);
            GEOSGeometry* geometry = GEOSWKTReader_read_r(context, reader, wkt.c_str());
            GEOSWKTReader_destroy_r(context, reader);
            return own(geometry);
        }

        std::string write(const GEOSGeometry* geometry) {
            GEOSWKTWriter* writer = GEOSWKTWriter_create_r(context);
            char* text = GEOSWKTWriter_write_r(context, writer, geometry);
            GEOSWKTWriter_destroy_r(context, writer);
            if (!text) fail();
            const std::string wkt = text;
            GEOSFree_r(context, text);
            return wkt;
        }

        // Takes ownership of a result and writes it normalised.
        std::string result(GEOSGeometry* geometry) {
            const Geometry owned = own(geometry);
            if (GEOSNormalize_r(context, owned.get()) != 0) fail();
            return write(owned.get());
        }

        [[noreturn]] void fail() const { throw std::runtime_error(error.empty() ? "GEOS operation failed" : error); }

        static void remember(const char* message, void* error) { *static_cast<std::string*>(error) = message; }
    };
};
```

Then call it from JavaScript:

```js
import { initNative, Overlay } from './native/overlay.h';

await initNative();
const parcel = 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))';
const floodZone = 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))';
const flooded = await Overlay.intersection(parcel, floodZone);
console.log(await Overlay.version()); // 3.15.0-CAPI-1.21.0
console.log(flooded, await Overlay.area(flooded)); // POLYGON ((5 5, 5 10, 10 10, 10 5, 5 5)) 25
console.log(await Overlay.area(await Overlay.unite(parcel, floodZone)), await Overlay.area(await Overlay.difference(parcel, floodZone))); // 175 75
```

- Shapes cross the binding as WKT strings, and results come back normalised, so the same shape always prints the same WKT.
- GEOS works in the plane: areas and distances are in the units of the coordinates. Project longitude and latitude before measuring them.
- Each call opens its own GEOS context with `GEOS_init_r`, which keeps the reentrant C API safe to call from several threads. When GEOS fails, the wrapper throws GEOS's message; for broken WKT, JavaScript catches an error reading `std::runtime_error: ParseException: Expected word but encountered end of stream`.

### More examples
Each one runs in your browser on [crossbind.dev/ports/geos](https://crossbind.dev/ports/geos/#usage), next to the code shown there:

- [Test points against a prepared polygon](https://crossbind.dev/ports/geos/#02-zone): `GEOSPrepare_r` once, then `GEOSPreparedContainsXY_r` and `GEOSPreparedIntersectsXY_r` for each point, and `GEOSPreparedRelate_r` for the DE-9IM matrix.
- [Measure area, length and distance](https://crossbind.dev/ports/geos/#03-measure): `GEOSArea_r`, `GEOSLength_r`, `GEOSDistance_r`, `GEOSNearestPoints_r` and `GEOSGetCentroid_r`.
- [Buffer points, lines and polygons](https://crossbind.dev/ports/geos/#04-buffer): `GEOSBuffer_r`, `GEOSBufferWithStyle_r` with cap and join styles, and `GEOSOffsetCurve_r`.
- [Find why a polygon is invalid and repair it](https://crossbind.dev/ports/geos/#05-validity): `GEOSisValidReason_r`, and `GEOSMakeValidWithParams_r` with both of its methods.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/geos/wasm/) · [Android](https://crossbind.dev/ports/geos/android/) · [iOS](https://crossbind.dev/ports/geos/ios/) · [macOS](https://crossbind.dev/ports/geos/darwin/) · [Linux](https://crossbind.dev/ports/geos/linux/) · [Windows](https://crossbind.dev/ports/geos/win32/) · [WASI](https://crossbind.dev/ports/geos/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- GEOS 3.15.0 (C API 1.21.0) as two static libraries: `libgeos_c`, the stable C API the examples use, and `libgeos`, the C++ library behind it.
- The C API the apps above run: overlays, prepared predicates and DE-9IM, buffers and offset curves, validity checks and both repair methods, coverage simplification and validation, Delaunay and Voronoi, hulls, and WKT and GeoJSON output.
- No data files: a GEOS module is its `.wasm` and loader alone. The module behind the five examples and three apps is 1,612,592 bytes of WebAssembly and 138,052 bytes of JavaScript.
- GEOS's own `geosop` tool is not in the library packages; `@crossbind/port-geos-standalone-wasi` ships it as a WASI command.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-geos-wasm`](https://www.npmjs.com/package/@crossbind/port-geos-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-geos-android`](https://www.npmjs.com/package/@crossbind/port-geos-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-geos-ios`](https://www.npmjs.com/package/@crossbind/port-geos-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-geos-darwin`](https://www.npmjs.com/package/@crossbind/port-geos-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-geos-linux`](https://www.npmjs.com/package/@crossbind/port-geos-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-geos-win32`](https://www.npmjs.com/package/@crossbind/port-geos-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-geos-wasi`](https://www.npmjs.com/package/@crossbind/port-geos-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-geos-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-geos-standalone-wasi) | the upstream `geosop` CLI as a `geosop-wasi` command (wasmtime 47+) |

## License
This project includes the precompiled GEOS library, which is distributed under the [GNU LGPL 2.1](https://github.com/libgeos/geos/blob/main/COPYING).

An app that ships GEOS conveys it, a web app included: carry GEOS's licence, which is this package's `LICENSE` file, and point to its source. The [LGPL playbook](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/licensing-lgpl.md) covers the rest, such as keeping the WebAssembly a separate, replaceable file.

GEOS Homepage: [https://libgeos.org/](https://libgeos.org/)
