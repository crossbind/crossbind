# @crossbind/plugin-webpack

## 2.0.0-beta.50

### Patch Changes

- A cargo dependency no longer has to be built by hand before the app. The dependency step this
  plugin already awaits builds one whose target is missing, and refuses to link one it could not
  build — on wasm that case used to pass silently and leave a module that died at init.

## 1.0.2

### Patch Changes

- Updated dependencies
  - crossbind@1.0.4

## 1.0.0

### Major Changes

- 🚀 first stable release

### Patch Changes

- Updated dependencies
  - crossbind@1.0.0

## 1.0.0-beta.10

### Patch Changes

- chore: add initial version of CHANGELOGS files
- Updated dependencies
  - crossbind@1.0.0-beta.33
