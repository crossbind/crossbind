# `state` and `target` shapes — what build hooks receive

> When you write a `crossbind.build.js` hook (`prepare(state)`, `build(state)`, `getBuildParams(state, target)`, etc.), or an `extensions[]` plugin, you receive a `state` object and a `target` object. This doc enumerates every key on both. Source: `core/crossbind/src/state/index.js`.

## `state` — top-level keys

```ts
state = {
    targets:               Target[],            // 30 built-in build targets (see § Target inventory)
    config:                ResolvedConfig,      // merged crossbind.config.js + crossbind.build.js + system
    cache:                 BuildCache,          // persisted to .crossbind/cache.json
    system:                SystemConfig,        // ~/.crossbind.json + defaults from systemKeys
}
```

### `state.config` (the resolved configuration)

The output of `loadConfig()` in `src/state/loadConfig.js`. Every key:

```ts
state.config = {
    general: { name: string },                  // package name; OPFS namespace = /opfs/<name>/

    dependencies: ResolvedConfig[],             // immediate crossbind deps (each is its own resolved config)
    allDependencies: ResolvedConfig[],          // flattened transitive deps, deduped by paths.project

    paths: {
        config:              string,            // import.meta.url of crossbind.config.js
        project:             string,            // absolute project root
        base:                string,            // = project unless overridden
        cache:               string,            // .crossbind (build cache root)
        build:               string,            // .crossbind/build (staging dir for sources)
        output:              string,            // dist artifacts dir
        native:              string[],          // C++ source roots (ARRAY)
        module:              string[],          // SWIG .i source roots
        header:              string[],          // C++ header roots
        bridge:              string[],          // bridge code roots = [...native, build]
        cmake:               string,            // resolved CMakeLists.txt path
        cmakeDir:            string,            // dirname of cmake
        cli:                 string,            // path to crossbind CLI install
        cliCMakeListsTxt:    string,            // bundled fallback CMakeLists.txt
        systemConfig:        string,            // = ~/.crossbind.json
    },

    ext: {
        header: string[],                       // ['h','hpp','hxx','hh']
        source: string[],                       // ['c','cpp','cxx','cc']
        module: string[],                       // ['i'] — SWIG interface extensions
    },

    export: {
        type:        'cmake' | 'source',        // distribution shape
        header:      string,                    // include dir name in dist
        libPath:     string,                    // .a output dir
        libName:     string[],                  // .a basenames (one per item; e.g. ['ssl','crypto'])
        binHeaders:  string[],                  // headers to ship as raw binary blobs
    },

    target: {                                   // FILTER (restrict which targets are built)
        platform?:    'wasm' | 'android' | 'ios',
        arch?:        string,                    // 'wasm32' | 'wasm64' | 'arm64-v8a' | …
        runtime?:     'st' | 'mt',
        buildType?:   'release' | 'debug',
        runtimeEnv?:  'browser' | 'node' | 'edge',
    },

    targetSpecs: TargetSpec[],                  // per-target overrides (see § targetSpecs)

    build: {                                    // merged from crossbind.build.js (package authors only)
        withBuildConfig:      boolean,           // true if a crossbind.build.js was loaded
        buildType?:           'cmake' | 'configure',
        setState?:            (state)         => void,
        beforeRun?:           (cmakeDir)      => Array<{program, parameters}>,
        getBuildParams?:      (state, target) => string[],
        getExtraLibs?:        (target)        => string[],
        sourceReplaceList?:   (target, depPaths) => Array<{regex, replacement, paths}>,
        env?:                 ((target) => string[]) | string[],
        copyToSource?:        Record<string, string[]>,
        copyToDist?:          Record<string, string[]>,
    },

    extensions: Extension[],                    // plugin hooks (see § Extensions)

    functions: {
        isEnabled: (target) => boolean,         // default: checks ${cmakeDir}/{target.path} or .xcframework exists
    },

    package: object | null,                     // parsed package.json of paths.project

    allDependencyPaths: {                       // per-target dependency lookup
        [target.path]: {
            cmake: { ... },
            [libName]: { root, header, libPath, lib, bin },
        },
    },

    dependencyParameters: ...,                  // CMake -D injection from calculateDependencyParameters()
}
```

### `state.cache`

Persisted to `.crossbind/cache.json` between builds:

```ts
state.cache = {
    hashes:     Record<string, string>,         // file hash → seen?
    interfaces: Record<string, string>,         // SWIG .i hash cache
    bridges:    Record<string, string>,         // bridge code cache
}
```

`isSourceNewer` checks mtime against this cache to decide whether to rebuild a target.

Alongside `cache.json`, the build writes fingerprint files next to its artifacts and
treats a mismatch as a cache miss even when the artifact exists:

- `…/prebuilt/<target>/crossbind-nativeglob.fingerprint` — the Bridge lib's bridge-file set
  (names + contents), so a lib built from a smaller bridge set cannot satisfy later builds.
- `…/prebuilt/<target>/crossbind-emccflags.fingerprint` — the config `emccFlags`, which also
  feed compile-time state (`CROSSBIND_JSPI`).
- `<jsName>.fingerprint` — the final link's inputs: resolved `emccFlags`, the lib list with
  each archive's size+mtime, the preloaded data map, the runtime assets bundled into
  the artifact (`assets/js-runtime` + `assets/cpp-runtime`, content-hashed), and the
  link layout (which archives are `--whole-archive`d — flipping `export.wholeArchive`
  relinks automatically).

Practical consequence: changing `emccFlags`, adding/removing a `.h` import, rebuilding a
dependency package, or editing the crossbind runtime itself re-links automatically — no manual
`.crossbind` clear needed for those. The CLI's `crossbind build` also no longer short-circuits on a
merely existing dist artifact; the link fingerprint decides there too (a wiped dist forces
a fresh link). A clear is still the answer when the toolchain itself changes (Docker
image / emsdk).

### `state.system`

Loaded from `~/.crossbind.json`, merged with defaults from `core/crossbind/src/utils/systemKeys.js`:

```ts
state.system = {
    XCODE_DEVELOPMENT_TEAM:  string,            // default ''  (required for iOS device builds)
    RUNNER:                  'DOCKER_RUN' | 'DOCKER_EXEC' | 'LOCAL',  // default 'DOCKER_RUN'
    LOG_LEVEL:               'DEBUG' | 'INFO' | 'WARN' | 'ERROR',     // default 'INFO'
    DOCKER_REGISTRY_MIRROR:  string,            // default ''  (registry prefix; crossbind appends the release digest)
    DOCKER_IMAGE_WEB:        string,            // default ''  (image for wasm and wasi builds)
    DOCKER_IMAGE_ANDROID:    string,            // default ''  (image for android builds)
}
```

## `target` — single build target

A single entry from `state.targets[]`. Every key:

```ts
target = {
    platform:     'wasm' | 'android' | 'ios',
    arch:         string,                       // 'wasm32' | 'wasm64' | 'arm64-v8a' | 'x86_64' | 'iphoneos' | 'iphonesimulator'
    runtime:      'st' | 'mt',
    buildType:    'release' | 'debug',
    runtimeEnv?:  'browser' | 'node' | 'edge',  // wasm only

    path:         string,                       // computed: '{platform}-{arch}-{runtime}-{buildType}'
    releasePath:  string,                       // = path with buildType→'release' (always release variant)

    // wasm-only computed names:
    rawJsName?:   string,                       // pre-bundled emcc output: '{name}-{path}.{runtimeEnv}.js'
    jsName?:      string,                       // final bundled JS:        '{name}-{path}.{runtimeEnv}.js'
    wasmName?:    string,                       // wasm binary:             '{name}-{path}.{runtimeEnv}.wasm'
    dataName?:    string,                       // emcc preload:            '{name}-{path}.{runtimeEnv}.data'
    dataTxtName?: string,                       // preload manifest:        '{name}-{path}.{runtimeEnv}.data.txt'
}
```

## Target inventory — 30 built-in targets

From `core/crossbind/src/utils/targets.js` (the single source; state and the wasi bin runner both read it):

### Wasm32

| platform | arch | runtime | buildType | runtimeEnv |
|----------|------|---------|-----------|------------|
| wasm | wasm32 | st | release | browser |
| wasm | wasm32 | st | release | edge |
| wasm | wasm32 | st | release | node |
| wasm | wasm32 | st | debug | browser |
| wasm | wasm32 | st | debug | edge |
| wasm | wasm32 | st | debug | node |
| wasm | wasm32 | mt | release | browser |
| wasm | wasm32 | mt | release | node |
| wasm | wasm32 | mt | debug | browser |
| wasm | wasm32 | mt | debug | node |

> **mt has no `edge` runtimeEnv.** Edge runtimes (Cloudflare Workers, Deno Deploy) don't expose Web Workers / SharedArrayBuffer. See `threading.md`.

### Wasm64 (memory-64; same axes)

Same shape as wasm32 above, but `arch: 'wasm64'`. Used when you need >4GB linear memory. Browser support is partial (Chrome 119+).

### WASI

| platform | arch | runtime | buildType |
|----------|------|---------|-----------|
| wasi | wasm32 | st | release |
| wasi | wasm32 | st | debug |

> **Single-module command builds** (`wasm32-wasip3`, no runtimeEnv axis — the artifact runs under a WASI runtime like wasmtime, not a JS host). See `wasi.md`.

### Android

| platform | arch | runtime | buildType |
|----------|------|---------|-----------|
| android | arm64-v8a | mt | release |
| android | arm64-v8a | mt | debug |
| android | x86_64 | mt | release |
| android | x86_64 | mt | debug |

> **Android is always `mt`.** No single-thread variant. NDK API 33, NDK 27.3.13750724.

### iOS

| platform | arch | runtime | buildType |
|----------|------|---------|-----------|
| ios | iphoneos | mt | release |
| ios | iphoneos | mt | debug |
| ios | iphonesimulator | mt | release |
| ios | iphonesimulator | mt | debug |

> **iOS is always `mt`.** No single-thread variant. iOS deployment target 13.0; bitcode embedded.

## `targetSpecs[]` — per-target override entries

When you want to override defaults for a specific subset of targets, push entries to `crossbind.config.js` `targetSpecs[]`:

```ts
type TargetSpec = {
    // Filter (any combination — entries match if all set fields match)
    platform?:   'wasm' | 'wasi' | 'android' | 'ios',
    arch?:       string,
    runtime?:    'st' | 'mt',
    buildType?:  'release' | 'debug',
    runtimeEnv?: 'browser' | 'node' | 'edge',

    // Overrides
    specs: {
        cmake?:         string[],                // extra -D flags appended to cmake configure
        emccFlags?:     string[],                // extra -s/-O flags appended to emcc command
        env?:           Record<string, string>,  // env vars passed to Wasm process at runtime (or via CFLAGS/LDFLAGS at build)
        data?:          Record<string, string>,  // bundle data files: { 'src-dir': 'dest-dir' }
        ignoreLibName?: string[],                // suppress specific .a names from being linked
        wasiFlags?:     string[],                // extra link flags for wasi command builds (see wasi.md)
    },
}
```

Example (wasm-only SIMD, all archs):

```js
targetSpecs: [{
    platform: 'wasm',
    specs: { emccFlags: ['-msimd128', '-DUSE_SIMD'] },
}]
```

Example (gdal-wasm: disable threading on st runtime via env):

```js
targetSpecs: [{
    platform: 'wasm',
    runtime: 'st',
    specs: { env: { GDAL_NUM_THREADS: '0' } },
}]
```

## `extensions[]` — plugin hooks

```ts
type Extension = {
    loadConfig?: {
        after?: (config) => void,                // mutate resolved config after load
    },
    buildWasm?: {
        beforeBuild?:        (emccFlags) => void,        // all wasm targets
        beforeBuildBrowser?: (emccFlags) => void,        // browser only
        beforeBuildEdge?:    (emccFlags) => void,        // edge only
        beforeBuildNodeJS?:  (emccFlags) => void,        // node only
    },
    createLib?: {
        setFlagWithBuildConfig?:    (buildEnv, cFlags, ldFlags) => void,
        setFlagWithoutBuildConfig?: (buildEnv) => void,
    },
}
```

Used internally by built-in extensions (e.g. for OpenSSL Android cert injection). Most users never write extensions; prefer `targetSpecs` first.

## When you write a hook, here's what to do

| You want to | Use this |
|-------------|----------|
| Read which target is being built | `target.platform`, `.arch`, `.runtime`, `.buildType`, `.runtimeEnv` |
| Find where source code is | `state.config.paths.build` (extracted upstream sources land here) |
| Find where artifacts go | `state.config.paths.output` |
| Find a dep's installed headers/libs | `state.allDependencyPaths[target.path][libName].header` / `.lib` |
| Add a CMake flag | `targetSpecs[].specs.cmake` (preferred) or `getBuildParams` return value |
| Add an emcc flag | `targetSpecs[].specs.emccFlags` |
| Inject env to the running Wasm | `targetSpecs[].specs.env` or `crossbind.config.js` `env: {}` |
| Patch upstream source | `crossbind.build.js` `replaceList` or `sourceReplaceList(target, depPaths)` hook |
| Bundle data files into the .data preload | `targetSpecs[].specs.data` or platform-variant `data: {}` |
| Run something before cmake | `crossbind.build.js` `beforeRun(cmakeDir)` |

## See also

- [`overrides.md`](./overrides.md) — full catalog of override mechanisms with priority order.
- [`crossbind-config.md`](./crossbind-config.md) — consumer-side config field-by-field.
- [`crossbind-build.md`](./crossbind-build.md) — package-author hooks (setState, beforeRun, getExtraLibs, sourceReplaceList, env, copyToSource, copyToDist, prepare, build).
- Source: `core/crossbind/src/state/index.js`, `loadConfig.js`, `actions/target.js`.
