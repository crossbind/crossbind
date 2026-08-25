<!-- GENERATED from docs/playbooks/integration/react-native-cli.md by scripts/build-agent-skill.mjs. Do not edit. -->

# Integration — React Native CLI (bare workflow)

> Persona 2 sub-playbook. The user's project is a bare React Native app (`react-native` in deps, no `expo`). Detection: `react-native` + `metro.config.js` + (`android/` and/or `ios/`) directories.

## Goal

Add crossbind to a React Native CLI app so:

- Native C++ compiles to a `.so` (Android) and `.a` / xcframework (iOS) and links into the app bundle.
- JS side calls into C++ via the Embind/JSI bridge.
- Metro bundler picks up the crossbind loader for the JS side.

## When to use

- `react-native` in deps; **no** `expo`/`@expo/cli` in deps.
- `metro.config.js` at root.
- `android/` and/or `ios/` native project directories present.
- Expo users → see `docs/playbooks/integration/react-native-expo.md`.

## Files involved

| File | Role |
|------|------|
| `package.json` | + `@crossbind/plugin-react-native`, `@crossbind/plugin-react-native-ios-helper` (dependencies, autolinked), `@crossbind/plugin-metro` (devDependency), optional `@crossbind/port-<name>` |
| `metro.config.js` | Wrap `getDefaultConfig` output with `CrossbindMetroPlugin(...)` |
| `crossbind.config.{js,mjs}` *(new at project root)* | Project-level crossbind config: deps to consume, paths |
| `src/native/` *(if user wraps own C++)* | `.h` + `.cpp` source files |
| `android/app/build.gradle` | Auto-wired by `@crossbind/plugin-react-native`'s native CMake hook (no manual edits) |
| `ios/Podfile.lock` | Updated by `pod install` after adding the plugin |
| `ios/<App>.xcodeproj` | Native iOS link picks up the auto-generated podspec |

## Commands

```bash
pnpm add @crossbind/plugin-react-native @crossbind/plugin-react-native-ios-helper
pnpm add -D @crossbind/plugin-metro     # bundling only; the RN plugin brings the toolchain
pnpm add @crossbind/port-<name>     # optional

# iOS — install pods (regenerates Podfile.lock + xcframeworks)
cd ios && pod install && cd ..

# Run on Android
pnpm android      # or: pnpm react-native run-android
# Run on iOS
pnpm ios          # or: pnpm react-native run-ios
```

`pod install` runs build hooks from `react-native-crossbind.podspec` that compile the iOS native libraries. `pnpm android` triggers Gradle's externalNativeBuild, which calls `script/CMakeLists.txt` from `@crossbind/plugin-react-native` and shells out to `crossbind build -p android`.

## Reference config

Mirror `examples/mobile-reactnative-cli/`.

`metro.config.js` (canonical):

```js
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const CrossbindMetroPlugin = require('@crossbind/plugin-metro');

const defaultConfig = getDefaultConfig(__dirname);

const config = {
    ...CrossbindMetroPlugin(defaultConfig),
};

module.exports = mergeConfig(defaultConfig, config);
```

`crossbind.config.{js,mjs}` at project root:

```js
import Matrix from '@crossbind/example-lib-prebuilt-matrix/crossbind.config.js';
// or any other prebuilt: import Gdal from '@crossbind/port-gdal/crossbind.config.js';

export default {
    dependencies: [
        Matrix,
        // Gdal,
    ],
    paths: {
        config: import.meta.url,
    },
};
```

`.mjs` is preferred (ESM) so the `import.meta.url` reference works; `.js` is fine too if `package.json` declares `"type": "module"`.

## CI bridge cache (optional, advanced)

The `examples/mobile-reactnative-cli` example keeps a snapshot of generated bridge files at `ci/crossbind-snapshot/` — the iOS workflow restores it before `pod install` to skip the SWIG bridge generation step in CI. This is **not** required for normal development, only for fast CI builds. Pattern:

```
my-app/
└── ci/
    └── crossbind-snapshot/        ← snapshot of .crossbind/build/{bridge,interface} + cache.json
        └── build/
            ├── bridge/
            │   ├── native.i.cpp
            │   └── native.i.cpp.exports.json
            ├── interface/
            │   └── native.i
            └── ...
```

In CI, before pod install:

```bash
mkdir -p .crossbind
cp -r ci/crossbind-snapshot/. .crossbind/
```

Don't name the snapshot dir `.crossbind` — `clear:cache:examples`-style globs may pick it up and delete it. Use a different name (`crossbind-snapshot`, `bridge-cache`, etc.).

## Multithread → COOP/COEP

**Not applicable.** React Native runs JS on JSC/Hermes, not in a browser, so there's no SharedArrayBuffer / COOP/COEP gate. Multithread (`runtime: 'mt'`) on RN uses pthreads via JSI directly. No header config needed for RN apps.

## Validation

- [ ] `pnpm install` succeeds.
- [ ] `cd ios && pod install` succeeds, `Podfile.lock` updated, `*.xcframework` directories appear under `ios/Pods/` or vendored locations.
- [ ] `pnpm android` builds the APK and launches; the app calls into C++ without "library not loaded" errors.
- [ ] `pnpm ios` builds and launches in the iOS simulator (arm64 macOS) or on-device.
- [ ] JSI bridge: `import { initNative } from './native/native.h'; await initNative(); Module.fn(...)` returns expected result.
- [ ] If wrapping own C++: editing `src/native/native.cpp` + restarting Metro picks up the change (or at least re-run `pod install` / `pnpm android` to recompile).

## Common pitfalls

- **Mixing Expo and bare RN.** If `expo` is in deps, this playbook doesn't apply — switch to `react-native-expo.md`.
- **Skipping `pod install`** after adding the plugin. iOS will fail to find the xcframeworks at link time.
- **Deleting `ci/.crossbind` directly with the older `find`-based clear scripts.** Use the `crossbind-snapshot/` rename pattern (see "CI bridge cache" above) so future clear globs don't wipe it.
- **arm64e / x86_64 simulator slices.** `@crossbind/port-*-ios` podspecs already exclude `x86_64` for iphonesimulator (Apple Silicon-only). If a custom user package's podspec is missing `EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64`, Apple Silicon Macs running the iOS simulator will fail to link.
- **NDK / cmake version mismatch.** RN's externalNativeBuild requires NDK 25+ and cmake 3.22+. `pnpm android` will surface mismatches via Gradle.
- **Editing native bridge code by hand.** `.crossbind/build/bridge/*` is generated by SWIG. Edit the source `.h`/`.cpp`, re-run `pnpm android` / `pnpm ios`, let the plugin regenerate the bridge.
- **Forgetting `watchFolders`** when the project is inside a monorepo. If your app lives in a workspace and depends on workspace packages, Metro needs the full repo root in `watchFolders` (see the example's `metro.config.js` for the pattern).

## Reference examples

- `examples/mobile-reactnative-cli/` — canonical RN-cli reference (with `ci/crossbind-snapshot/`)
- `e2e/mobile-reactnative-cli/` — bigger demo with multiple packages

Plugin sources:
- `plugins/react-native/` (Gradle CMake hook + iOS podspec hook)
- `plugins/react-native-ios-helper/` (iOS-side glue)
- `plugins/metro/` (Metro bundler integration)

iOS CI workflow (uses bridge cache): `.github/workflows/test-ios-sample.yml`.
