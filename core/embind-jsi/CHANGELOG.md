# @crossbind/core-embind-jsi

## 2.0.0-beta.60

### Patch Changes

- Supplied the `std::char_traits<unsigned char>` that embind's raw-byte string binding needs. The
  standard has never defined one, and libc++ used to instantiate the primary template anyway; from
  the release NDK r30 ships it static_asserts instead, so naming
  `std::basic_string<unsigned char>` stopped compiling at all. The binding is unchanged, and the
  traits cost nothing on the toolchains that did not need them.

## 2.0.0-beta.53

### Patch Changes

- Republished as part of the complete 2.0.0-beta.53 set. beta.52 reached npm only in part.

## 2.0.0-beta.52

### Patch Changes

- Aligned on the 2.0.0-beta.52 baseline. No source change; the version exists so every package in
  the workspace names the same release.

## 2.0.0-beta.50

### Patch Changes

- Aligned on the 2.0.0-beta.50 baseline. No source change; the version exists so every package in
  the workspace names the same release.

## 1.0.3

### Patch Changes

- fix: workaround for race condition with turbomodule in android.

## 1.0.0

### Major Changes

- 🚀 first stable release

## 1.0.0-beta.28

### Patch Changes

- chore: add initial version of CHANGELOGS files
