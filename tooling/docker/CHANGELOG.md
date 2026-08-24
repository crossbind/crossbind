# @crossbind/docker

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
