# @crossbind/port-sqlite3
**Precompiled SQLite3 database engine built with crossbind for seamless integration in JavaScript, WebAssembly and React Native projects.**

<a href="https://www.npmjs.com/package/@crossbind/port-sqlite3">
    <img alt="NPM version" src="https://img.shields.io/npm/v/@crossbind/port-sqlite3?style=for-the-badge" />
</a>
<a href="https://www.sqlite.org/">
    <img src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Funpkg.com%2F%40crossbind%2Fport-sqlite3%2Fpackage.json&query=%24.nativeVersion&style=for-the-badge&label=SQLite" />
</a>
<a href="https://www.sqlite.org/copyright.html">
    <img alt="License" src="https://img.shields.io/badge/license-Public%20Domain-blue?style=for-the-badge" />
</a>

> Use it together with **[crossbind](https://crossbind.dev)** — the toolchain for using C++ libraries from JavaScript, TypeScript, WebAssembly, Node.js and React Native. Learn more at **[crossbind.dev](https://crossbind.dev)**.

## See it run
Three apps on **[crossbind.dev/ports/sqlite3](https://crossbind.dev/ports/sqlite3/#apps)** run this package in your browser, each with a small C++ wrapper next to SQLite:

- **Search the site as you type.** Every section of crossbind.dev's guide, reference, library and changelog pages goes into an FTS4 index in the tab. A BM25 function written in C++ and registered with `sqlite3_create_function` ranks the matches, because FTS4 has no ranking of its own.
- **Ask 50,000 points what is inside a box.** SQLite's R\*Tree answers a box query, and the same query runs against a B-tree index on x and a table with no index, each timed in the tab next to its query plan. The box 400–599 × 400–599 holds 2,018 of the points.
- **Open any SQLite file, privately.** A `.sqlite` or `.db` file, a GeoPackage or an MBTiles file opens read-only as an immutable database: its tables, SQL on it, CSV export and a compacted `VACUUM INTO` copy. The generated sample of 100,000 API requests answers p95 latency per route with SQLite's `percentile()`: 1,062.6 ms for `/search`.

Their C++ wrappers, and the self-check the site build runs against answers computed independently of this package, are in [`landing/demos/lib-sqlite3`](https://github.com/crossbind/crossbind/tree/main/landing/demos/lib-sqlite3).

## Integration
Install the main package together with the platform builds:

```sh
npm install @crossbind/port-sqlite3 @crossbind/port-sqlite3-wasm @crossbind/port-sqlite3-android @crossbind/port-sqlite3-ios
```

Then import all three platforms in `crossbind.config.js` — crossbind compiles only the one matching each build target:

```diff
+import sqlite3Wasm from '@crossbind/port-sqlite3-wasm/crossbind.config.js';
+import sqlite3Android from '@crossbind/port-sqlite3-android/crossbind.config.js';
+import sqlite3Ios from '@crossbind/port-sqlite3-ios/crossbind.config.js';

export default {
    dependencies: [
+        sqlite3Wasm,
+        sqlite3Android,
+        sqlite3Ios,
    ],
    paths: {
        config: import.meta.url,
    }
};
```

A native Node.js addon links the build of its platform: `crossbind build -p darwin`, `-p linux`, `-p linuxmusl` or `-p win32` takes `@crossbind/port-sqlite3-darwin`, `-linux`, `-linuxmusl` or `-win32`; `-linuxmusl` is the one for Alpine and other musl distributions. Install it and import its `crossbind.config.js` the same way.

## Usage
crossbind binds your C++ headers to JavaScript, so the usual pattern is a small wrapper around the library. This one stores notes and finds them again with prepared statements. Put it in your project's native folder (`src/native/` by default):

```cpp
// src/native/notes.h
#pragma once

#include <sqlite3.h>

#include <memory>
#include <stdexcept>
#include <string>

// Notes in an in-memory SQLite database. Values reach SQL only as bound parameters (?1), never by
// pasting them into the statement, so a quote inside a note is data, not SQL.
class Notes {
public:
    Notes() {
        if (sqlite3_open(":memory:", &db) != SQLITE_OK) throw std::runtime_error("cannot open the database");
        run("create table notes(id integer primary key, body text not null)");
    }

    ~Notes() { sqlite3_close(db); }

    static std::string version() { return sqlite3_libversion(); }

    // Inserts one note and returns its id.
    int add(const std::string& body) {
        Statement insert = prepare("insert into notes(body) values (?1)");
        sqlite3_bind_text(insert.get(), 1, body.c_str(), static_cast<int>(body.size()), SQLITE_TRANSIENT);
        if (sqlite3_step(insert.get()) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return static_cast<int>(sqlite3_last_insert_rowid(db));
    }

    int count() {
        Statement query = prepare("select count(*) from notes");
        return sqlite3_step(query.get()) == SQLITE_ROW ? sqlite3_column_int(query.get(), 0) : 0;
    }

    // Every note containing `word`, oldest first, one "id: body" line each.
    std::string find(const std::string& word) {
        Statement query = prepare("select id, body from notes where body like '%' || ?1 || '%' order by id");
        sqlite3_bind_text(query.get(), 1, word.c_str(), static_cast<int>(word.size()), SQLITE_TRANSIENT);
        std::string lines;
        int result;
        while ((result = sqlite3_step(query.get())) == SQLITE_ROW) {
            const int id = sqlite3_column_int(query.get(), 0);
            const char* body = reinterpret_cast<const char*>(sqlite3_column_text(query.get(), 1));
            lines += (lines.empty() ? "" : "\n") + std::to_string(id) + ": " + body;
        }
        if (result != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(db));
        return lines;
    }

private:
    // Finalizes the statement however the method returns.
    using Statement = std::unique_ptr<sqlite3_stmt, int (*)(sqlite3_stmt*)>;

    Statement prepare(const char* sql) {
        sqlite3_stmt* statement = nullptr;
        if (sqlite3_prepare_v2(db, sql, -1, &statement, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
        return Statement(statement, sqlite3_finalize);
    }

    void run(const char* sql) {
        char* message = nullptr;
        if (sqlite3_exec(db, sql, nullptr, nullptr, &message) == SQLITE_OK) return;
        const std::string reason = message ? message : "unknown error";
        sqlite3_free(message);
        throw std::runtime_error(reason);
    }

    sqlite3* db = nullptr;
};
```

Then call it from JavaScript:

```js
import { initNative, Notes } from './native/notes.h';

await initNative();
const notes = await new Notes();
for (const body of ['buy milk', 'write the README', "fix the parser's bug"]) await notes.add(body);
console.log(await Notes.version(), await notes.count()); // 3.53.4 3
console.log(await notes.find('the'));
// 2: write the README
// 3: fix the parser's bug
```

- Values reach SQL as bound parameters (`?1` and `sqlite3_bind_text`), never pasted into the statement, so the apostrophe in "parser's" is data. `SQLITE_TRANSIENT` has SQLite copy the string during the call.
- `Statement` is a `std::unique_ptr` with `sqlite3_finalize` as its deleter, so every prepared statement is finalized however the method returns, exceptions included.
- A failing call throws `std::runtime_error` with `sqlite3_errmsg`, and JavaScript receives it as an `Error`. On WebAssembly `error.message` starts with the C++ type (`std::runtime_error: …`) and `error.cppMessage` holds SQLite's text alone.
- `:memory:` keeps the database in memory. For a file, open a path instead: in the browser a path in the module's filesystem (`/memfs/…`, or `/opfs/…` with `useWorker: true`), on Android and iOS a path in the app's storage, in a native Node.js addon any path of the file system.

### More examples
Each one runs in your browser on [crossbind.dev/ports/sqlite3](https://crossbind.dev/ports/sqlite3/#usage), next to the code shown there:

- [Apply a batch in one transaction](https://crossbind.dev/ports/sqlite3/#02-transaction): `BEGIN`, one prepared upsert (`ON CONFLICT DO UPDATE`) reset for every row, then `COMMIT`, or `ROLLBACK` when a row breaks a `CHECK` constraint.
- [Query JSON documents with SQL](https://crossbind.dev/ports/sqlite3/#03-json): `->>`, `json_each`, `json_group_object` and `json_group_array`.
- [Search text with FTS4](https://crossbind.dev/ports/sqlite3/#04-search): `MATCH` with stemming, phrases, prefixes, `NOT` and `NEAR`, cut into `snippet()`s.
- [Save a database to bytes and open it again](https://crossbind.dev/ports/sqlite3/#05-serialize): `sqlite3_serialize` and `sqlite3_deserialize`, then the tables listed with `pragma_table_info`.

Setup and differences per platform: [WebAssembly](https://crossbind.dev/ports/sqlite3/wasm/) · [Android](https://crossbind.dev/ports/sqlite3/android/) · [iOS](https://crossbind.dev/ports/sqlite3/ios/) · [macOS](https://crossbind.dev/ports/sqlite3/darwin/) · [Linux](https://crossbind.dev/ports/sqlite3/linux/) · [Windows](https://crossbind.dev/ports/sqlite3/win32/) · [WASI](https://crossbind.dev/ports/sqlite3/wasi/), which also has a command-line program built with `crossbind build -p wasi`.

## What this build includes
- SQLite 3.53.4, built from the amalgamation as a static library. The recipe passes the same `SQLITE_ENABLE_*` options to every platform; the WebAssembly and WASI builds report them as below.
- Full-text search with FTS3 and FTS4, including the porter and unicode61 tokenizers. FTS5 is not compiled in: `CREATE VIRTUAL TABLE … USING fts5` fails with `no such module: fts5`.
- R\*Tree indexes (`rtree`, `rtree_i32`), the math functions (`sqrt`, `ln`, `pow`, …) and `median`, `percentile`, `percentile_cont` and `percentile_disc`.
- Column metadata (`sqlite3_table_column_metadata`) and `sqlite3_normalized_sql`.
- From SQLite's core: JSON and JSONB functions, window functions, upsert, `RETURNING`, `VACUUM INTO` and `sqlite3_serialize` / `sqlite3_deserialize`.
- Not compiled in: the session extension (changesets), geopoly, dbstat and dbpage.
- The WebAssembly builds are thread-safe (`THREADSAFE=1`), and `load_extension()` answers `not authorized` there. The WASI build is single-threaded (`THREADSAFE=0`) and leaves extension loading out (`OMIT_LOAD_EXTENSION`).

## Supported platforms
This is the main package; the precompiled binaries are shipped per platform:

| Platform | Package | Targets |
|---|---|---|
| WebAssembly | [`@crossbind/port-sqlite3-wasm`](https://www.npmjs.com/package/@crossbind/port-sqlite3-wasm) | `wasm32` — single-threaded & multi-threaded |
| Android | [`@crossbind/port-sqlite3-android`](https://www.npmjs.com/package/@crossbind/port-sqlite3-android) | `arm64-v8a` (64-bit ARM), `x86_64` (emulator) |
| iOS | [`@crossbind/port-sqlite3-ios`](https://www.npmjs.com/package/@crossbind/port-sqlite3-ios) | device (`arm64`), simulator (`arm64`) |
| macOS | [`@crossbind/port-sqlite3-darwin`](https://www.npmjs.com/package/@crossbind/port-sqlite3-darwin) | `arm64` (Apple silicon), `x64` (Intel) — native Node.js addons |
| Linux | [`@crossbind/port-sqlite3-linux`](https://www.npmjs.com/package/@crossbind/port-sqlite3-linux) | `x64`, `arm64` — glibc 2.28 or later, native Node.js addons |
| Windows | [`@crossbind/port-sqlite3-win32`](https://www.npmjs.com/package/@crossbind/port-sqlite3-win32) | `x64`, `arm64` — Windows 10 or later, native Node.js addons |
| WASI library | [`@crossbind/port-sqlite3-wasi`](https://www.npmjs.com/package/@crossbind/port-sqlite3-wasi) | `wasm32-wasip3` — single-threaded |
| WASI command | [`@crossbind/port-sqlite3-standalone-wasi`](https://www.npmjs.com/package/@crossbind/port-sqlite3-standalone-wasi) | the upstream `sqlite3` shell as a `sqlite3-wasi` command (wasmtime 47+), marked experimental |

## License
This project includes the precompiled SQLite3 library, which is released into the [public domain](https://www.sqlite.org/copyright.html).

SQLite Homepage: [https://www.sqlite.org/](https://www.sqlite.org/)
