# AGENTS.md — @crossbind/extension-rollup

> `crossbind()`'s plugin for Rollup and Rolldown **and** the inner kernel of the Vite extension's plugin. Bundler-agnostic logic lives here; bundler-specific glue (Vite dev server, etc.) lives one level up.

## What lives here

- `crossbind.extension.js` — the descriptor: contract 5, an `integration` that claims Rollup's and Rolldown's read of the `options` hook, which they make before any other.
- `src/plugin.js` — `rollupPlugin(api)`. `api` is the one `crossbind()` hands the integration (`core/crossbind/src/integration/apiHandle.js`); each hook that needs crossbind's state awaits `api.ready()` first. The Vite plugin runs it with its own api, so both keep one bridge set per project.

## Hooks the plugin implements

| Rollup hook | What it does |
|-------------|--------------|
| `resolveId('crossbind')` | Mark the crossbind loader as `external: true` so consumers fetch it at runtime, not bundle it |
| `transform(code, '.h')` | `api.transform`: SWIG bridge generation; the JS module for the header |
| `buildStart` | `api.prepare` builds the dependencies, then `addWatchFile` for every file under `api.nativeFiles()` (the existing entries of `paths.native`). Watch mode sees `.cpp`/`.h` edits |
| `generateBundle` | `api.link` (`createLib` + `buildWasm`, forced when `isSourceNewer(...)`); emit `api.outputs` (`crossbind.js`, `crossbind.wasm`, `crossbind.data.txt`) as bundle assets, and `crossbind-licenses.json` (`api.licenses`) when the page imports `crossbind/licenses` |

In app mode (`isAppBuild()`: a run of `crossbind app`, or `target.runtimeEnv: 'app'`; macOS, Linux, Windows, iOS and Android for now) `generateBundle` builds the app host for this machine with `api.app.build()` (`buildProjectApp`) instead, or with `CROSSBIND_APP_PLATFORM`, which `crossbind app -p` sets, one for each iOS SDK, Android ABI or Linux or Windows arch (`appTargetParams`), and emits its page runtime as `crossbind.js`; `writeBundle` then puts the written page into each app beside it with `api.app.publish(dir)` (`publishApp`): `<name>.app`, `<name>-linux-<arch>/`, `<name>-win32-<arch>/`, the Xcode project `<name>-ios/` or the Gradle project `<name>-android/` and its APK. Once every app has its page, `shipApp` runs each desktop app's installers, crossbind's and its extensions', and its update, which it records for `crossbind app upload`; `buildStart` awaits `api.app.check()` (`checkInstaller` for each desktop app) first, which stops the build before anything compiles. See `docs/api/app.md`.

## Invariants

- **`paths.native` is an array.** The outer Vite plugin assumed this years ago; this plugin must too. `existsSync(array)` returns false silently — always iterate entries before testing each one.
- **`force = isSourceNewer(target)`** in `api.link`. Skips rebuild when artifacts are newer than every native source; bypasses cache when not.
- **The api's bridge set accumulates across `transform` calls.** One api for a project's plugins; `api.link` reads the union.

## Common pitfalls

- **Forgetting to call `addWatchFile` per native dir.** Watch mode silently skips edits → users think `pnpm rollup -w` is broken.
- **Returning `external: true` for `crossbind` in some configs and `false` in others.** Inconsistency makes Vite's HMR vs prod build behave differently.
- **Emitting `crossbind.js`/`crossbind.wasm` to a custom path.** Consumers (including Vite) expect `crossbind.js`, `crossbind.wasm`, `crossbind.data.txt` at the bundle root, and `crossbind/licenses` reads `crossbind-licenses.json` there. Don't rename without updating the loader.
- **Re-running `buildWasm` without `force` semantics.** Cache-shortcut bugs land here; always go through `isSourceNewer`.
- **Calling `state.config.paths.cli/...` directly with hardcoded sub-paths.** Use the integration api (`api.link`, `api.transform`, `api.outputs`, …); it survives asset reorgs.

## Validation

Touching this plugin propagates to:

- `extensions/vite` (runs it) — all affected Vite examples and E2E fixtures must keep working.
- Anyone using rollup standalone (rare).

Strict gate:

```bash
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

Targeted Vite smoke (since this plugin's biggest consumer is the Vite extension):

```bash
pnpm --filter=@crossbind/example-web-vue-vite run build
pnpm --filter=@crossbind/e2e-web-vite-multithread run build
```

## Reference

- Outer Vite plugin: `extensions/vite/`
- Plain Rollup run through `crossbind()`: `core/crossbind/test/bundlerRuns.test.js`
- Standalone integration recipe: `docs/playbooks/integration/rollup.md`
- Vite integration recipe: `docs/playbooks/integration/vite.md`
- Force-rebuild trigger: `core/crossbind/src/actions/isSourceNewer.js`
