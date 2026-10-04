# ADR-0013: Build ConanCenter packages behind a `conan:` header scheme

- **Status:** Proposed
- **Date:** 2026-10-03
- **Affects:** `getDependFilePath.js`, bundler plugins (vite/rollup/webpack), the React Native bridge script, iOS build script and podspec, the top-level `conanDependencies` map, `.crossbind/conan/`, `tooling/docker/base.Dockerfile`, `runConan.js`

## Context

crossbind ships 16 ports, each a curated recipe with platform variants published to npm.
ConanCenter has about 1,950 recipes for C and C++ packages, each with pinned sources (URL and
SHA-256), a license and its own build logic, and Conan 2.18 and later cross-build for Emscripten
(`compiler=emcc`). `cargo:` (ADR-0007) already lets an app import a crates.io crate directly. A C
or C++ package needs no generated bridge: its headers bind through the same SWIG path as a port's.
What was missing is the store: building the package with crossbind's toolchain, and laying it out
where the dependency machinery looks.

The constraints:

- Every archive linked into one wasm module must share exception handling, SIMD, thread and
  memory64 flags, and emcc promises no ABI between versions.
- ConanCenter publishes no WebAssembly binaries, so every package builds from source once.
- Conan takes its home from `CONAN_HOME` or a `.conanrc` above the working directory, and its cache
  takes one writer at a time.
- A Conan home holds code Conan runs (plugins, hooks) and the settings and remotes every recipe
  obeys, and the recipes it builds can write to it. Everything `conan install` reports — names,
  folders, libraries, licenses — is computed by recipe code.
- SWIG reads a header's includes when it binds it, and caches an interface made without them.

## Decision

A top-level `conanDependencies` map declares packages, and `conan:<package>/<header>` imports a
header of a declared package. Rules:

- The scheme follows ADR-0007: an undeclared import fails, and only declared packages are
  importable; a package another one requires still links.
- crossbind writes the Conan host profile from its own toolchain: the emcc version read from the
  emcc that runs Conan, `compiler.threads=posix` on `mt`, the flags of `archiveFlags.js` (the list
  port and app archives use) in every flag conf and in the package id, and `*:shared=False`. For
  Android it is the android image's NDK, read for its clang version, with the API level of
  `androidToolchain.js` and the NDK's default `c++_static`, as the ports' Android archives are built.
  For iOS it is Xcode's clang, read through `xcrun` under the `DEVELOPER_DIR` of `iosToolchain.js`,
  for the device or the simulator SDK, arm64, the deployment target of `iosToolchain.js` and
  `libc++`. It passes no bitcode flag: Xcode 27's linker takes the "marker" of
  `-fembed-bitcode-marker` for a file when CMake links its compiler check. A `settings_user.yml` in
  the run's home lets any apple-clang version through, so a Conan older than the Xcode still works.
- Conan runs where the build runs: in the toolchain image, which carries Conan 2.33 in a venv of
  hash-pinned wheels, behind an allowlisted environment and a lock around every install. iOS
  packages build on the Mac whatever the runner, since Xcode runs nowhere else, with the conan on
  the `PATH` (2.19 or later) and the `RUNNER=LOCAL` store. crossbind asks that conan its version
  from a home of its own, since conan migrates the home it starts in. On a Mac a run puts links to
  Xcode's `ar`, `as`, `nm` (`llvm-nm`), `ranlib` and `strip` first on its `PATH`: a GNU `ar` ahead
  of Apple's (Homebrew's binutils) writes archives Apple's linker cannot read, and recipes, the build
  tools they build and Meson all take these tools by name.
- Every install gets a fresh work directory holding its inputs, its outputs and a Conan home of its
  own, pinned by a `.conanrc` in the working directory and deleted with it. Only the package store
  persists: `~/.crossbind/conan/store`, the one directory a run container mounts besides its work
  directory. The project is not mounted. `RUNNER=LOCAL` keeps a store of its own, since conan runs
  the recipes it finds in its store and containers write to theirs.
- Everything the graph reports is checked before use: names, versions and library names must be
  plain names, every path must resolve inside the package's own folder in the store, and links are
  followed only within it. The manifests are checked again when state reads them.
- Each package is staged as a port prebuilt under
  `.crossbind/conan/packages/<package>/dist/prebuilt/<target>/` with a generated
  `dist/prebuilt/CMakeLists.txt`, and joins the config as a dependency through a manifest per
  target, since a recipe can require other packages on another platform. State reads them at load
  without running anything, and again when a build has staged more since. The link, `isEnabled`,
  SWIG's target-neutral header identity and the license rows then work unchanged. For iOS, where
  state reads a dependency's headers and archive out of an xcframework, both SDKs are staged
  together and each library gets an xcframework with a slice for each.
- Packages are installed when a build starts, before any header is bound, for release targets. A
  stamp per target records the inputs (stage format, dependencies, profile, toolchain, `conan.lock`),
  so an unchanged build runs no Conan.
- `conan.lock` next to the config pins versions and recipe revisions; a new requirement extends it.
- Web, Android, iOS, Linux addon and macOS addon builds, for now. A React Native build installs the
  packages before Metro bundles the bridges, for the target Metro reads headers with; a Metro server
  that loaded state before them attaches them on its next `conan:` import or bridge. On iOS the
  React Native plugin copies the xcframeworks into its own `conan/` directory, which its podspec
  vendors, so they link with plain `-l` flags. CocoaPods links what it finds at `pod install`, so a
  changed `conanDependencies` needs another `pod install`; the pod's script phase refreshes the
  archives a new package version restages. Linux addons build in the linux image with the ports'
  clang wrappers; glibc and musl builds share every Conan setting, so a profile conf naming the C
  library takes part in the package id, and a musl build is a cross build even on a machine of the
  same arch, since the image runs no musl program. macOS packages build on the Mac, as iOS ones do,
  with the clang xcode-select picks, as the macOS ports are built. A Node build reads the app's
  headers for its first desktop target, Linux before macOS, which it stages anyway, instead of the
  first wasm target, which it would have to build every package for. An addon links the system
  libraries and frameworks each recipe declares for its target; a framework goes as one
  `-Wl,-framework,<name>` argument, since CMake collapses a repeated `-framework`.

## Consequences

- **Positive** — about 1,950 recipes are reachable without writing a port. Pinned sources, licenses
  and recipe revisions reach the SBOM. The binding layer serves C APIs directly and C++ through the
  app's own headers, exceptions included.
- **Negative** — a first build compiles every package from source, which takes seconds to minutes
  per package. Recipes support Emscripten unevenly. Recipes run Python and build systems, which is
  why they run in the image. The store they share is writable by every one of them, so a hostile
  recipe can change packages other projects take from it later — the exposure cargo's shared
  registry cache already has; a store per project would close it at the cost of rebuilding every
  package per project. The images carry one more pinned toolchain (a 19 MB venv). iOS and macOS
  take the user's own Conan, outside the pinned images. WASI is out of reach, since Conan has no
  WASI target; Windows Node.js addons are still to wire.

## Alternatives considered

- **Users run Conan and point crossbind at the output** — rejected: flags and toolchain versions
  drift apart, which brings back the wasm exception-handling mismatch the shared flag list prevents.
- **A bare `conan:<package>` with the headers listed in config** — rejected: a header in the
  specifier mirrors the port header import and names its own origin.
- **Conan's standalone executable instead of a venv in the image** — rejected: 70 MB with its own
  Python, and without the license texts of most of what it bundles.
- **Installing at state load** — rejected: commands that never build (`crossbind config`) would
  start Docker. Build start reaches every bundler and the CLI.
- **One shared home, or a read-only one baked into the image** — rejected: a shared home carries
  whatever a recipe writes into it to every later install, and Conan opens its login store
  (`<home>/.conan.db`) for writing on every run, so it cannot be mounted read-only. A home per run
  needs no image change.
- **Generating a port from a Conan recipe** — a different decision: ports stay the curated,
  published packages.
- **Merging the iOS archives into the bridge archive the podspec force-loads**, as app-local Rust
  crates are — rejected: it loads every object of every package into the app, and clashes with any
  other force-loaded copy of the same library. Vendoring keeps the link to what the app uses, at
  the cost of a `pod install` when the package list changes. A spike linked and ran both ways.
- **Building iOS packages in Docker** — not possible: Conan drives the recipe's build itself, and
  Xcode only runs on the Mac.

## See also

- Related ADRs: ADR-0007 (cargo scheme), ADR-0009 (toolchain images)
- Related code: `core/crossbind/src/utils/conan*.js`, `core/crossbind/src/utils/runConan.js`,
  `core/crossbind/src/state/attachConanDependencies.js`, `core/crossbind/src/actions/prepareConanDependencies.js`,
  `plugins/react-native/script/build_ios.js`, `plugins/react-native/react-native-crossbind.podspec`,
  `docs/api/conan.md`, `e2e/web-vite-conan`
