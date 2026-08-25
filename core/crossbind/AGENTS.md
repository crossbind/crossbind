# AGENTS.md — core/crossbind

> The CLI + build orchestrator that everything else in the monorepo plugs into. **The most-touched package**, also the most blast-radius-sensitive.

## What lives here

- `src/bin.js` — `crossbind` CLI entry; commander commands, target filtering and top-level orchestration.
- `src/index.js` — public API barrel re-exported as the `crossbind` npm package (`createLib`, `buildWasm`, `state`, `getData`, `isSourceNewer`, …).
- `src/actions/` — the actual build steps. **Most edits land here.**
- `src/state/` — config loading + target matrix.
- `src/utils/` — small helpers (logger, hashing, fs, JSON I/O, Docker pull, …).
- `src/integration/` — `getCrossbindScript`, `getDependFilePath` (consumer-side helpers used by plugins).
- `src/assets/` — runtime artifacts shipped with the published package: `js-runtime/` (browser/node/edge JS shims), `cpp-runtime/` (C++ entrypoints), `cmake/` (CMake templates), `packaging/` (podspec template).

Use `docs/CODEMAP.md` (repo root) for "concept → file" lookups before guessing.

## Build pipeline orchestration (the hot path)

Order of operations when a user runs `pnpm crossbind build`:

1. **`src/bin.js`** parses CLI flags, calls `getBuildTargets` to expand the target matrix.
2. For each target:
   - **`actions/createLib.js`** compiles user C++ to a static lib per platform (cmake/make for wasm/android via Docker; xcodebuild on darwin for iOS). Cache short-circuit when `<output>/prebuilt/<target>/lib` exists, unless `options.force`.
   - **`actions/createXCFramework.js`** combines iOS slices into an `.xcframework` (darwin only).
   - **`actions/buildWasm.js`** runs `emcc` for wasm targets, then **`actions/buildJs.js`** rolls up the JS loader.
3. **`actions/run.js`** is the shell-out boundary: every cmake / make / emcc / xcodebuild call goes through it.

Side-quests:
- **`actions/createInterface.js`** generates SWIG bridge files from `.h`.
- **`actions/getDependLibs.js`** resolves transitive C++ libs to link.
- **`actions/getCmakeParameters.js`** builds the `-D...` arg list for cmake.
- **`actions/isSourceNewer.js`** mtime check used by plugins to decide when to force-rebuild.

## Public API contract

Anything exported from `src/index.js` is consumed by `plugins/*` and a few CLI scripts (`scripts/check-*.js`). Treat its surface as semver-public — additive changes free, breaking changes need a beta bump and a CHANGELOG note.

Currently exported (snapshot):

```
state, createLib, createBridgeFile, buildWasm, isSourceNewer, getData,
getCmakeParameters, createXCFramework, getAllBridges, run, getTargetParams,
getBuildTargets, getFilteredBuildTargets, getFilteredTargetSpec,
getCrossbindScript, getDependFilePath, getParentPath
```

If you add a new action, decide explicitly: is this internal (don't export) or part of the contract (export from `index.js` and document)?

## Logger conventions

`src/utils/logger.js` is the only canonical writer to stdout / stderr.

- `logger.startStep(target, fileType)` — opens an in-place TTY line ("compiling…").
- `logger.doneStep(target, fileType, detail?)` — replaces it with timing + detail.
- `logger.cachedStep(target, fileType)` — for cache-hit short-circuits.
- `logger.startTask(label)` / `doneTask(label, detail?)` / `cachedTask(label)` — for non-target work (xcframework, etc.).
- `logger.info(text)` / `logger.error(text)` — for one-off messages.

**Don't add `console.log` in this package.** Route everything through the logger; CI / non-TTY automatically gets newline output.

## Validation

Anything you change here triggers the **strict** validation gate from the root playbook:

```bash
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

Plus, depending on the area:

- Touched a new public export → search consumers: `rg "from ['\"]crossbind['\"]" plugins examples e2e scripts`.
- Touched `actions/run.js` (Docker / Xcode shell-out) → smoke a fresh `pnpm crossbind build` against `examples/lib-prebuilt-matrix` (smallest C++ surface).
- Touched `src/assets/js-runtime/` (browser/node/edge adapters) → at least one example per runtime must build and run (`examples/web-vue-vite`, `examples/backend-nodejs-wasm`, `examples/cloud-cloudflare-worker`).
- Touched `src/assets/js-runtime/adapters/worker-comlink.js` → coverage MUST include embind **instance** methods, not just statics: statics skip embind's `this` conversion, so a statics-only smoke passes while every instance call is broken (this shipped once, as beta.26's "Expected null or instance of X, got an instance of X"). Run the `e2e/web-vite-multithread` e2e (its Counter spec exists for exactly this), and before publishing run gdal3.js's `packages/wasm-test` suite against the packed tarball — it calls every binding, one method at a time.
- Touched `state/loadConfig.js` defaults → assume blast radius = whole monorepo. Run the full matrix.

## Common pitfalls

- **Adding `console.log` instead of using the logger.** Breaks the in-place TTY rendering and fails on CI's non-TTY pipe.
- **Throwing inside `actions/run.js` without surfacing stderr.** Wrap exec calls so the user sees the actual cmake/make/emcc error, not just "exit code 1".
- **Mutating `state.config` from inside an action.** Treat it as read-only after `loadConfig` runs.
- **Forgetting `--force`-equivalent paths.** `createLib` and `buildWasm` both honor `options.force`; new actions that cache should follow the same convention so plugins can opt out.
- **Hardcoding paths instead of going through `state.config.paths.*`.** The path resolution lives in `state/loadConfig.js` for a reason.
- **Adding a runtime adapter that doesn't compose `core.js`.** New `js-runtime/<runtime>.js` files should be thin shims that `createInitCrossbind(...)` composes from `adapters/*`.

## Reference

- `docs/ARCHITECTURE.md` — high-level flow + key abstractions.
- `docs/CODEMAP.md` — concept → file index.
- `docs/playbooks/bug-fix.md` — fix workflow.
- `docs/playbooks/new-port.md` — port-authoring workflow (for `ports/`, not this directory).
- Logger: `src/utils/logger.js` — read this before adding any user-facing output.
