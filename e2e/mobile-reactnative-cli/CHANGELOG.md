# @crossbind/example-mobile-reactnative-cli

## 2.0.0-beta.50

### Patch Changes

- The app identifier is now `dev.crossbind.…`, and the sample and the conformance playground no
  longer share one, so both can be installed side by side. Android needs `android/build` and
  `android/app/build` removed after this: `gradlew clean` fails in the native step and never
  runs, and React Native's autolinking caches the old package name at the project level.

## 1.0.1

### Patch Changes

- Updated dependencies
  - @crossbind/core-embind-jsi@1.0.3
  - @crossbind/plugin-metro@1.0.2
  - @crossbind/plugin-react-native@1.0.2

## 1.0.0

### Major Changes

- 🚀 first stable release

### Patch Changes

- Updated dependencies
  - @crossbind/example-lib-prebuilt-matrix@1.0.0

## 1.0.0-beta.4

### Patch Changes

- chore: add initial version of CHANGELOGS files
- Updated dependencies
  - @crossbind/example-lib-prebuilt-matrix@1.0.0-beta.32
