<!-- GENERATED from docs/api/performance.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Performance — defaults, what's safe to override, what to leave alone

> crossbind picks production-grade defaults for every Emscripten and CMake flag. **Most apps should change nothing.** This doc lists every default crossbind sets, marks each as "safe to override" or "don't touch", and shows when to reach for a tweak.

The rule: **if your build runs and your app works, the defaults are fine**. Only touch performance flags after measuring. AI agents should resist the urge to "optimize" defaults proactively.

## Defaults reference

### Emscripten flags (always-on, set by `buildWasm.js`)

| Flag | Value | Purpose | Safe to override? |
|------|-------|---------|--|
| `-O3` | (release) | Max optimization | 🔒 Don't override unless debugging a codegen issue |
| `-O0` | (debug) | No optimization | ✅ Already debug — fine |
| `-msimd128` | wasm | SIMD128 instruction set | 🔒 Already optimal |
| `-sMEMORY64=1` | wasm64 only | 64-bit memory | 🔒 Set by target.arch, not flag override |
| `-pthread` + `-sPTHREAD_POOL_SIZE=Math.min(navigator.hardwareConcurrency \|\| 1, 2)` | mt only | Thread pool capped at 2 workers (1 if `hardwareConcurrency` is unavailable) | ✅ `PTHREAD_POOL_SIZE` is tunable (see below) |
| `-sPTHREAD_POOL_SIZE_STRICT=2` | mt only | Abort if more pthreads requested than pool (no dynamic growth) | ⚠️ Drop to `1` (warn + grow) or `0` (silent grow) only if your code spawns unbounded threads |
| `-lembind` | always | Embind binding lib | 🔒 Required |
| `-Wl,--whole-archive` | Bridge archive only | Keep embind registrations (static initializers) alive | ✅ `export.wholeArchive: true` on the app restores the legacy all-archives layout; a library can declare the same in its own config |
| `-fwasm-exceptions` | always | C++ exceptions via Wasm EH | 🔒 Required for proper `throw` semantics |
| `-sWASM_BIGINT=1` | always | BigInt for i64 | 🔒 Required for modern browsers |
| `-sWASM=1` | always | Output wasm (not asm.js) | 🔒 Don't touch |
| `-sMODULARIZE=1` | always | ES module wrapper | 🔒 crossbind bundling depends on this |
| `-sDYNAMIC_EXECUTION=0` | always | Disable eval / new Function | 🔒 Required for CSP-strict environments |
| `-sRESERVED_FUNCTION_POINTERS=200` | always | Function table size | ⚠️ Increase if "Cannot enlarge function table" error |
| `-sALLOW_MEMORY_GROWTH=1` | always | Heap can grow at runtime | 🔒 Don't disable |
| `-sFORCE_FILESYSTEM=1` | browser, node | Always include FS | 🔒 crossbind fs adapters depend on this |
| `-sWASMFS` | browser, node | New filesystem backend | 🔒 OPFS depends on this |
| `-sEXPORT_NAME=Module2` | always | JS namespace name | 🔒 crossbind bundling depends on this |

### Per-runtimeEnv flags

| runtimeEnv | `-sENVIRONMENT` | `-sEXPORTED_RUNTIME_METHODS` |
|------------|---|---|
| browser | `web,webview,worker` | `["FS", "ENV"]` |
| edge | `web` | `["ENV"]` |
| node | `node` | `["FS", "ENV"]` |

### CMake flags (set by `getCmakeParameters.js`)

| Flag | Value | Purpose | Safe to override? |
|------|-------|---------|--|
| `-DPROJECT_NAME` | `general.name` | Internal | 🔒 Don't change |
| `-DPROJECT_TARGET_*` | platform/arch/runtime/buildType | Routing | 🔒 Don't change |
| `-DBUILD_TYPE=STATIC` | wasm, ios | Static libs | 🔒 Required by emcc / iOS frameworks |
| `-DBUILD_TYPE=SHARED` | android | Shared libs | 🔒 Required by Android dynamic loading |
| `-DBUILD_SHARED_LIBS=OFF` | wasm, ios | Inverse of above | 🔒 Don't override |
| `-DCMAKE_TOOLCHAIN_FILE` | per-platform | toolchain pin | 🔒 Don't override |
| `-DANDROID_PLATFORM=android-33` | android | NDK API level | ⚠️ Lower if targeting older devices (read § Android API level) |
| `-DCMAKE_OSX_DEPLOYMENT_TARGET=13.0` | ios | iOS minimum | ⚠️ Lower if targeting older iOS (read § iOS deployment) |

### System defaults

| Variable | Default | Source |
|----------|---------|--------|
| Android NDK | 27.3.13750724 | Docker image pin |
| Android API | 33 | CMake flag |
| iOS deployment | 13.0 | CMake flag |
| Bitcode | embedded (release) / marker (debug) | iOS only |
| Emscripten cache | `~/.crossbind/emscripten/` | Docker volume |

## What's safe to override

### `INITIAL_MEMORY` (default: 16MB Wasm default)

If you allocate large objects on startup (loading a model, opening a large geo dataset), the runtime grows memory dynamically — but you'll see growth pauses. Pre-allocating reduces pauses:

```js
// crossbind.config.js
targetSpecs: [{
    platform: 'wasm',
    specs: { emccFlags: ['-sINITIAL_MEMORY=64MB'] },
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

Why the cap? Each pthread is a Web Worker — non-trivial memory footprint, startup latency, and WASM heap duplication. For typical workloads two workers (main + one) covers parallelism; going past 2 trades memory and load time for diminishing returns. Bump only when you've measured CPU-bound parallelism that scales further.

Paired with `-sPTHREAD_POOL_SIZE_STRICT=2`: if your code requests more pthreads than the pool, the runtime **aborts**. No dynamic growth, no main-thread deadlock risk. If you bump the pool, also relax strictness or keep your spawn count under the new cap.

Override scenarios:

- **CPU-bound parallelism that benefits from more workers** (tile-by-tile image processing, parallel decoding) — bump the pool and relax strict mode:
  ```js
  targetSpecs: [{
      platform: 'wasm', runtime: 'mt',
      specs: { emccFlags: ['-sPTHREAD_POOL_SIZE=8', '-sPTHREAD_POOL_SIZE_STRICT=1'] },
  }]
  ```
- **Want even less memory pressure** — pin to one worker:
  ```js
  targetSpecs: [{
      platform: 'wasm', runtime: 'mt',
      specs: { emccFlags: ['-sPTHREAD_POOL_SIZE=1'] },
  }]
  ```

Past `hardwareConcurrency` real cores, context-switching costs dominate anyway.

### `RESERVED_FUNCTION_POINTERS` (default: 200)

If you see `Cannot enlarge function table` at runtime, bump this:

```js
targetSpecs: [{ specs: { emccFlags: ['-sRESERVED_FUNCTION_POINTERS=1024'] } }]
```

Most apps never hit this. Function pointers are used by virtual methods, std::function captures, and JS callbacks into C++.

### Android API level

Default `android-33` (Android 13). Lower if you support older devices:

```js
targetSpecs: [{
    platform: 'android',
    specs: { cmake: ['-DANDROID_PLATFORM=android-26'] },  // Android 8.0
}]
```

Don't go below 26 unless you absolutely have to — older NDK lacks key APIs (e.g. `aligned_alloc`, modern `<filesystem>`).

### iOS deployment target

Default `13.0`. Lower if you support older iOS:

```js
targetSpecs: [{
    platform: 'ios',
    specs: { cmake: ['-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0'] },
}]
```

Don't go below 12.0 — older iOS lacks the C++17 standard library features crossbind auto-generated code uses.

### `JSPI` (experimental, Chrome-only)

Lets C++ code synchronously await JS promises. Use only when you have a specific cross-boundary async pattern (background fetching mid-C++):

```js
targetSpecs: [{
    platform: 'wasm',
    specs: { emccFlags: ['-sJSPI'] },
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

Each pthread is a Web Worker with its own WASM instance — bumping pool size to 32 inflates memory and module startup time without a matching speedup. The default caps at 2 deliberately: enough to parallelize the hot path, cheap to spin up. Bump only when measurement shows your workload scales (e.g. embarrassingly parallel image / geo / crypto loops), and pair the bump with `-sPTHREAD_POOL_SIZE_STRICT=1` so spawning more than the new cap doesn't trip the strict abort.

## Profiling

Before reaching for any override, measure:

1. **Browser DevTools Performance tab** — timing breakdown of JS / Wasm calls.
2. **Wasm-side `printf`** — quick timestamps with `console.debug` (crossbind's `print` hook).
3. **Memory tab** — heap profile to see allocation patterns.
4. **Lighthouse / PageSpeed** — Wasm bundle download is part of FCP / LCP.

Don't optimize speculatively. The defaults handle 99% of workloads.

## See also

- [`init.md`](./init.md) — runtime `useWorker` for off-main-thread execution.
- [`threading.md`](./threading.md) — `runtime: 'mt'` and COOP/COEP.
- [`overrides.md`](./overrides.md) — full override mechanism catalog.
- [`troubleshooting.md`](./troubleshooting.md) — out-of-memory and codegen errors.
- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — JSPI flag (advanced).
- Source: `core/crossbind/src/actions/buildWasm.js`, `getCmakeParameters.js`.
