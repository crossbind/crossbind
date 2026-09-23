# crossbind

<!-- release-notes:start -->
<!-- Generated from releases/crossbind/<version>.md by scripts/release/render-changelog.mjs. Edit the note, then run `pnpm changelog`. -->

## 2.0.0-beta.60

Reaches the JavaScript runtime through React Native's TurboModule path, compiles at the 2020 C++ standard, and moves Android onto NDK r30 LTS.

### Highlights

- Installs the React Native bindings the way the framework intends. iOS implements
  `getTurboModule:` and `RCTTurboModuleWithJSIBindings`; Android implements
  `TurboModuleWithJSIBindings` and hands back a `BindingsInstallerHolder`. React Native invokes the
  installer once per module instance, on the JS thread, which is what used to be held together by a
  `runOnJSQueueThread` dispatch on one side and a JavaScript guard on the other.
- Leaves two surfaces React Native no longer offers for library use: `RCTCxxBridge`, which 0.87
  removes outright, and `getJavaScriptContextHolder()`, which is marked unstable and returns a
  nullable the old code dereferenced unchecked.
- Moves the Android toolchain to NDK r30 LTS, installed from its own verified archive and reached
  through a path that does not carry the version, so a consumer is not pinned to the exact release
  the image happens to ship.
- Updates the bundled native sources: expat 2.8.5, which carries the fix for CVE-2026-93990.
- Raises the pinned toolchain images to 1.0.6, with Rust 1.98.1 and Node 24.21.0.
- Publishes every workspace package on one common version again. beta 59 shipped two packages, so
  the tree had drifted apart.

### Breaking changes

- C++ sources compile at the 2020 standard instead of 2017. React Native 0.87's `react/bridging`
  headers need it, and leaving one target on a different standard from the rest of the tree is
  worse than moving all of them. Code that uses `requires` or `concept` as an identifier no longer
  compiles.
- Android builds against NDK r30. A project that pins its own NDK has to move with it.
- The React Native integration is verified against 0.87. The generated bootstrap now resolves the
  native module through `TurboModuleRegistry` rather than `NativeModules`.

### Migration notes

- Rename any identifier called `requires` or `concept` in C++ that crossbind compiles. The
  distribution template that links a published port stays at the 2011 standard, so consuming a
  prebuilt port is unaffected.
- Set `ndkVersion` to r30 in an Android project that declares one.
- Move a React Native app to 0.87. An app that reached `NativeModules.RNJsiLib` directly should use
  the generated bootstrap instead.

## 2.0.0-beta.58

Binds C++ pointer surfaces and whole Rust crates, and moves every package onto one train.

### Highlights

- Binds C++ pointer surfaces: pointer handles with explicit string helpers, types declared in
  another header, function-pointer callbacks, C struct handles, dependency bridges with
  registration guards and smart-pointer wrappers. Port headers that used to be skipped now
  compile and their declarations are callable.
- Binds Rust end to end, from a plain `.rs` file, a cargo package or a `cargo:` crate import.
  The generator carries the narrow integers, `f32`, `usize`, `char`, collections, typed arrays,
  tuples, JSON records, optionals, newtypes, enums, value objects, class properties,
  self-returning methods, shared handles and closures, plus module constants.
- Raises the pinned toolchain images to 1.0.4, which is what carries the SWIG fork the bindings
  are generated with.
- Updates the bundled native sources: curl 8.22.0, expat 2.8.4, GEOS 3.15.0 and PROJ 9.9.0.
- Publishes every workspace package on one common version again.

### Breaking changes

- iOS builds target 15.1 instead of 13.0. Xcode 27 refuses anything lower, and React Native's own
  floor is 15.1.
- An iOS app must adopt the UIScene lifecycle. The iOS 27 SDK traps an application that does not.
- A Rust `Option` return arrives as `null` on every runtime. It used to arrive as `undefined` on
  some of them.
- A 64-bit Rust parameter takes a BigInt or an exactly representable Number. A Number outside the
  safe integer range is rejected instead of silently rounded.

### Migration notes

- Raise `IPHONEOS_DEPLOYMENT_TARGET` to 15.1 in existing iOS projects.
- Add a scene delegate and the scene manifest to an existing iOS app. The React Native template
  under `create-crossbind` shows the shape.
- Compare a Rust optional against `null`, and pass a BigInt for an `i64` or `u64` argument outside
  the safe integer range.

### Fixes

- An error raised from a Rust binding keeps its `code` across a worker boundary and on the React
  Native runtime, where the host exception used to be rewritten.
- An extracted native source records the archive it came from, so a version bump re-extracts
  instead of compiling the previous release from a cache that still looked current.
- The React Native bridge and iOS library caches see header, native and module roots that live
  outside the project.

### Known limitations

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train, and the npm `latest` dist-tag keeps pointing at an older beta until then.
- Rust trait objects, generic functions, methods that consume `self`, `Send + 'static` closures
  and `i128` are not bindable, and they are reported as documented skips.
- `async fn`, inline modules as namespaces, the iterator protocol on a class, and an `Option` of
  an enum or a value object are wanted but not carried yet.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

## 2.0.0-beta.56

Hardens Crossbind's package release chain and refreshes its supported build toolchains.

### Highlights

- Moves the repository and published CLI contract to Node.js 24.
- Refreshes the supported Rust, Emscripten, WASI SDK and Android build toolchains.
- Introduces an exact-artifact npm release train with Trusted Publishing, provenance verification
  and version-specific GitHub Releases for `crossbind`.
- Adds automated dependency, native-source and published toolchain-image security monitoring.

### Breaking changes

- Node.js 24 or newer is now required by `crossbind` and `create-crossbind`.

### Migration notes

- Upgrade development and CI environments to Node.js 24 before installing this beta.
- Continue installing prerelease packages through the npm `beta` dist-tag.

### Fixes

- Toolchain image selection now reads one canonical, digest-pinned table shipped with the CLI.
- Package and image release workflows fail closed on integrity, provenance, tag or asset conflicts.

### Known limitations

- Beta 55 published only the `crossbind` CLI: the train stopped when the pinned npm 12 CLI
  changed its `view --json` output shape and the registry verification never matched. Beta 56
  republishes the complete package set; do not pair `crossbind@2.0.0-beta.55` with other
  packages from that train.

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

## 2.0.0-beta.55

Hardens Crossbind's package release chain and refreshes its supported build toolchains.

### Highlights

- Moves the repository and published CLI contract to Node.js 24.
- Refreshes the supported Rust, Emscripten, WASI SDK and Android build toolchains.
- Introduces an exact-artifact npm release train with Trusted Publishing, provenance verification
  and version-specific GitHub Releases for `crossbind`.
- Adds automated dependency, native-source and published toolchain-image security monitoring.

### Breaking changes

- Node.js 24 or newer is now required by `crossbind` and `create-crossbind`.

### Migration notes

- Upgrade development and CI environments to Node.js 24 before installing this beta.
- Continue installing prerelease packages through the npm `beta` dist-tag.

### Fixes

- Toolchain image selection now reads one canonical, digest-pinned table shipped with the CLI.
- Package and image release workflows fail closed on integrity, provenance, tag or asset conflicts.

### Known limitations

- This remains a prerelease. Stable compatibility guarantees begin with the first `2.0.0` stable
  train.
- Native toolchain images remain a separate GHCR release stream and are identified by exact image
  digests rather than npm package versions.

<!-- release-notes:end -->

## 2.0.0-beta.54

Two packages move: `@crossbind/plugin-react-native` and `create-crossbind`, which scaffolds it.
Nothing published depends on the plugin - the three packages that do are private samples and
fixtures - so the rest of the beta.53 set stays as it was tested.

### What is in it

- **The React Native plugin tarball is 18 kB instead of 16 MB.** Its ignore list named the current
  xcframework directly, so when the rename left a directory behind under the old name, that one was
  packed: 30 MB unpacked of a static library nothing links against. The list matches `*.xcframework`
  now, so no name can slip past it again. The xcframework an iOS build produces was never shipped
  and still is not - it is built on the consuming machine, which is why nothing was broken by
  carrying the wrong one.
- **`create-crossbind` scaffolds the fixed plugin.** A new Expo project was still getting
  the beta.53 plugin - the Expo template pins its crossbind dependencies exactly rather than by
  range, so the caret that carried the fix into every other template did not reach it.

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

## 1.0.4

Published as `cpp.js@1.0.4`, the package's previous name, on 19 January 2025. 1.0.1 and 1.0.2 shipped
in the two days before it without release notes.

### Patch changes

- Works around a race condition with TurboModules on Android.
- Includes `prebuilt/*/{config.general.name}/*.h` in the dependency header search paths.

## 1.0.0

🚀 first stable release. Published as `cpp.js@1.0.0` on 17 January 2025, after the 1.0.0 alpha and beta
series that ran from August 2024 to January 2025; the 0.x line before it, from 0.1.0 in January 2023 to
0.6.1, was published under the same name.
