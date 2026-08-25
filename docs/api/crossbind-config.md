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
    // Array of crossbind.config.js values, imported from @crossbind/port-*.
    // Example:
    //   import gdal from '@crossbind/port-gdal/crossbind.config.js'
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
    // Crates importable via the `cargo:` scheme (`import { Uuid } from 'cargo:uuid'`)
    // or used by app-local .rs sources. Keys are crate names, values are
    // Cargo.toml dependency specs as strings. Undeclared `cargo:` imports are
    // a hard error. See rust.md.

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

    bindings: {
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
  },

  targetSpecs: [
    {
      // Filter (any combination — entry matches if all set fields match)
      platform:   'wasm' | 'wasi' | 'android' | 'ios',     // optional
      arch:       'wasm32' | 'wasm64' | 'arm64-v8a' | 'x86_64' | 'iphoneos' | 'iphonesimulator',
      runtime:    'st' | 'mt',
      buildType:  'release' | 'debug',
      runtimeEnv: 'browser' | 'node' | 'edge',

      // Overrides (apply when filter matches)
      specs: {
        cmake:         ['-DSOMETHING=ON'],         // -D flags appended to cmake configure
        emccFlags:     ['-sINITIAL_MEMORY=64MB'],  // -s/-O flags appended to emcc (wasm only)
        env:           { GDAL_NUM_THREADS: '0' },  // env vars passed to running Wasm + build env
        data:          { 'share/myapp': 'myapp/data' },  // bundle data files into .data preload
          // On platform 'wasi', env/data double as the runtime contract for the
          // -bin command runner: data dirs become --dir preopens, env becomes
          // guest env (`_CROSSBIND_DATA_PATH_` placeholder → the mounted /data).
        ignoreLibName: ['libtiff_legacy'],         // suppress these .a names from link line
    wasiFlags:     ['-Wl,--stack-first'],      // flags appended to the wasi command link (platform 'wasi' only; see wasi.md)
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
import gdal from '@crossbind/port-gdal/crossbind.config.js'

export default {
  general: { name: 'my-geo-app' },
  dependencies: [gdal],
  paths: { config: import.meta.url },
}
```

### Multithread browser app

```js
import gdal from '@crossbind/port-gdal/crossbind.config.js'

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

- [`init.md`](./init.md) — runtime API. `crossbind.config.js` produces the artifacts that `init(opts)` loads.
- [`crossbind-build.md`](./crossbind-build.md) — sibling file used by package authors only.
- [`rust.md`](./rust.md) — Rust bindings: `cargo:` imports, app-local `.rs`, `export.type: 'cargo'` packages.
- [`wasi.md`](./wasi.md) — `platform: 'wasi'` command builds + `-bin-wasi` tool packages.
- [`threading.md`](./threading.md) — `target.runtime: 'mt'` requirements.
- ADR-0002 — pnpm topological build order via `dependencies`.
- ADR-0003 — function-typed env values.
