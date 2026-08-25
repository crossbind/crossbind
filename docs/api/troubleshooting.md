# Troubleshooting — common errors and which override to reach for

> When a crossbind build or runtime fails, **don't bypass the system** — almost every common error has a designated override mechanism. This doc lists the errors agents actually hit and routes each to the right override (catalogued in [`overrides.md`](./overrides.md)).

The recovery rule:

1. Read the error literally.
2. Identify which layer it lives in (binding-time / build-time / link-time / runtime / hosting).
3. Reach for the **least invasive** override (target filter → targetSpecs → env → build hooks → extensions).
4. Don't manually edit crossbind source, generated artifacts, or upstream library code outside `replaceList`.

---

## Build-time errors

### `Error: ENOENT: no such file or directory ... /dist/...`

crossbind expected a `dist/` from a dependency that hasn't been built yet.

- **Cause:** transitive dep wasn't built. pnpm topological order should handle this, but if you ran a single-package build with `pnpm --filter <one>` it skipped the deps.
- **Fix:** `pnpm install && pnpm run build` (full topological), or `pnpm --filter '@crossbind/port-<dep>*' run build` first.

### `undefined symbol: <name>` at link

The linker can't find a symbol your code references.

- **Cause A — missing dep:** `dependencies: []` in `crossbind.config.js` doesn't list the package providing this symbol.
  **Fix:** add the family dependency and its matching platform-variant dependency in `package.json`. See ADR-0002.
- **Cause B — symbol clash:** two libs export the same symbol. Common with `iconv` (gdal renames it to `libiconv` to avoid clash).
  **Fix:** `crossbind.build.js` `replaceList` to rename one set of symbols, or `targetSpecs[].specs.ignoreLibName` to suppress the duplicate.

### `error: cannot find -l<libname>`

Linker can't find a library file, but the dep IS declared.

- **Cause:** library was built but produced a different `.a` name than expected. Usually a mismatch between `export.libName` in the dep and what's actually built.
- **Fix:** check `ports/<dep>/<platform>/crossbind.config.js` `export.libName` array; verify the produced `.a` exists in `dist/lib/`.

### `wasm-ld: error: --whole-archive ... duplicate symbol`

Two libs define the same function.

- **Fix:** same as "symbol clash" above. `replaceList` rename, or `ignoreLibName` to drop one.

### `wasm-ld: error: --shared-memory is disallowed by ... not compiled with 'atomics' or 'bulk-memory' features`

A multithread (`mt`) wasm link pulled in a Rust archive whose objects (std
included) were built without the atomics features. Current crossbind cannot
produce such an archive — mt Rust builds go through nightly `-Zbuild-std` or
fail with install instructions — so the usual source is a **stale cargo-type
package prebuilt** built before mt support.

- **Fix:** rebuild the package's wasm prebuilts (`crossbind build -p wasm` in the
  package, with `rustup toolchain install nightly --component rust-src` done
  once) or update to a package version whose mt prebuilt was built that way.

### `__wasm__` / `CPL_CPUID` / `__asm__` / SIMD intrinsic compile errors

Upstream library uses CPU-specific code that doesn't compile for Wasm.

- **Fix:** `crossbind.build.js` `replaceList` to gate the intrinsic with `#ifdef __wasm__`. Real example: gdal-wasm.

  ```js
  replaceList: [{
      regex: /CPL_CPUID\(1, cpuinfo\);/g,
      replacement: '#ifdef __wasm__\ncpuinfo[0]=0;\n#else\nCPL_CPUID(1, cpuinfo);\n#endif',
      paths: ['port/cpl_cpu_features.cpp'],
  }]
  ```

### `configure: error: cannot find ...` (autotools project)

`buildType: 'configure'` but the configure script can't find a dep header / lib.

- **Fix A:** add the missing dep to `dependencies`. Re-derive `depPaths.X.header` in `getBuildParams`.
- **Fix B:** if your dep IS there, `getBuildParams` may need explicit `--with-X=...=${depPaths.X.header}` flags. Verify the dep name in `depPaths` matches the package short name.

### `RuntimeError: index out of bounds` during build

Emscripten itself ran out of memory during compilation.

- **Cause:** linker working set exceeded default heap.
- **Fix:** rare; usually fixed in newer Emscripten. If hitting it: `targetSpecs[].specs.emccFlags: ['-sINITIAL_MEMORY=512MB']`.

### iOS: `pipe2 was misdetected as available`

curl-ios SDK 26+ specific.

- **Cause:** autoconf cache miss between SDK detection and actual symbol availability.
- **Fix:** `getBuildParams` adds `'-D_CURL_PREFILL=ON'`. See curl-ios's crossbind.build.js for the prefill cache pattern.

### iOS: code signing fails on a build utility

Upstream lib has a tool / utility that's built and signed, but you don't have a dev cert.

- **Fix:** `targetSpecs[].specs.cmake: ['-DCMAKE_XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED=NO']`. Real example: jpegturbo-ios for SIMD coverage tool.

---

## Binding-time errors

### `binding ... silently produces null` or `function returns undefined`

Your C++ function violated a binding rule. See [`cpp-binding-rules.md`](./cpp-binding-rules.md).

- Returning `unique_ptr` instead of `shared_ptr`? Switch.
- Returning a raw pointer (`MyClass*`)? Wrap in `shared_ptr` or write a C++ wrapper.
- Using multiple inheritance? Refactor to composition.
- Template not explicitly instantiated? Add `template class X<int>;`.
- Definition only in `.cpp`, not in `.h`? Move definition (or at least public surface) into the header.

### SWIG generation failures (`%feature` errors, `Unable to find ...`)

Auto-generated `.i` doesn't fit. Write a manual one — see [`swig-escape.md`](./swig-escape.md).

### `Error: Tried to call ... but the function is not exposed`

Function not in the public binding surface.

- **Cause A:** function is in an anonymous namespace or `static` at file scope. Move to public surface.
- **Cause B:** declared in `.h` but defined in `.cpp` with a `static` or `inline` qualifier the binder skips. Match declaration and definition.

### `BindingError: Cannot register public name '<Name>' twice`

Two registrations share one JS-visible name. All languages register into the same embind
namespace, so a C++ `class Counter` in one header and a Rust `pub struct Counter` in a `.rs`
import collide — the page aborts during init.

- **Fix:** rename one side; the JS-visible name is the class/struct name, so any distinct
  identifier resolves it.
- The colliding registration is often not where you expect: search every imported header,
  `.rs` file and `cargo:` crate for the name in the message.

---

## Runtime errors

### Browser console: `crossOriginIsolated is false`

You set `target.runtime: 'mt'` but production hosting isn't sending COOP/COEP headers.

- **Fix:** add `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` to your host config. See [`threading.md`](./threading.md) per-host table (Vercel, Netlify, nginx, Cloudflare).

### `RuntimeError: SharedArrayBuffer is not defined`

Same root cause as above — COOP/COEP missing.

### `OPFS is only available inside a Worker scope`

You mounted `/opfs/...` but didn't set `useWorker: true` on `init(opts)`.

- **Fix:** `initNative({ useWorker: true })`. See [`filesystem.md`](./filesystem.md).

### `Path /opfs/... but OPFS is disabled. Enable fs.opfs in config`

You explicitly set `fs: { opfs: false }` and then tried to use `/opfs/...`.

- **Fix:** either remove the `opfs: false` (it's true by default) or mount under `/memfs/...`.

### `RuntimeError: out of memory` (Wasm runtime)

Wasm process exhausted its allocated heap.

- **Note:** `-sALLOW_MEMORY_GROWTH=1` is on by default — runtime should grow memory automatically up to host limits.
- **Fix A — initial allocation:** `targetSpecs[].specs.emccFlags: ['-sINITIAL_MEMORY=128MB']`. Bump default starting size.
- **Fix B — maximum allocation:** `targetSpecs[].specs.emccFlags: ['-sMAXIMUM_MEMORY=4GB']`. Browser cap is ~4GB on wasm32; use wasm64 target if you need more.
- **Fix C — algorithmic:** stream the input instead of loading all into memory. Split the workload. Most "out of memory" cases mean your design holds too much state at once.

### `Function is not a function` / `m.someFunc is undefined`

The C++ function exists but didn't bind to JS.

- **Cause:** binding rule violation. See "Binding-time errors" above.
- **Cause:** the JS module finished loading but `init` hasn't completed. Make sure you're calling `m.someFunc` *after* `await initNative(...)`.
- **Cause (worker runtime, e.g. `instance.method is not a function`):** the module
  runs in a worker — the wasm `mt` runtime defaults to one, as does
  `initNative({ useWorker: true })` — so construction returns a promise and sync-style
  code holds a `Promise`, not the instance. Write `const c = await new X(...);
  await c.method(...)` and set `dts: 'promise'` so the generated types match.

### Calls hang forever when `useWorker: true`

Comlink call posted to worker but no response.

- **Cause A:** worker script URL is wrong; worker never spawned. Check Network tab — should see a request to the worker `.js`.
- **Cause B:** C++ inside worker is in an infinite loop. Open Sources tab on the worker context.

---

## Cross-cutting symptoms

### `wasm streaming compile failed`

- **Cause A:** wrong MIME type. Some hosts serve `.wasm` as `application/octet-stream` instead of `application/wasm`.
  **Fix:** host config to set the right MIME.
- **Cause B:** mixed `mt` and `st` artifacts in the same bundle. The runtime tries to load a `mt` `.wasm` with an `st` JS loader (or vice versa).
  **Fix:** clean rebuild after changing `runtime`. `pnpm clear:cache && pnpm clear:dist` then rebuild.

### Build "works" but produces no output

- **Cause:** `functions.isEnabled: () => false` accidentally returned false for everything.
- **Cause:** `target.platform` filter is set to a value that doesn't match any built-in target.
- **Fix:** check the build log for `Skipping target: ...` lines.

### Hot Module Reload doesn't pick up `.cpp` changes (Vite/Webpack)

- **Cause:** `paths.native` change not detected by the bundler's file watcher.
- **Note:** the bundler plugins (`@crossbind/plugin-vite`, `-webpack`) explicitly add the `paths.native` files to the watcher in dev mode. If HMR fails:
- **Fix:** restart dev server. If it persists, check that `paths.native` is correctly resolved (look at `state.config.paths.native` in console).

---

## Tribal-knowledge gotchas (from real packages)

These are patterns the source code uses but aren't obvious. Flag them to users early:

### 1. `iconv` symbol collision in gdal

When you depend on both `gdal` and a transitive lib that uses `libiconv`, symbols clash. gdal uses a `replaceList` entry to prefix iconv calls. If you write a new package that also uses iconv, mirror the pattern.

### 2. `emscripten_fetch` swap in curl-wasm

curl's POSIX socket calls don't exist in Wasm. curl-wasm injects a 200-line `replaceList` swap to use Emscripten's `fetch` API. If you ship any HTTP-using package for Wasm, you'll need the same swap (or use curl as a dep).

### 3. CPU intrinsic gates

`CPL_CPUID`, `__asm__`, `<immintrin.h>` etc. don't compile for Wasm by default. gdal-wasm gates them with `#ifdef __wasm__`. Pattern is in gdal's crossbind.build.js.

### 4. `depPaths` silent fallback

When `getBuildParams` references `depPaths.X.header` with a wrong key name (typo or rename), CMake silently falls back to the system header search path. The build "succeeds" but uses the wrong header. **Always verify the dep name in `depPaths` matches the package short name** (the `general.name` of the dep).

### 5. iOS `_CURL_PREFILL` cache

On iOS SDK 26+, autoconf misdetects `pipe2` due to a cache mismatch. curl-ios uses `_CURL_PREFILL=ON` to force-load a prefill script. Any autotools-based package on iOS may hit similar cache issues; check curl-ios's `crossbind.build.js` for the pattern.

---

## Diagnostic flow

When the error doesn't match anything above:

1. **`pnpm run doctor`** — verifies Node, pnpm, Docker, Android SDK/NDK, Xcode. Most "weird" build failures are missing toolchains.
2. **Check `~/.crossbind.json` `LOG_LEVEL: 'DEBUG'`** — turns on verbose tracing in crossbind itself. Often shows which step failed.
3. **Reduce to smallest reproducer** — create a fresh project with just the failing dep. Apply the bug-fix playbook (`docs/playbooks/bug-fix.md`).
4. **Search for the error literal** in `core/crossbind/src/`. Most crossbind error messages are unique enough to find the throwing site.
5. **File an issue** if the error originates from crossbind itself, not from your config or upstream.

## See also

- [`overrides.md`](./overrides.md) — the catalog of override mechanisms each fix uses.
- [`build-state.md`](./build-state.md) — `state` / `target` shapes for `replaceList` / `getBuildParams`.
- [`cpp-binding-rules.md`](./cpp-binding-rules.md) — binding-time error root causes.
- [`threading.md`](./threading.md) — COOP/COEP and edge-runtime limits.
- [`filesystem.md`](./filesystem.md) — OPFS / memfs runtime errors.
- `docs/playbooks/bug-fix.md` — the fix-a-bug workflow.
