# @crossbind/docker

## Unreleased — image family 1.0.5

### Patch Changes

- Moved the Android image to NDK r30 LTS (`30.0.16248370`), which carries clang 21 in place of
  r27d's clang 18. The Docker image, the Android sample workflow, both React Native Gradle projects
  and the React Native plugin module now name that same NDK; they previously named four different
  ones, so an app could link objects produced by two toolchains.
- The Android image installs the NDK from its own published archive, checked against the
  Google-published SHA-1 and a SHA-256 derived from those same bytes. It no longer carries a JDK,
  the Android command-line tools or `sdkmanager`. Command-line tools 16111833 turned `sdkmanager`
  into a shim that downloads a separately versioned "Android CLI" at build time and delegates the
  unpacking to it, which both breaks the pinned-bytes contract and left the NDK mode `0744`, so
  nothing was executable for the non-root user the image runs as.
- Refreshed the pinned `node:24.21.0-trixie-slim` and `rust:1.98.1-slim` base digests. Both tags
  name the same versions as before; upstream rebuilt them, and a digest pin cannot pick that up on
  its own, so the images carried whatever the distribution shipped when the digest was taken.

## Image family 1.0.4

### Patch Changes

- Updated the Crossbind SWIG fork to `844524ad2562f8f5a5f7ae2c7d4e230dded0b866`
  (Enhance embind C++ binding support), with a verified source archive SHA-256. The `base`,
  `web` and `android` images inherit the updated binding generator.
- Updated Node to 24.21.0 and moved the Rust bootstrap onto the now-published `rust:1.98.1-slim`
  image. The pinned toolchain is unchanged at Rust 1.98.1.
- The Rust stages now drop whatever toolchain the bootstrap image shipped by comparing it against
  the pin, instead of naming that version by hand in each Dockerfile, and assert that exactly one
  toolchain survives. The `base` image copies its Rust license texts through a `toolchains/*` glob,
  so a surviving second toolchain would have made that copy ambiguous.
- The `os` stage now applies the available Debian package upgrades before it installs the build
  tools. A digest-pinned base keeps the package versions it shipped with, so an already-patched
  package — such as the `gzip` fix for `CVE-2026-41992` — could not reach the images until Debian
  rebuilt the base tag itself. `--with-new-pkgs` lets a security fix bring a new dependency along
  without removing anything.

## Image family 1.0.3

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
