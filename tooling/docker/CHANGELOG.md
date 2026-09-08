# @crossbind/docker

## Unreleased — image family 1.0.3

### Patch Changes

- Updated the build toolchain to Node 24.20.0, Rust 1.98.1, Emscripten 6.0.9 and the stable
  wasi-sdk 34 release. The Crossbind embind overload patch is rebased directly onto Emscripten
  6.0.9 and is content-hash verified during the image build.
- Updated the Android SDK command-line installer to build 15859902 and verify its Google-published
  checksum. The Android NDK remains on the current r27d LTS release.
- Updated final WebAssembly links to use `em++` and removed the deprecated `WASM_BIGINT` setting,
  matching Emscripten 6 defaults. Image gates now compile and run the Crossbind type-overload
  extension and compile real C++ and Rust Android artifacts for both supported target arches.
- Made GHCR the only canonical registry so image publication needs no stored third-party registry
  credential. The release now produces and validates SLSA provenance and SPDX SBOMs, scans every
  platform digest for fixable high/critical vulnerabilities, signs through OIDC and is protected by
  the `toolchain-release` environment. All release actions and Buildx/Trivy versions are pinned.
- Images now default to uid/gid `10001:10001`; one-shot Crossbind builds additionally drop every
  Linux capability and set `no-new-privileges`. The default dry run is genuinely registry-write-free
  and scans its locally built image leaves before a writing run is considered.
- Refreshed the Debian base digest, replaced the Node image's bundled npm with the patched 11.19.1
  from a hash-verified tarball, pruned Emscripten's development-only npm dependencies and removed
  the NDK Python's unused setuptools, so the release scan reports no fixable high or critical
  finding in any image.

## 2.0.0-beta.50

### Minor Changes

- **The image family is 1.0.2, on Rust 1.98.0.** Stable moved, and a host build links against the
  sysroot these images ship — so a sysroot built by an older compiler is one nobody on current
  stable can use. The pinned Rust version now lives in `rust-sysroot.Dockerfile` alone and the
  scripts read it from there rather than repeating it.

- **The release is signed and mirrored.** Every image is published to GHCR, copied to Docker Hub
  with its referrer graph, and signed once by digest — root indexes and the android `linux/amd64`
  leaf the CLI pins directly. GHCR does not implement the OCI 1.1 referrers API and Docker Hub
  does, so the mode is declared per registry rather than negotiated, and the copy converts between
  them. A release earns its stable tag only after both registries agree byte for byte, both carry
  the same referrers, both verify the signature, and a near-miss certificate identity is refused.

### Patch Changes

- The sysroots are no longer packaged as a separate release artifact. A host build reads the same
  image layer over HTTPS, so there is one object instead of two and the channels cannot drift.

## 1.0.0

### Major Changes

- 🚀 first stable release
