# Performance — defaults, what's safe to override, what to leave alone

> crossbind sets production defaults for every Emscripten and CMake flag, and **most apps should change none**. This page lists each default, whether it is safe to override, and when to.

The rule: **if the build runs and the app works, the defaults are fine**. Change a flag only after measuring; a coding agent should not "optimize" the defaults on its own.

## Defaults reference

### Emscripten flags (always-on, set by `buildWasm.js`)

🔒 leave it, ✅ safe to override, ⚠️ change it only for the reason given.

- 🔒 **`-O3`**, release: maximum optimization. Leave it unless you are debugging a codegen issue.
- ✅ **`-O0`**, debug: no optimization.
- 🔒 **`-msimd128`**, wasm: the SIMD128 instruction set.
- 🔒 **`-sMEMORY64=1`**, wasm64 only: 64-bit memory, set by `target.arch`, not by a flag.
- ✅ **`-sSTACK_SIZE=1MB`** (and `-sSTACK_OVERFLOW_CHECK=1` in debug), when the link includes Rust: the stack for Rust code; a C++ build keeps Emscripten's 64KB. A size in the config wins (see `STACK_SIZE` below).
- ✅ **`-pthread`** and **`-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency || 1, 2)`**, mt only: a thread pool of at most 2 workers, 1 where `hardwareConcurrency` is unavailable. `PTHREAD_POOL_SIZE` is tunable (see below).
- ⚠️ **`-sPTHREAD_POOL_SIZE_STRICT=2`**, mt only: abort when more pthreads are asked for than the pool holds; no growth. Lower it to `1` (warn and grow) or `0` (grow silently) only if your code starts threads without bound.
- 🔒 **`-lembind`**, always: the embind binding library. Required.
- ✅ **`-Wl,--whole-archive`**, the Bridge archive only: keeps embind registrations (static initializers) alive. `export.wholeArchive: true` on the app restores the old all-archives layout; a library can declare the same in its own config.
- 🔒 **`-fwasm-exceptions`**, always: C++ exceptions through Wasm EH. Required for `throw` to work.
- 🔒 **`-sWASM=1`**, always: wasm output, not asm.js.
- 🔒 **`-sMODULARIZE=1`**, always: the ES module wrapper crossbind's bundling depends on.
- 🔒 **`-sDYNAMIC_EXECUTION=0`**, always: no `eval` or `new Function`. Required under a strict Content Security Policy.
- ⚠️ **`-sRESERVED_FUNCTION_POINTERS=200`**, always: the function table size. Raise it on "Cannot enlarge function table".
- 🔒 **`-sALLOW_MEMORY_GROWTH=1`**, always: the heap grows at run time. Do not disable it.
- 🔒 **`-sFORCE_FILESYSTEM=1`**, always: always includes the filesystem, which crossbind's fs adapters depend on.
- 🔒 **`-sWASMFS`**, browser and node: the new filesystem backend, which OPFS depends on.
- 🔒 **`-Wl,--wrap=__wasi_fd_sync`, `-Wl,--wrap=__syscall_fdatasync`**, node: `fsync` and `fdatasync` on a host file succeed instead of trapping in WasmFS's Node backend.
- 🔒 **`-sEXPORT_NAME=Module2`**, always: the JavaScript namespace crossbind's bundling depends on.

Emscripten 6.0.13 enables WebAssembly BigInt integration for every supported engine. Crossbind
therefore relies on that toolchain default instead of passing the deprecated `WASM_BIGINT` setting;
`i64` values still cross the JavaScript boundary as `bigint`.

### Per-runtimeEnv flags

| runtimeEnv | `-sENVIRONMENT` | `-sEXPORTED_RUNTIME_METHODS` |
|------------|---|---|
| browser | `web,webview,worker` | `["FS", "ENV"]` |
| edge | `web` | `["FS", "ENV"]` |
| node | `node` | `["FS", "ENV"]` |

### CMake flags (set by `getCmakeParameters.js`)

- 🔒 **`-DPROJECT_NAME`**: `general.name`; internal.
- 🔒 **`-DPROJECT_TARGET_*`**: the platform, arch, runtime and buildType, for routing.
- 🔒 **`-DBUILD_TYPE=STATIC`**, wasm and ios: static libraries, which emcc and iOS frameworks require.
- 🔒 **`-DBUILD_TYPE=SHARED`**, android: shared libraries, which Android's dynamic loading requires.
- 🔒 **`-DBUILD_SHARED_LIBS=OFF`**, wasm and ios: the inverse of the above.
- 🔒 **`-DCMAKE_TOOLCHAIN_FILE`**, per platform: the toolchain pin.
- 🔒 **`-DANDROID_PLATFORM=android-33`**, android: the NDK API level, fixed (see Android API level below).
- 🔒 **`-DANDROID_STL=c++_shared`**, android: one C++ runtime. Every library of an app links the one `libc++_shared.so` it ships, as Android compares `type_info` by address.
- 🔒 **`-DCMAKE_OSX_DEPLOYMENT_TARGET=15.1`**, ios: the iOS minimum, fixed (see iOS deployment target below).

### System defaults

| Variable | Default | Source |
|----------|---------|--------|
| Android NDK | 30.0.16248370 | Docker image pin |
| Android API | 33 | CMake flag |
| iOS deployment | 15.1 | CMake flag |
| Bitcode | embedded (release) / marker (debug) | iOS only |
| Emscripten cache | `/emsdk/upstream/emscripten/cache` in the web image | Docker image pin |

## What's safe to override

### `INITIAL_MEMORY` (default: 16MB Wasm default)

If you allocate large objects on startup (loading a model, opening a large geo dataset), the runtime grows memory dynamically — but you'll see growth pauses. Pre-allocating reduces pauses:

```js
// crossbind.config.js
targetSpecs: [{
    platform: 'wasm',
    specs: { binary: { emccFlags: ['-sINITIAL_MEMORY=64MB'] } },
}]
```

Sweet spot: pre-allocate ~2× your steady-state usage. Going higher just delays startup.

### `MAXIMUM_MEMORY` (default: ~2GB on wasm32)

Browser cap is ~4GB on wasm32. If you genuinely need more (large geospatial / scientific datasets), use **wasm64** target instead:

```js
// crossbind.config.js
target: { arch: 'wasm64' }
```

Don't try to push wasm32 past 4GB — Wasm spec doesn't allow it.

### `PTHREAD_POOL_SIZE` (default: `Math.min(navigator.hardwareConcurrency || 1, 2)`)

The default expression is evaluated by Emscripten at module load (not baked at build time):

- Caps the pool at **2 worker threads**, even on 16-core devices.
- Falls back to **1** if `navigator.hardwareConcurrency` is unavailable (older browsers, Node, edge runtimes).

Why the cap? Each pthread is a Web Worker with its own startup latency, JavaScript runtime and thread stack; the Wasm heap itself is shared, not duplicated. For typical workloads two workers (main + one) covers parallelism; going past 2 trades memory and load time for diminishing returns. Bump only when you've measured CPU-bound parallelism that scales further.

Paired with `-sPTHREAD_POOL_SIZE_STRICT=2`: if your code requests more pthreads than the pool, the runtime **aborts**. No dynamic growth, no main-thread deadlock risk. If you bump the pool, also relax strictness or keep your spawn count under the new cap.

Override scenarios:

- **CPU-bound parallelism that benefits from more workers** (tile-by-tile image processing, parallel decoding) — bump the pool and relax strict mode:
  ```js
  targetSpecs: [{
      platform: 'wasm', runtime: 'mt',
      specs: { binary: { emccFlags: ['-sPTHREAD_POOL_SIZE=8', '-sPTHREAD_POOL_SIZE_STRICT=1'] } },
  }]
  ```
- **Want even less memory pressure** — pin to one worker:
  ```js
  targetSpecs: [{
      platform: 'wasm', runtime: 'mt',
      specs: { binary: { emccFlags: ['-sPTHREAD_POOL_SIZE=1'] } },
  }]
  ```

Past `hardwareConcurrency` real cores, context-switching costs dominate anyway.

### `RESERVED_FUNCTION_POINTERS` (default: 200)

If you see `Cannot enlarge function table` at runtime, bump this:

```js
targetSpecs: [{ specs: { binary: { emccFlags: ['-sRESERVED_FUNCTION_POINTERS=1024'] } } }]
```

Most apps never hit this. Function pointers are used by virtual methods, std::function captures, and JS callbacks into C++.

### `STACK_SIZE` (default: 64KB; 1MB when the link includes Rust)

A C++ build keeps Emscripten's 64KB stack; only a link that includes Rust gets 1MB (read [rust.md](rust.md)). The stack cannot grow and has no guard page: in a release build an overflow overwrites static data without an error, and later, unrelated calls fail with `unreachable` or `memory access out of bounds`. Large local arrays and deep recursion need a bigger stack:

```js
targetSpecs: [{ platform: 'wasm', specs: { binary: { emccFlags: ['-sSTACK_SIZE=1MB'] } } }]
```

To find the function that overflows, add `-sSTACK_OVERFLOW_CHECK=2` to the same list: every stack pointer change is checked, and the call aborts with `stack overflow (Attempt to set SP to …)`.

### Android API level

Fixed at `android-33` (Android 13) for the libraries crossbind builds itself: crossbind passes `-DANDROID_PLATFORM=android-33` after the project's own cmake flags, so a recipe's `getBuildParams` cannot change it. In a React Native app, the plugin's Gradle build compiles the app's own native code at the app's `minSdkVersion` (24 when the app sets none).

### iOS deployment target

Fixed at `15.1`: Xcode 27 rejects deployment targets below 15.0, and React Native's own floor is 15.1. crossbind passes the value after the project's own cmake flags (as `CMAKE_OSX_DEPLOYMENT_TARGET` and as the bundled toolchain's `DEPLOYMENT_TARGET`), so a recipe's `getBuildParams` cannot change it.

### `JSPI` (experimental, Chrome-only)

Lets C++ code synchronously await JS promises. Use only when you have a specific cross-boundary async pattern (background fetching mid-C++):

```js
targetSpecs: [{
    platform: 'wasm',
    specs: { binary: { emccFlags: ['-sJSPI'] } },
}]
```

Cost: larger Wasm binary (~10-20% bigger), slower call boundary. Only enable if you measure improvement.

## What NOT to override

### `-O3` (release)

Always use `-O3` in release. Don't switch to `-O2` or `-Os` thinking you'll get a smaller binary — `-O3` produces faster *and* often smaller output for typical C++ workloads. crossbind's bundler also runs additional dead-code elimination after Emscripten.

### `-fwasm-exceptions`

Required. Without it, C++ exceptions either silently abort or use the slower legacy emulation.

### `-sFORCE_FILESYSTEM=1`, `-sWASMFS`

Required. crossbind's fs adapters (browser-fs, node-fs) depend on these. Disabling breaks `m.FS.*`.

### `-sMODULARIZE=1`, `-sEXPORT_NAME=Module2`

Required. crossbind's runtime entry assumes the modular wrapper with this exact export name.

### `-sDYNAMIC_EXECUTION=0`

Disabling re-enables `eval` / `new Function` inside Wasm runtime. Breaks CSP-strict deployments. Don't.

### `-msimd128`

Already optimal for Wasm. Removing it removes a free 2-4× speedup on supported workloads. All modern browsers support SIMD128.

## Common "performance" mistakes

### "I'll switch to `-Os` for smaller bundle"

`-O3 + bundler-side dead code elimination` already produces smaller binaries than `-Os` for typical apps. Measure before assuming. crossbind's plugins also strip debug symbols / dwarf data in release.

### "I'll disable `ALLOW_MEMORY_GROWTH` for predictable allocation"

You'll just hit "out of memory" in the first user interaction that needs more than `INITIAL_MEMORY`. Memory growth is cheap; OOM crashes aren't.

### "I'll disable `WASMFS` since I don't need files"

crossbind's adapter layer assumes `m.FS` exists. Disabling breaks even simple operations like reading a file you bundled into the `.data` preload.

### "I'll remove `-fwasm-exceptions` since my code doesn't throw"

Your C++ might not throw, but std::vector / std::string / std::map can. Removing exception support causes them to abort instead of throwing — silent crashes.

### "I'll bump `PTHREAD_POOL_SIZE` to 32 for max parallelism"

Each pthread is a Web Worker running the same module over shared memory — the heap is not duplicated, but every worker adds startup time, a JavaScript runtime and a thread stack, so bumping the pool to 32 inflates startup and memory without a matching speedup. The default caps at 2 deliberately: enough to parallelize the hot path, cheap to spin up. Bump only when measurement shows your workload scales (e.g. embarrassingly parallel image / geo / crypto loops), and pair the bump with `-sPTHREAD_POOL_SIZE_STRICT=1` so spawning more than the new cap doesn't trip the strict abort.

## Profiling

Before reaching for any override, measure:

1. **Browser DevTools Performance tab** — timing breakdown of JS / Wasm calls.
2. **Wasm-side `printf`** — quick timestamps with `console.debug` (crossbind's `print` hook).
3. **Memory tab** — heap profile to see allocation patterns.
4. **Lighthouse / PageSpeed** — Wasm bundle download is part of FCP / LCP.

Do not optimize speculatively: the defaults fit almost every workload.

## See also

- [`init.md`](./init.md) — runtime `useWorker` for off-main-thread execution.
- [`threading.md`](./threading.md) — `runtime: 'mt'` and COOP/COEP.
- [`overrides.md`](./overrides.md) — full override mechanism catalog.
- [`troubleshooting.md`](./troubleshooting.md) — out-of-memory and codegen errors.
- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — JSPI flag (advanced).
- Source: `core/crossbind/src/actions/buildWasm.js`, `getCmakeParameters.js`.
