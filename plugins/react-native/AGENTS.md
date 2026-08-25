# AGENTS.md — @crossbind/plugin-react-native

> React Native (CLI **and** Expo) integration. The most multi-platform plugin in the repo: it touches Gradle (Android), CocoaPods + Xcode (iOS), Metro (JS), and SWIG (C++ bridge generation).

## What lives here

- `package.json` — defines the plugin npm package.
- `react-native-crossbind.podspec` — CocoaPods manifest. iOS app's `pod install` discovers this, runs the iOS build hooks (`script/build_ios.js`).
- `android/build.gradle` — Android Gradle Plugin module config; defers native compilation to `script/CMakeLists.txt` via `externalNativeBuild`.
- `script/CMakeLists.txt` — top-level CMake script Gradle's externalNativeBuild calls; shells out to Node scripts that produce the actual JS bridge + native lib.
- `script/build_android.js` — emits the per-ABI CMake parameter list into the file given as 3rd argument (consumed by `script/CMakeLists.txt`).
- `script/build_android_assets.js` — copies dependency data assets into the app's `android/app/src/main/assets/crossbind` (gradle config phase).
- `script/build_android_deps.js` — source-rebuilds dependencies flagged via `crossbind.overrides.js` / `CROSSBIND_REBUILD_DEPS`; prints `CROSSBIND_DEPS_STAMP=` for `build.gradle`.
- `script/resolveBuildTarget.js` — shared Android buildTarget resolution used by the two scripts above.
- `script/build_ios.js` — runs `crossbind build -p ios` + `createXCFramework`. Skips the native build when inputs are unchanged (see `iosLibCache.js`); force with `CROSSBIND_NO_IOS_CACHE=1`.
- `script/iosLibCache.js` — content-hash stamp (`.crossbind/build/ios-libs-stamp-<buildType>.json`) plus mtime-pinned xcframework outputs (plugin dir can be shared between apps) deciding whether `build_ios.js` can skip.
- `script/build_js.js` — generates the JS-side bridge module Metro bundles. Skips Metro when inputs are unchanged (see `bridgeCache.js`); force with `CROSSBIND_NO_BRIDGE_CACHE=1`.
- `script/bridgeCache.js` — content-hash stamp (`.crossbind/build/bridge-stamp-<platform>.json`) over app + dependency sources deciding whether `build_js.js` can skip Metro.
- `script/getCliPath.js` — resolves the crossbind CLI path inside Gradle's CMake context. Deliberately state-free: CMake parses its stdout, so it must never load crossbind config (which can log to stdout).
- `cpp/` — C++ glue used by the JSI bridge.
- `js/` — JS-side runtime that user code imports.
- `crossbind.config.mjs` — plugin's own crossbind config (used to expose its native helpers as deps).

Sibling packages:
- `plugins/react-native-ios-helper/` — small iOS-side podspec helper.
- `plugins/metro/` — Metro bundler integration.

## Build flow on Android

1. User runs `pnpm android` (or `react-native run-android`).
2. Registered gradle tasks (`crossbindBridges`, `crossbindDeps`, `crossbindAssets` — wired before `preBuild`/`configureCMake*`) run the scripts; no process runs at configuration time, so the build is **configuration-cache compatible**. Each script content-caches itself, so the always-run tasks cost ~1 s warm.
3. `crossbindAssets` copies dependency data into **this library's own** `android/src/main/assets/crossbind` (AGP merges library assets into the APK — no cross-project mergeAssets coupling); `crossbindDeps` refreshes `.crossbind/deps-stamp` only when the consumed rebuilt-dependency set changes.
4. Gradle's externalNativeBuild fires `script/CMakeLists.txt` per requested ABI (intersection of `reactNativeArchitectures` with arm64-v8a/x86_64). The stamp file is registered as `CMAKE_CONFIGURE_DEPENDS`, so ninja re-runs the configure automatically when it changes.
5. CMake calls `node script/build_android.js <abi> <buildType> <paramsFile>` and reads one `-DKEY=VALUE` per line from that file (stdout is the crossbind log channel — never print params there).
6. CMake builds `lib<name>.so` via `getCmakeParameters` output, links JSI/fbjni from the ReactAndroid prefab, and the result lands in the app's APK.

## Build flow on iOS

1. User runs `cd ios && pod install && cd ..`.
2. CocoaPods discovers `react-native-crossbind.podspec`; the podspec's `prepare_command` runs `node script/build_js.js ios && node script/build_ios.js Debug`.
3. `build_ios.js` invokes `createLib` + `createXCFramework` for both `iphoneos` and `iphonesimulator`.
4. The xcframework is vendored into the app via the podspec's `vendored_frameworks`.
5. Subsequent `pnpm ios` builds use the cached xcframeworks; rerun `pod install` to refresh.

## Build flow on JS side

`@crossbind/plugin-metro` (sibling) hooks Metro's resolver/transformer to:

- Treat `.h` files as importable JS bridge modules.
- Watch native source dirs and trigger Metro reloads when bridge code regenerates.

## Invariants

- **arm64e + x86_64-simulator slices are dropped** for iOS. xcframework names are `ios-arm64` and `ios-arm64-simulator` — no `arm64e` or `x86_64`. The state/index.js path-resolution logic depends on this.
- **Podspec's `EXCLUDED_ARCHS[sdk=iphonesimulator*] = x86_64`** is mandatory. Apple Silicon Macs running the iOS simulator fail to link otherwise.
- **`script/CMakeLists.txt`** is invoked by **Gradle**, not by `crossbind build` directly. Its responsibilities differ from the crossbind asset CMakeLists; don't conflate them.
- **`build_android.js` / `build_ios.js` shell out to `crossbind` programmatically**, not via the CLI. They import `crossbind` exports directly (`createLib`, `buildWasm`, `createXCFramework`).

## Common pitfalls

- **Editing `script/CMakeLists.txt` to do work it shouldn't.** It's a glue layer; real work belongs in the Node scripts it calls.
- **Forgetting to `pod install` after touching the podspec or sibling iOS helper.** iOS won't see the change.
- **Adding an arm64e or x86_64 simulator branch.** We dropped support deliberately. Any new CI matrix entry that includes them will fail.
- **Hardcoding paths inside scripts.** Use `state.config.paths.*` from `crossbind`; the asset reorg moved several base paths.
- **Forgetting `script/build_js.js` step.** iOS podspec's prepare_command runs it before `build_ios.js`; CI workflow does too. Bridge JS is the link Metro relies on.

## Validation

Strict gate (RN plugin → both mobile examples and their E2E fixtures):

```bash
pnpm run ci:linux:build && pnpm run e2e:dev && pnpm run e2e:prod
```

Mobile-specific (require macOS for iOS, Android SDK for Android):

```bash
# Android (Linux/macOS)
pnpm --filter=@crossbind/example-mobile-reactnative-cli android
pnpm run e2e:android

# iOS (macOS only)
cd examples/mobile-reactnative-cli/ios && pod install && cd -
pnpm --filter=@crossbind/example-mobile-reactnative-cli ios
pnpm run e2e:ios
```

CI workflows: `.github/workflows/test-{android,ios}-sample.yml`.

## Reference

- Sibling iOS helper: `plugins/react-native-ios-helper/`
- Sibling Metro plugin: `plugins/metro/`
- Integration recipes: `docs/playbooks/integration/react-native-cli.md`, `docs/playbooks/integration/react-native-expo.md`
- Canonical examples and fixture: `examples/mobile-reactnative-cli`, `examples/mobile-reactnative-expo`, `e2e/mobile-reactnative-cli`
- iOS CI workflow (uses bridge cache): `.github/workflows/test-ios-sample.yml`
