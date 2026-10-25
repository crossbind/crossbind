<!-- GENERATED from docs/api/crossbind-config.md by scripts/build-agent-skill.mjs. Do not edit. -->

# `crossbind.config.js` — Build-time Configuration

> **Build-time only.** Read once by the `crossbind build` CLI. NOT consumed at runtime. Runtime configuration lives in [`init.md`](./init.md).

Every consumer (app or library) writes a `crossbind.config.js` at the project root. It declares dependencies, source paths, build target, and export shape — everything the CLI needs to compile and package your C++.

## Shape

```js
export default {
  // ─────────────────────────────────────────────────────────────
  // General identity
  // ─────────────────────────────────────────────────────────────
  general: {
    name: 'myapp',
      // Logical app/lib name. Used for:
      //   - Output binary names (lib<name>.a, <name>.xcframework)
      //   - Browser fs namespace: /opfs/<name>/, /memfs/<name>/
      // Defaults to fixPackageName(package.json.name) or 'crossbindsample'.
  },

  // ─────────────────────────────────────────────────────────────
  // Other crossbind packages this project depends on
  // ─────────────────────────────────────────────────────────────
  dependencies: [],
    // Array of crossbind.config.js values, imported from platform variants such as
    // @crossbind/port-*-wasm, -android, -ios, -darwin, -linux, -linuxmusl, -win32 or -wasi. The meta package
    // (@crossbind/port-*) carries no config; list one variant per platform you build.
    // Example:
    //   import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js'
    //   dependencies: [gdal]
    //
    // Transitive deps are automatically flattened into config.allDependencies.
    // If ANY dep declares target.runtime === 'mt', this project auto-promotes
    // to 'mt' too.

  // ─────────────────────────────────────────────────────────────
  // Rust crates this project consumes (the cargo store axis)
  // ─────────────────────────────────────────────────────────────
  cargoDependencies: {
    uuid: '{ version = "1", features = ["v4"] }',
    semver: '1',
  },
    // Crates importable via the `cargo:` scheme (`import { Uuid } from 'cargo:uuid'`,
    // or one public module: 'cargo:xxhash-rust/xxh3') or used by app-local .rs
    // sources. Keys are crate names, values are Cargo.toml dependency specs as
    // strings. Undeclared `cargo:` imports are a hard error. See rust.md.

  // ─────────────────────────────────────────────────────────────
  // C and C++ packages this project takes from ConanCenter
  // ─────────────────────────────────────────────────────────────
  conanDependencies: {
    zlib: '1.3.2',
    sqlite3: { version: '3.53.4', options: { enable_fts5: true } },
  },
    // Packages whose headers are importable via the `conan:` scheme
    // (`import { zlibVersion } from 'conan:zlib/zlib.h'`) and usable from your
    // own headers. Keys are Conan package names; values are a version, a Conan
    // range ('[>=1.3 <2]') or { version, options }. Web builds only for now.
    // Undeclared `conan:` imports are a hard error. See conan.md.

  // ─────────────────────────────────────────────────────────────
  // Generated .d.ts flavor
  // ─────────────────────────────────────────────────────────────
  dts: 'sync',
    // 'sync' (default) types the direct binding surface. 'promise' wraps every
    // generated method/function return in Promise<...> - use it when your app
    // runs with initNative({ useWorker: true }) (or any async bridge), where
    // every call resolves asynchronously at runtime. Constructors stay
    // sync-typed either way; write `await new X(...)` (a no-op on sync
    // runtimes, required under a worker). See lifecycle-and-types.md.

  types: false,
    // Package type publishing (opt-in): emit one combined .d.ts over every
    // public header into <output>/types/index.d.ts and wire package.json
    // (`types` + a greedy `typesVersions` "*.h" map), so consumers importing
    // '<pkg>/<any>.h' get full types. Combine with dts: 'promise' for
    // worker-first packages.

  // ─────────────────────────────────────────────────────────────
  // Paths (all relative to paths.project; see resolution rules below)
  // ─────────────────────────────────────────────────────────────
  paths: {
    config: import.meta.url,
      // ALWAYS SET THIS. Anchors all relative paths to this file's location.

    project: undefined,
      // Project root. Defaults to the dir of paths.config (or cwd if neither set).

    base: undefined,
      // Alternative project root override. Used by examples to point above
      // the workspace boundary in the monorepo.

    cache:  '.crossbind',                 // build cache root
    build:  '.crossbind/build',           // staging dir
    output: '.crossbind/build',           // dist artifacts (defaults to build)

    native: ['src/native'],
      // ARRAY. C++ source roots. Order matters for include precedence.

    module: undefined,                // SWIG .i interfaces; defaults to native
    header: undefined,                // headers; defaults to native
    bridge: undefined,                // bridge code; defaults to [...native, build]
    cmake:  undefined,                // override CMakeLists.txt path
  },

  // ─────────────────────────────────────────────────────────────
  // File extension filters
  // ─────────────────────────────────────────────────────────────
  ext: {
    header: ['h', 'hpp', 'hxx', 'hh'],
    source: ['c', 'cpp', 'cxx', 'cc'],
    module: ['i'],   // SWIG interfaces
  },

  // ─────────────────────────────────────────────────────────────
  // Export (output) settings
  // ─────────────────────────────────────────────────────────────
  export: {
    type: 'cmake',
      // 'cmake' — default; the C/C++ pipeline.
      // 'cargo' — the project is a Rust crate: crossbind runs `cargo build
      //           --release --target <triple>` per platform (wasm/android/ios;
      //           wasi has no wasip3 Rust target yet and is skipped) and
      //           stages the .a like any prebuilt. See rust.md.

    crate: '.',
      // 'cargo' type only: directory holding Cargo.toml, relative to project.

    header:  'include',          // include dir name in dist
    libPath: 'lib',              // .a output dir
    libName: ['<general.name>'], // .a basenames; one per item
    binHeaders: [],              // headers to ship as raw binary blobs

    headerPrelude: [],
      // Headers #included ahead of a public header of this package when one is imported from
      // JavaScript, for libraries whose headers are not self-contained (spatialite needs sqlite3.h
      // first). An array applies to every header; an object keys lists by include path, '*'
      // applying to all: { '*': ['cpl_port.h'], 'gdal_multidim.h': ['gdal_rat.h'] }. SWIG still
      // wraps only the imported header. The headers defining the classes it holds in
      // std::unique_ptr are found in the package and included after it automatically, and the
      // headers defining the classes and enums its declarations use are bound into the same module.

    ignoredDeclarations: [],
      // Declarations of this package's public headers that JavaScript bindings leave out, for
      // declarations the library never defines: GDAL declares VRTAverageFilteredSource but never
      // implements it, so its bindings cannot link. Entries are SWIG %ignore names, in the forms
      // headerPrelude takes: { 'vrtdataset.h': ['VRTAverageFilteredSource'] }.

    swigPreamble: {},
      // SWIG preprocessor lines put right before a public header of this package, in the forms
      // headerPrelude takes. GDAL keeps its C SRS API behind `#ifndef SWIG` for its own bindings
      // ('ogr_srs_api.h': ['#undef SWIG']), and makes VSIStatBufL a typedef or a macro by whether
      // the platform defines VSI_STAT64_T: defining it as itself ('cpl_vsi.h':
      // ['#define VSI_STAT64_T VSI_STAT64_T']) keeps the name, so each platform's compiler resolves it.

    swigInlineIncludes: {},
      // Includes SWIG reads inlined into a public header of this package, keyed by the header's
      // include path. SWIG reads no #include, so libgeotiff, which fills its key and code enums from
      // .inc files included inside the enum bodies, lists
      // { 'geokeys.h': ['geokeys.inc', 'geokeys_v1_1.inc'] }. SWIG reads a copy with each listed
      // #include line replaced by that file's text, so its warnings give the copy's line numbers; the
      // compiler still includes the real header. A listed name the header does not include fails the
      // build.

    publicHeaders: [],
      // The headers of this package's public API, by include path: ['zlib.h']. A package that names
      // this one in bindings.headers binds these.

    bindings: {
      headers: [],
        // Dependency headers bound into this package's Node.js addons with every function and constant,
        // as `import * as` binds them in an app: a header path ('@crossbind/port-zlib/zlib.h'), or a
        // package name standing for the headers it lists in publicHeaders. Their names join the
        // project's own in <output>/node/napi.mjs, the entry that exports each one once initNative()
        // resolves, with its declarations in napi.d.mts; the @crossbind/port-<name>-standalone-napi
        // packages export it as their root. Addons in <package>-<platform>-<arch> packages listed as
        // optionalDependencies are found there.

      // Rust binding-surface additions (see rust.md).
      vectors: [{ of: 'i32', name: 'RustIntVector' }],
        // Standalone Vec<T> classes to expose without touching Rust source.
    },

    wholeArchive: false,
      // By default only the generated Bridge archive is linked with
      // --whole-archive; every other archive is dead-code-eliminated down to
      // what the bridge actually reaches. Set true on an APP to restore the
      // legacy layout (every archive linked wholesale), or on a PACKAGE's own
      // config when its members self-register from static initializers and
      // must never be stripped.
  },

  // ─────────────────────────────────────────────────────────────
  // Build target / runtime
  // ─────────────────────────────────────────────────────────────
  target: {
    runtime: 'st',
      // 'st' (single-threaded) | 'mt' (multi-threaded WASM)
      // 'mt' requires SharedArrayBuffer + COOP/COEP in browser production.
      // See threading.md for the full requirements.
      //
      // Auto-promotes to 'mt' if any item in `dependencies` is 'mt'.

    runtimeEnv: undefined,
      // The binary a build makes: 'browser' | 'edge' | 'node' | 'native' | 'wasi' | 'http' | 'app'.
      // Usually left unset - bundler plugins pick their own, and on the command
      // line -e picks one or more and wins over this. With neither, `crossbind
      // build` makes only the static archives in <paths.output>/prebuilt/<target>/.
      // 'node' is a wasm module under -p wasm and a Node-API addon under -p
      // darwin, linux, linuxmusl or win32; 'native' is an executable on those
      // four (see native.md). Under -p wasi, 'wasi' is a command and 'http' a
      // wasi:http/service component (see wasi.md). 'app' is an app's host under
      // -p darwin or linux, an Xcode project under -p ios and a Gradle project
      // under -p android; set here, it also turns the Vite plugin's build into
      // the app's (see app.md).
  },

  // ─────────────────────────────────────────────────────────────
  // App identity (target.runtimeEnv: 'app', see app.md)
  // ─────────────────────────────────────────────────────────────
  app: {
    id: 'com.example.myapp',
      // The bundle id of a macOS or iOS app, and the application id of an Android app, which takes no hyphens.
      // Default: dev.crossbind.<general.name>, on Android with an underscore for each hyphen.
    team: 'ABCDE12345',
      // The Apple team that signs an iOS app. Default: XCODE_DEVELOPMENT_TEAM of ~/.crossbind.json.
    name: 'My App',
      // The name the app shows: its window's title, its macOS menus, its Windows file description and the label
      // under its icon on iOS and Android. Text without a quotation mark, a backslash or a control character.
      // Default: general.name.
    copyright: '© 2026 Example Inc.',
      // The copyright line a macOS app's About panel and a Windows executable's details show, text as app.name is.
      // Default: none.
    category: 'developer-tools',
      // One of Apple's app categories, as public.app-category.<category> names them: macOS shows the app under it,
      // and a Linux menu under the freedesktop category closest to it (see app.md). Default: none.
    window: { width: 1024, height: 768, minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0, resizable: true, fullscreen: false, backgroundColor: '#1e1e1e' },
      // The desktop window, these being the defaults but for backgroundColor: the size of its page in pixels (up to
      // 16384), the least it shrinks to and the most it grows to (0: no limit), whether it resizes and whether it
      // opens full screen. A limit needs a window that resizes. backgroundColor, as #rrggbb, is what the app shows
      // until its page paints and behind a page without a background of its own, on iOS and Android as well; without
      // it, the system's.
    singleInstance: true,
      // Keeps a desktop app to one instance for each user: a later launch hands it its arguments, and it brings its
      // window to the front and tells its page (see app.md). Default: false, or on Windows and Linux true with
      // app.urlSchemes.
    urlSchemes: ['myapp'],
      // The schemes whose links open the app, as myapp://… does: lowercase, and none the web or the system owns. The
      // page gets them from app.launchUrls() and as the event open-url (see app.md). Default: [], none.
    permissions: { camera: 'To scan barcodes', microphone: 'To record voice notes', location: 'To find the nearest store' },
      // The devices the page may use through getUserMedia() and navigator.geolocation, each with the reason for it,
      // which iOS shows its user when it asks (see app.md). Default: {}, none.
    openPath: ['logs', 'picked'],
      // Where the page's shell.openPath opens files (see app.md): 'data', 'cache' and 'logs', the app's folders,
      // and 'picked', what a dialog picked during this run. Opening a program runs it. Default: [], nowhere.
    icon: 'icon.png',
      // A square PNG, at best 1024 × 1024, from which the build makes each platform's icon (see app.md).
      // Default: the system's.
    updater: {
      url: 'https://example.com/updates/<name>-{platform}-{arch}.update.json',
        // The manifest a desktop app checks for a newer version: https, or http on localhost. {platform} and {arch}
        // stand for darwin, linux or win32 and x64 or arm64; the update's file goes beside it (see app.md).
      publicKey: '…',
        // The Ed25519 key that checks an update's signature, which `crossbind app updater-key` prints. Its private
        // half, in CROSSBIND_UPDATER_PRIVATE_KEY, signs the updates the build writes.
    },
      // Default: none, and the app does not update itself.
  },

  targetSpecs: [
    {
      // Filter (any combination — entry matches if all set fields match)
      platform:   'wasm' | 'wasi' | 'android' | 'ios' | 'darwin' | 'linux' | 'linuxmusl' | 'win32',     // optional
      arch:       'wasm32' | 'wasm64' | 'arm64-v8a' | 'x86_64' | 'iphoneos' | 'iphonesimulator' | 'arm64' | 'x64',
      runtime:    'st' | 'mt',
      buildType:  'release' | 'debug',
      runtimeEnv: 'browser' | 'node' | 'edge',

      // Overrides (apply when filter matches)
      specs: {
        cmake: {
          compileOptions: ['-DMYAPP_NO_LOGGING=1'], // compiler flags for the sources crossbind compiles itself (see overrides.md)
        },
        binary: {
          emccFlags:   ['-sINITIAL_MEMORY=64MB'],  // -s/-O flags for emcc (wasm only); they follow the default -O3, so -Oz or -Os wins
          wasiFlags:   ['-Wl,--stack-first'],      // flags appended to the wasi command link (platform 'wasi' only; see wasi.md)
          addonFlags:  ['-lxml2'],                 // system libraries a native addon or executable link needs (platforms 'darwin', 'linux', 'linuxmusl', 'win32'); dependencies' flags add up
        },
        env:           { GDAL_NUM_THREADS: '0' },  // env vars of the running module; a value may be a function of (state, target); the app's value beats a dependency's
        data:          { 'share/myapp': 'myapp/data' },  // bundle data files into .data preload
          // On platform 'wasi', env/data double as the runtime contract for the
          // -bin command runner: data dirs become --dir preopens, env becomes
          // guest env (`_CROSSBIND_DATA_PATH_` placeholder → the mounted /data).
        ignoreLibName: ['libtiff_legacy'],         // suppress these .a names from link line
      },
    },
  ],
    // See `overrides.md` for the catalog of override mechanisms and when
    // to reach for `targetSpecs` vs `crossbind.build.js` hooks vs `extensions`.

  // ─────────────────────────────────────────────────────────────
  // Build hooks (merged from crossbind.build.js if present)
  // ─────────────────────────────────────────────────────────────
  build: {},
    // Don't write this here directly. Put hooks in crossbind.build.js — the
    // CLI auto-merges. See crossbind-build.md.

  // ─────────────────────────────────────────────────────────────
  // Plugin / extension system
  // ─────────────────────────────────────────────────────────────
  extensions: [
    {
      loadConfig: {
        after: (config) => { /* mutate resolved config after load */ },
      },
      buildWasm: {
        beforeBuild:        (emccFlags) => {},   // all wasm targets — mutate emccFlags array
        beforeBuildBrowser: (emccFlags) => {},   // browser runtimeEnv only
        beforeBuildEdge:    (emccFlags) => {},   // edge runtimeEnv only
        beforeBuildNodeJS:  (emccFlags) => {},   // node runtimeEnv only
      },
      createLib: {
        setFlagWithBuildConfig:    (buildEnv, cFlags, ldFlags) => {},  // tweak CFLAGS/LDFLAGS
        setFlagWithoutBuildConfig: (buildEnv) => {},                   // env-level override
      },
    },
  ],
    // Plugin objects with hooks at config-load and build-step boundaries.
    // Use only when sharing an override across multiple crossbind packages —
    // for single-package needs, prefer `targetSpecs` or `crossbind.build.js`.
    // Real example: OpenSSL Android cert-injection extension.

  // ─────────────────────────────────────────────────────────────
  // Custom helper functions
  // ─────────────────────────────────────────────────────────────
  functions: {
    isEnabled: (target) => boolean,
      // Override the default "is this build target enabled?" check.
      // Default: returns true if the target's output binary already exists.
  },
}
```

## Path resolution rules

Paths are resolved in this order (from `loadConfig.js`):

1. `paths.config` is set → `paths.project` defaults to its parent dir.
2. `paths.project` is set → resolved as absolute via `getAbsolutePath`.
3. Neither set → falls back to `process.cwd()`.

Then everything else (`base`, `cache`, `build`, `output`, `native`, `module`, `header`, `bridge`, `cmake`) is resolved against `paths.project` using `getAbsolutePath(project, value)`.

This means: **always set `paths.config: import.meta.url`** at minimum. Without it, `crossbind build` invoked from a different cwd will resolve paths against the wrong root.

## Examples

### Minimal app (consumes a prebuilt package)

```js
// crossbind.config.js
import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js'

export default {
  general: { name: 'my-geo-app' },
  dependencies: [gdal],
  paths: { config: import.meta.url },
}
```

### Multithread browser app

```js
import gdal from '@crossbind/port-gdal-wasm/crossbind.config.js'

export default {
  general: { name: 'my-fast-app' },
  dependencies: [gdal],
  paths: { config: import.meta.url },
  target: { runtime: 'mt' },
  // Remember: prod host needs COOP/COEP headers.
}
```

### Library wrapping your own C++

```js
export default {
  general: { name: 'mylib' },
  paths: {
    config: import.meta.url,
    native: ['src/native'],
    output: 'dist',
  },
  export: {
    type: 'cmake',
    libName: ['mylib'],
  },
}
```

### Monorepo example (above-workspace project root)

```js
import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js'

export default {
  general: { name: 'crossbind-example-web-vue-vite' },
  dependencies: [Matrix],
  paths: {
    config: import.meta.url,
    base: '../..',  // points above the workspace boundary
  },
}
```

## See also

- [`init.md`](./init.md) — runtime API. `crossbind.config.js` produces the artifacts that `initNative(opts)` loads.
- [`crossbind-build.md`](./crossbind-build.md) — sibling file used by package authors only.
- [`rust.md`](./rust.md) — Rust bindings: `cargo:` imports, app-local `.rs`, `export.type: 'cargo'` packages and `crossbind.cargo.lock`.
- [`conan.md`](./conan.md) — C and C++ packages from ConanCenter: `conan:` imports and `conan.lock`.
- [`wasi.md`](./wasi.md) — `platform: 'wasi'` command builds + `-standalone-wasi` tool packages.
- [`threading.md`](./threading.md) — `target.runtime: 'mt'` requirements.
- ADR-0002 — pnpm topological build order via `dependencies`.
- ADR-0003 — function-typed env values.
