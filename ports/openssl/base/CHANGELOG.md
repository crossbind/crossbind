# @crossbind/port-openssl

## 2.0.0-beta.53

### Patch Changes

- Republished in the complete set. The beta.52 publish stopped before any OpenSSL platform
  variant reached npm, so the 4.0.2 security patch had not shipped.

## 2.0.0-beta.52

### Patch Changes

- Updated OpenSSL to 4.0.2, a security patch release fixing seven CVEs, and rebuilt every
  target from the new source. The most severe is Moderate.

## 2.0.0-beta.50

### Patch Changes

- Rebuilt in the 1.0.2 toolchain image — Rust 1.98.0, Emscripten 6.0.2. The recipe and the
  upstream source are unchanged; what moved is the compiler the binaries were produced by.

## 1.0.0

### Major Changes

- 🚀 first stable release
