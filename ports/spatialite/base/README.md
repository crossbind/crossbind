# @crossbind/port-spatialite
**Precompiled SpatiaLite (spatial SQLite extension) library built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-spatialite">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-spatialite?style=for-the-badge" />
</a>
<a href="https://www.gaia-gis.it/fossil/libspatialite/index">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-spatialite%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=SpatiaLite" />
</a>
<a href="https://website-archive.mozilla.org/www.mozilla.org/mpl/MPL/boilerplate-1.1/mpl-tri-license-html">
    <img alt="License" src="https://img.shields.io/npm/l/%40crossbind%2Fport-spatialite?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/spatialite](https://crossbind.dev/ports/spatialite/#apps)** run this package in your browser:

- **Spatial SQL playground.** PostGIS-style SQL over 2,000 generated points of interest, with every geometry a query returns drawn as a map. A join through the R\*Tree index counts the points in each of 53 hexagons, the busiest holding 497; 289 points lie within 25 km of Istanbul on the ellipsoid; 5 km buffers around 66 parks merge into 6 zones covering 3,762.5 km².
- **Routing in SQL.** `CreateRouting` turns 718 streets into a network, and a `SELECT` returns the shortest path: 47.5 minutes over 38 streets across a 20 × 20 grid, and 47.75 once three of its streets are closed.
- **GeoPackage builder.** The points, their count per hexagon and the pins you drop on a map, written to one `.gpkg` with SpatiaLite's `gpkg` functions. GDAL's `validate_gpkg.py` passes the file and `ogrinfo` reads its three layers.

Their C++ wrappers, and the self-check the site build runs against values computed independently of this package, are in [`landing/demos/lib-spatialite`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-spatialite).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-spatialite @crossbind/port-spatialite-wasm @crossbind/port-spatialite-android @crossbind/port-spatialite-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import spatialiteWasm from '@crossbind/port-spatialite-wasm/crossbind.config.js';
+import spatialiteAndroid from '@crossbind/port-spatialite-android/crossbind.config.js';
+import spatialiteIos from '@crossbind/port-spatialite-ios/crossbind.config.js';

export default {
    dependencies: [
+        spatialiteWasm,
+        spatialiteAndroid,
+        spatialiteIos,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux` or `-p win32` takes `@crossbind/port-spatialite-darwin`, `-linux` or `-win32`. Install it and import its `crossbind.config.js` the same way.

> In a web build, list only `spatialiteWasm` for now: with the Android or iOS config beside it, the build also tries to preload their PROJ data and fails. See [known issues](https://github.com/crossbind/crossbind/blob/main/docs/known-issues.md).

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. SpatiaLite is used through SQL: this wrapper opens an in-memory SQLite database, registers SpatiaLite's functions on it, and runs SQL. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/spatial_database.h
#pragma once

// spatialite.h uses SQLite's types without including sqlite3.h, so sqlite3.h comes first.
#include <sqlite3.h>
#include <spatialite.h>

#include <stdexcept>
#include <string>

// An in-memory SQLite database with SpatiaLite's spatial SQL functions registered on it.
class SpatialDatabase {
public:
    SpatialDatabase() {
        if (sqlite3_open(":memory:", &handle) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        cache = spatialite_alloc_connection();
        spatialite_init_ex(handle, cache, 0);
    }

    ~SpatialDatabase() {
        sqlite3_close(handle);
        spatialite_cleanup_ex(cache);
    }

    static std::string version() { return spatialite_version(); }

    void exec(const std::string& sql) {
        char* message = nullptr;
        if (sqlite3_exec(handle, sql.c_str(), nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : sqlite3_errmsg(handle);
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    // The first column of the first row as text, or "" when the query returns no row.
    std::string scalar(const std::string& sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(handle, sql.c_str(), -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(handle));
        const int step = sqlite3_step(statement);
        const unsigned char* text = step == SQLITE_ROW ? sqlite3_column_text(statement, 0) : nullptr;
        const std::string value = text ? reinterpret_cast<const char*>(text) : "";
        const std::string error = step == SQLITE_ROW || step == SQLITE_DONE ? "" : sqlite3_errmsg(handle);
        sqlite3_finalize(statement);
        if (!error.empty()) throw std::runtime_error(error);
        return value;
    }

private:
    sqlite3* handle = nullptr;
    void* cache = nullptr;
};
```

Then call it from JavaScript:

```js
import { initNative, SpatialDatabase } from './native/spatial_database.h';

await initNative();
const db = await new SpatialDatabase();
await db.exec(`
    SELECT InitSpatialMetaData(1, 'WGS84');
    CREATE TABLE cities (name TEXT NOT NULL);
    SELECT AddGeometryColumn('cities', 'geom', 4326, 'POINT', 'XY');
    INSERT INTO cities (name, geom) VALUES
        ('Istanbul', GeomFromText('POINT(28.9784 41.0082)', 4326)),
        ('Ankara', GeomFromText('POINT(32.8597 39.9334)', 4326)),
        ('Izmir', GeomFromText('POINT(27.1428 38.4237)', 4326));
`);
console.log(await SpatialDatabase.version(), await db.scalar('SELECT count(*) FROM cities')); // 5.1.0 3
console.log(await db.scalar(`
    SELECT group_concat(name || ' ' || km || ' km', ', ' ORDER BY km)
    FROM (SELECT name, CAST(Round(ST_Distance(geom, MakePoint(28.9784, 41.0082, 4326), 1) / 1000) AS INTEGER) AS km FROM cities)
`)); // Istanbul 0 km, Izmir 327 km, Ankara 350 km
```

- `spatialite_init_ex` registers SpatiaLite's SQL functions on one connection, and `InitSpatialMetaData` creates the metadata tables in the database. `'WGS84'` registers only the WGS 84 reference systems; `InitSpatialMetaData(1)` registers all 6,559, which `ST_Transform` to other systems needs.
- `ST_Distance(a, b, 1)` measures on the WGS 84 ellipsoid: PROJ's `geod` gives the same 327,266 m and 350,082 m. Without the third argument, distances between longitude/latitude points come out in degrees.
- SQLite's `trusted_schema` has to stay on, as it is by default: with it off, the first insert into a table from `AddGeometryColumn` fails with `unsafe use of GeometryConstraints()`.

### More examples
Each one runs in your browser on [crossbind.dev/ports/spatialite](https://crossbind.dev/ports/spatialite/#usage), next to the code shown there:

- [Find places in a map view and the nearest ones with a spatial index](https://crossbind.dev/ports/spatialite/#02-spatial-index): `CreateSpatialIndex`, the `SpatialIndex` virtual table with a `BuildMbr` box, and `KNN2` for the nearest rows with their distance in metres.
- [Measure areas and distances in metres](https://crossbind.dev/ports/spatialite/#03-measure): `ST_Area` and `ST_Distance` after `ST_Transform` to UTM zone 35N, and `ST_Distance(a, b, 1)` on the ellipsoid.
- [Reproject coordinates between EPSG codes](https://crossbind.dev/ports/spatialite/#04-transform): `ST_Transform` through PROJ, and the reference systems' names in `spatial_ref_sys`.
- [Read GeoJSON in and write a FeatureCollection out](https://crossbind.dev/ports/spatialite/#05-geojson): `GeomFromGeoJSON`, `AsGeoJSON` and SQLite's JSON functions.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/spatialite/wasm/) · [Android](https://crossbind.dev/ports/spatialite/android/) · [iOS](https://crossbind.dev/ports/spatialite/ios/) · [macOS](https://crossbind.dev/ports/spatialite/darwin/) · [Linux](https://crossbind.dev/ports/spatialite/linux/) · [Windows](https://crossbind.dev/ports/spatialite/win32/) · [WASI](https://crossbind.dev/ports/spatialite/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- SpatiaLite 5.1.0 with GEOS 3.15.0, PROJ 9.9.0 and SQLite 3.53.4, as `spatialite_version()`, `geos_version()`, `proj_version()` and `sqlite_version()` report them in the WebAssembly build.
- No RTTOPO and no GCP module (`--disable-rttopo --disable-gcp`). SpatiaLite's `configure` warns that either one makes the library GPL-only, so this build keeps the choice between its three licences. `ST_MakeValid`, `ST_Split`, `ST_Subdivide`, `CreateTopology` and the rest of the RTTOPO functions do not exist ("no such function"), and `ST_Area` takes no ellipsoid flag. `GeosMakeValid` repairs geometries instead: a self-crossing bowtie becomes two triangles of 25 square units each.
- The EPSG dataset compiled in: `InitSpatialMetaData(1)` fills `spatial_ref_sys` with 6,559 reference systems without reading a file.
- `ST_Transform` runs PROJ, which reads `proj.db`. The WebAssembly build preloads PROJ's data folder, 10,690,537 bytes, next to the module. A WASI build copies it to its output folder's `data/proj`, which the program needs mounted, with `PROJ_DATA` pointing at it; without it `ST_Transform` fails with `proj_create: no database context specified`.
- File functions only with `SPATIALITE_SECURITY=relaxed`: SpatiaLite registers `ExportGeoJSON2`, `ImportGeoJSON`, `BlobFromFile` and the other functions that touch files only when that variable is set as a connection initialises, and they read "no such function" otherwise. In the browser, `initNative({ env: { SPATIALITE_SECURITY: 'relaxed' } })` sets it; `ExportGeoJSON2` and `ImportGeoJSON` then write and read files in the module's file system.
- Spatial indexes (`CreateSpatialIndex`, the `SpatialIndex` and `KNN2` virtual tables), routing (`CreateRouting` and `VirtualRouting`), GEOS operations such as `ST_Union`, `ST_Buffer` and `VoronojDiagram`, and GeoPackage functions. `KNN2` ranks the rows inside a square of plus or minus `radius` CRS units around the point, so a radius too small for the nearest rows returns the wrong ones rather than none. `gpkgCreateBaseTables()` writes GeoPackage 1.0 (application id `GP10`), and GDAL's `validate_gpkg.py` rejects two details of its tables; the builder in `landing/demos/lib-spatialite` corrects them.
- The module behind the five examples and three apps is 14,103,626 bytes of WebAssembly and 145,505 bytes of JavaScript, plus the 10,690,537-byte PROJ preload: 24,939,668 bytes, or 6,005,191 with gzip.
- On WASI, SQLite is built without extension loading, which SpatiaLite still refers to: a program defines `sqlite3_enable_load_extension` itself, as the WASI example on crossbind.dev does.

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-spatialite-wasm`](https://www.npmjs.com/package/@crossbind/port-spatialite-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-spatialite-android`](https://www.npmjs.com/package/@crossbind/port-spatialite-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-spatialite-ios`](https://www.npmjs.com/package/@crossbind/port-spatialite-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-spatialite-darwin`](https://www.npmjs.com/package/@crossbind/port-spatialite-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-spatialite-linux`](https://www.npmjs.com/package/@crossbind/port-spatialite-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-spatialite-win32`](https://www.npmjs.com/package/@crossbind/port-spatialite-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-spatialite-wasi`](https://www.npmjs.com/package/@crossbind/port-spatialite-wasi) | `wasm32-wasip3` — single-threaded |

## License
This project includes the precompiled SpatiaLite library, which is distributed under the [MPL tri-license](https://website-archive.mozilla.org/www.mozilla.org/mpl/MPL/boilerplate-1.1/mpl-tri-license-html): MPL-1.1, GPL-2.0-or-later or LGPL-2.1-or-later, at your choice. RTTOPO and GCP are left out of this build because either would make it GPL-only.

SpatiaLite links GEOS (LGPL-2.1) and GNU libiconv (LGPL-2.1-or-later). An app that ships it conveys them too, a web app included: carry their licences and point to their sources. The [LGPL playbook](https://github.com/crossbind/crossbind/blob/main/docs/playbooks/licensing-lgpl.md) covers the rest, such as keeping the WebAssembly a separate, replaceable file.

SpatiaLite Homepage: [https://www.gaia-gis.it/fossil/libspatialite/index](https://www.gaia-gis.it/fossil/libspatialite/index)
