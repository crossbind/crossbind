# crossbind

## 2.0.0-beta.50

The first release published under the crossbind name. cpp.js shipped to npm; crossbind has not, so
this is where the new name starts — and every package in the workspace is pinned to this one
version rather than carrying whatever number its own history had reached. From here the numbers
move together.

### What is in it

- **A host build no longer needs nightly Rust.** Shared-memory wasm used to rebuild the Rust
  standard library with `-Zbuild-std` on a nightly toolchain unless the build ran in the container.
  The sysroots the image ships are now readable by a host build as well, pulled from the published
  image itself rather than a repackaged copy, so both paths link the same std and neither needs
  nightly.

- **Cargo dependencies build themselves.** An app whose dependency graph contains a cargo package
  used to need that package built by hand first, which was written down nowhere. On wasm, skipping
  it produced a clean build and a module that died at init.

- **Identifiers moved to `dev.crossbind`.** Generated iOS and macOS frameworks, and the sample
  apps, now carry the new organisation's name. This is the breaking part of the release.

- **The toolchain images are signed.** 1.0.2 is published to GHCR, mirrored to Docker Hub with
  identical digests down to the layer, and signed so both registries can be verified independently.
  A release only earns its stable tag after every one of those checks passes on exactly the bytes
  that were gated.

### Note on versions

The image family (1.0.2) and the npm packages (2.0.0-beta.50) are versioned separately on purpose:
the toolchain moves when its compilers move, the packages move when their code does.
