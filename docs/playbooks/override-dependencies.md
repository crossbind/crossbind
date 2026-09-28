# Playbook — Override or rebuild a dependency from source (`crossbind.overrides.js`)

> App authors who need a dependency (e.g. `@crossbind/port-zlib`) built differently than the published prebuilt: different version, extra build flags, patched sources — or excluded/replaced entirely.

## Goal

A `crossbind.overrides.js` next to the app's `crossbind.config.mjs` that makes crossbind rebuild the named dependencies from source on every platform (wasm via the bundler plugins, Android via the RN gradle plugin, iOS via `pod install`) and link the rebuilt artifacts instead of the prebuilt ones.

## The overrides file

```js
// crossbind.overrides.js — keys match general name, package name or brand alias
export default {
    // 1) Plain source rebuild, same recipe:
    '@crossbind/port-zlib': { rebuild: true },

    // 2) Recipe override (this is also an implicit rebuild):
    '@crossbind/port-proj': {
        nativeVersion: '9.4.0',
        getBuildParams: (base, ...args) => [...base(...args), '-DENABLE_TIFF=OFF'],
    },

    // 3) Exclude a dependency entirely:
    '@crossbind/port-webp': { exclude: true },

    // 4) Replace with another implementation, keeping the old identity:
    '@crossbind/port-jpegturbo': { replace: myOtherJpegConfig },
};
```

Overridable recipe keys: `nativeVersion`, `getURL`, `buildType`, `env`, `copyToSource`, `copyToDist`, `beforeRun`, `useIOSCMake`, `sourceReplaceList`, `getExtraLibs`, `replaceList` (append by default; `{ set: [...] }` to replace), `getBuildParams` (chained: receives the base recipe function first, then the recipe's own arguments, which it must pass on to `base`), `targetSpecs`, `export`.

One-off rebuilds without a file: `CROSSBIND_REBUILD_DEPS=all` (or a comma-separated name list) as an environment variable, or `crossbind build --rebuild-deps <names>`.

## How it works

- `buildDependencies` compiles the dependency from source into `<app>/.crossbind/deps/<name>/` and writes a `.crossbind-rebuild.json` marker keyed by a hash of (name, nativeVersion, serialized override).
- Every config load consumes a marker whose key still matches: the dependency's artifact paths switch to the rebuilt `dist`. This works across processes — e.g. Android rebuilds at the gradle config phase, the CMake configure phase picks the fresh paths up.
- The Android plugin forwards a stamp of the consumed set as a CMake argument (`-DCROSSBIND_DEPS_STAMP`), so changing the override set automatically re-runs the CMake configure — no manual `.cxx` cleaning.
- Rebuilds are incremental per target: adding an ABI/platform later only compiles the missing targets. Concurrent builds of the same dependency are serialized with a lock file (`<name>.lock`).

## Removing an override

- **Recipe-changing overrides** (anything beyond `rebuild: true`) change the marker key, so deleting the entry reverts to the prebuilt artifacts on the next build.
- **Bare `{ rebuild: true }`** has the same key as "no override" (the rebuilt output is content-equivalent), so its cached artifacts keep being used after you delete the entry. To force prebuilts back, drop the cache:

```bash
crossbind clean-deps                       # everything
crossbind clean-deps @crossbind/port-zlib  # one dependency
```

## Sharp edges

- **Override functions must be self-contained.** They are keyed by their source text: values captured from outer scope do not change the key, so editing them silently keeps the stale cache. Inline every value.
- An incomplete rebuilt cache (e.g. killed build, missing `dist/prebuilt/CMakeLists.txt`) is treated as a miss and rebuilt; if it is consumed by a non-building process you get a log line and a fallback to prebuilts.
- Dependencies without a `crossbind.build` recipe (no source build published) log `using prebuilt` and skip the rebuild.
- **iOS picks overrides up at `pod install` time** (the podspec's prepare command runs the rebuild and vendors the xcframework). After changing `crossbind.overrides.js`, re-run `pod install` — an incremental Xcode build alone keeps the previous artifacts.
