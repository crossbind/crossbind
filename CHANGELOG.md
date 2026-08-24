# crossbind

## 2.0.0-beta.51

Only `crossbind` moves in this release. beta.50 said the numbers would move together from then on;
they do not have to, and here they should not. The fix is in the CLI alone, and every package that
depends on it was published with a `^2.0.0-beta.50` range, which already accepts beta.51 - so
republishing 107 unchanged packages would produce 107 identical tarballs under a new number and
throw away the fact that beta.50 was tested as one set. The versions move together when the change
does; a minor bump would still require the whole set, because a caret range does not cross one.

### What is in it

- **Android builds work on Apple Silicon again.** The pull that runs before bridge generation asked
  docker for the android image by its multi-arch index, which carries no arm64 leaf, so a fresh
  install on an Apple Silicon Mac failed with "no matching manifest for linux/arm64/v8" before it
  compiled anything. It now asks for the amd64 leaf, as the other three call sites already did.

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
