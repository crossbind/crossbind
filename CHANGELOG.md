# crossbind

## 2.0.0-beta.54

Only `@crossbind/plugin-react-native` moves. Nothing published depends on it - the three packages
that do are all private samples and fixtures - so the rest of the beta.53 set stays as it was
tested.

### What is in it

- **The React Native plugin tarball is 18 kB instead of 16 MB.** Its ignore list named the current
  xcframework directly, so when the rename left a directory behind under the old name, that one was
  packed: 30 MB unpacked of a static library nothing links against. The list matches `*.xcframework`
  now, so no name can slip past it again. The xcframework an iOS build produces was never shipped
  and still is not - it is built on the consuming machine, which is why nothing was broken by
  carrying the wrong one.

## 2.0.0-beta.53

beta.52 reached npm only in part: 33 of 107 packages published before the run stopped, and every
package that carries an OpenSSL binary was on the wrong side of that line - so the security patch
had not actually shipped. The run stopped because the CLI it had just published turns rebuilds on
without being able to finish one; that is fixed here, and the whole set moves to beta.53 so what is
on npm is again one build.

### What is in it

- **Rebuilds finish.** The source stamp added in beta.52 makes a `nativeVersion` bump rebuild the
  library instead of serving the previous one. It did not clear what the previous upstream release
  left behind, so the rebuild it triggered then failed wherever an install step could not overwrite
  a file it had not created - a read-only `geos-config`, a SQLite man page under a Docker bind
  mount. The stale configure output and staged install tree are now removed first.
- **The OpenSSL 4.0.2 patch ships.** Every OpenSSL target and everything that statically links it -
  the curl family and the GDAL WASI command - is republished from one clean build of the whole
  matrix.

### Upgrading

Reinstall to pick up the patched TLS stack. Nothing to change in application code.

## 2.0.0-beta.52

Every package moves together this time. beta.51 argued against republishing unchanged packages, and
that argument still holds for an ordinary fix - but this release carries a TLS security patch that
reaches consumers through statically linked artifacts. A caret range cannot tell anyone which tarball
contains the patched stack; one baseline number can. So the whole set is pinned at beta.52 and
published as one tested set.

### What is in it

- **OpenSSL 4.0.2.** A security patch release fixing seven CVEs, the most severe Moderate: a QUIC
  double free, a heap buffer overflow in CMS key unwrapping, an invalid pointer dereference in the
  CMP server, unbounded QUIC queue growth, an RPK certificate dereference, excessive DTLS record
  buffering and a client-side OCSP memory leak. Every OpenSSL target was rebuilt from the new
  source, and every package that statically links it - the curl family and the GDAL WASI command -
  was rebuilt against it.
- **A prebuilt library is rebuilt when its upstream source changes.** The build cache keyed on the
  existence of the output alone. Bumping `nativeVersion` and rebuilding therefore produced binaries
  of the previous upstream release, while the manifest, provenance and licence metadata already
  named the new one - a stale binary published under a patched version number. The cache now carries
  a stamp of the upstream version and the recipe source hash, and misses when either moves.

### Upgrading

Nothing to change in application code. Reinstall to pick up the patched TLS stack; if you vendor the
prebuilt artifacts, rebuild rather than reusing the beta.50 output.

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
