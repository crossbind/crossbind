# @crossbind/plugin-react-native

## 2.0.0-beta.54

### Patch Changes

- Stopped shipping a stale xcframework. The published tarball is 18 kB instead of 16 MB: the
  ignore list excluded the current xcframework by name, so the pre-rename directory left on disk
  was packed instead - 30 MB of a library nothing links. It matches by shape now. The xcframework
  a build produces was never published and still is not; it is built on the consuming machine.

## 2.0.0-beta.53

### Patch Changes

- Republished as part of the complete 2.0.0-beta.53 set. beta.52 reached npm only in part.

## 2.0.0-beta.52

### Patch Changes

- Aligned on the 2.0.0-beta.52 baseline. No source change; the version exists so every package in
  the workspace names the same release.

## 2.0.0-beta.50

### Patch Changes

- A cargo dependency no longer has to be built by hand before the app. The dependency step this
  plugin already awaits builds one whose target is missing, and refuses to link one it could not
  build — on wasm that case used to pass silently and leave a module that died at init.

## 2.0.0-beta.33

### Patch Changes

- fix: on a freshly installed plugin, the app's `configureCMake*` tasks could run
  before this library's TurboModule codegen output existed
  ("codegen/jni ... is not an existing directory"). Every other project's CMake
  configure is now wired to `generateCodegenArtifactsFromSchema` via
  `gradle.projectsEvaluated`, so fresh installs build without a manual unblock.
- feat: Rust binding wiring — the embind-rust adapter and app Rust bridge crates
  join the Android/iOS native builds; the Android dependency stamp now tracks
  Rust bridge/crate content so a first `cargo:`/`.rs` import links in one run.
- Added dependency: `@crossbind/core-embind-rust`.

## 1.0.2

### Patch Changes

- fix: workaround for race condition with turbomodule in android.
- Updated dependencies
  - @crossbind/core-embind-jsi@1.0.3
  - crossbind@1.0.4
  - @crossbind/plugin-metro@1.0.2

## 1.0.0

### Major Changes

- 🚀 first stable release

### Patch Changes

- Updated dependencies
  - crossbind@1.0.0
  - @crossbind/core-embind-jsi@1.0.0
  - @crossbind/plugin-metro@1.0.0

## 1.0.0-beta.43

### Patch Changes

- chore: add initial version of CHANGELOGS files
- Updated dependencies
  - crossbind@1.0.0-beta.33
  - @crossbind/core-embind-jsi@1.0.0-beta.28
  - @crossbind/plugin-metro@1.0.0-beta.38
