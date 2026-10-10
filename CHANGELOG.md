# crossbind

<!-- release-notes:start -->
<!-- Generated from releases/crossbind/<version>.md by scripts/release/render-changelog.mjs. Edit the note, then run `pnpm changelog`. -->

## 2.0.0-beta.63

Makes only the binaries a build names and links native executables, adds the linuxmusl platform and ready-made Node.js packages, imports C and C++ packages from ConanCenter, runs toolchain steps on a remote runner, binds only the functions an app imports, and brings the C++ to Expo web and Electron.

### Highlights

### Build what you name

- `crossbind build -e` makes binaries only for the runtime environments it names: `browser`,
  `edge`, `node`, `native` or `wasi`, several separated by commas, or one `target.runtimeEnv` in
  `crossbind.config.js`. The Vite, Webpack, Rspack and Rollup plugins choose `browser` themselves
  and React Native links the archives, so projects built through them need no change.
- `-e native` links the project's `main()` (from `src/native`) with its dependencies into one
  executable per platform and architecture, such as `dist/app.linux-x64`. A `linuxmusl`
  executable is fully static and runs on any Linux; a `linux` one needs glibc 2.28, a macOS one
  macOS 11 and a Windows one Windows 10, each with the C++ runtime linked in.
  `npm create crossbind@beta -- my-app Native Executable` scaffolds one.
- The prebuilt archives of every library crossbind builds, the ports included, link in a C or C++
  build that is not crossbind: pkg-config files resolve through `${pcfiledir}`, `*-config` scripts
  find their prefix, libtool `.la` files are gone and dependencies are named by library. C++
  packages need clang with libc++ 19 or later on Linux. Reference: `docs/api/native.md`.

### Linux on musl and ready-made Node.js packages

- `-p linuxmusl` builds Node.js addons and executables for musl, x64 and arm64; an addon loads on
  Alpine 3.21 and newer. Every port family gains a `-linuxmusl` package, and `-p host` picks
  `darwin`, `win32`, `linux` or `linuxmusl` for the machine the build runs on.
- Every port has a `-standalone-napi` package, such as `@crossbind/port-zlib-standalone-napi`, that
  installs with no build and no Docker: npm picks the matching addon among eight platform packages
  (darwin, linux, linuxmusl and win32, arm64 and x64). Twelve ports also ship their command-line
  tools as WASI commands in a `-standalone-wasi` package, such as `curl-wasi` in
  `@crossbind/port-curl-standalone-wasi`.

### Node.js without a bundler

- `crossbind build -e node` writes one ES module per runtime binary (`dist/node/napi.mjs`,
  `dist/node/wasm.mjs` and `dist/edge/wasm.mjs`) and Node.js module hooks that serve an app's
  native imports from it: headers, a package's headers, `conan:` headers, the app's own `.rs` files
  and `cargo:` crates. A deployed app starts with `node --import ./dist/node/napi.register.mjs`.
- `node --import crossbind/node/dev` builds the machine's binary before the app starts whenever its
  native sources, config or native imports changed, also under `node --watch`.
- Rust packages, the app's own `.rs` files and `cargo:` imports link into Node.js addons for Linux
  (glibc and musl) and Windows, x64 and arm64, as they already did on macOS.

### `conan:` imports

- Declare packages from ConanCenter under `conanDependencies` in `crossbind.config.js` (a version,
  a Conan range or `{ version, options }`), then import a header such as `conan:zlib/zlib.h` or
  include the package's headers from your own. crossbind builds each package from source with its
  own toolchains and links it statically: web builds (wasm32 and wasm64, single- and
  multithreaded), React Native on Android and iOS, and Node.js addons for Linux, macOS and Windows.
- The first install writes `conan.lock` next to `crossbind.config.js`; commit it. Each import is
  typed, and `crossbind licenses` lists every package with its recipe's license, source and
  SHA-256. Reference: `docs/api/conan.md`.

### Smaller bindings, and more of C bound

- A header of a dependency, a port or a `conan:` package binds the free functions the app imports
  from it by name, besides all its classes and enums, and the library code only the other
  functions reach is linked out. On the site's JavaScript-only demos the wasm shrinks by 40% for
  OpenSSL, 47% for GEOS, 11% for zlib and 4% for GDAL. Dev servers bind a newly imported function
  when the file is saved.
- Function-like macros, macros naming a function, variadic functions and mutable globals bind when
  the app imports them by name: `deflateInit2(...)`, `iconv_open(...)`,
  `TIFFSetField(tif, TIFFTAG_XRESOLUTION, vaDouble(72))`, and `_libiconv_version` as a handle to
  its storage. Rule 10 of `docs/api/cpp-binding-rules.md` has the details.

### Remote runner

- crossbind runs its toolchain steps (C++ builds, cargo, Conan) on a runner instead of the local
  Docker: `crossbind config set RUNNER REMOTE` and
  `crossbind config set REMOTE_URL_WEB https://…` (also `_ANDROID`, `_LINUX` and `_WINDOWS`, or
  `REMOTE_URL` for every image), with the token in `CROSSBIND_TOKEN` or a per-image
  `CROSSBIND_TOKEN_WEB`.
  `CROSSBIND_RUNNER` overrides `RUNNER` for one build.
- `crossbind runner start` runs one on this machine's Docker, and
  `crossbind runner init fly|cloudflare|cloudrun|azure` writes a folder ready to deploy to Fly.io,
  Cloudflare Containers, Google Cloud Run or Azure Container Apps.
- Only native inputs travel, content-addressed, so an edit uploads only the changed file, and a
  file over 16 MB goes in resumable parts. Reference: `docs/api/remote-runner.md`.

### Expo web and Electron

- `@crossbind/plugin-metro` builds an Expo app's C++ to WebAssembly for its web platform:
  `expo start --web` builds it on first load, and `crossbind-metro prepare-web` and `export-web`
  stage and link the release build around `expo export -p web`.
- `examples/desktop-electron` is an Electron app whose main process loads its addon; a packaged
  app reads the addon's data from `app.asar.unpacked`. Every example is now a `create-crossbind`
  template.

### Ports, licenses and images

- OpenSSL 4.0.3, expat 2.9.0 and SQLite 3.54.0. SQLite release builds now use `-O2` instead of no
  optimization, which runs `speedtest1` twice as fast.
- libiconv builds its extra encodings, libjpeg-turbo ships the TurboJPEG API, and curl's wasm
  build sends requests through a fetch transport that follows curl's options and reports progress.
- `crossbind licenses` lists every dependency package that is not private, not only ports, and
  `crossbind licenses -e node --package` writes each package's LICENSE, SBOM and license field.
- The pinned toolchain images move to 1.0.12: musl sysroots, Rust 1.99.0 with the Linux and
  Windows targets, Conan 2.33 and refreshed Debian packages.

### Breaking changes

- `crossbind build` makes binaries only for the runtime environments it is asked for, with `-e`
  or `target.runtimeEnv`. With neither, it makes the archives only and says so.
- `export.bundle` is removed: a `crossbind.config.js` that still sets it stops with a message.
  Packages published with it, such as the beta.62 ports, still build as dependencies.
- A Node.js build writes `dist/node/napi.mjs`, `dist/node/wasm.mjs` and `dist/edge/wasm.mjs`
  instead of one `.h.cjs` entry per header.
- A function of a dependency's header that no source imports by name is no longer bound:
  `const m = await initNative(); m.GDALVersionInfo()` fails unless something imports
  `GDALVersionInfo`.
- A host wasi-sdk (`WASI_SDK_PATH`, `CROSSBIND_WASI_SDK_PATH`) applies under `RUNNER=LOCAL` only;
  with the default runner a WASI build uses the SDK in the image, as CI does.

### Migration notes

- Add `-e` to each script that runs `crossbind build` for a binary: `-e node` for a Node.js addon
  or a wasm module for Node.js, `-e browser` or `-e edge` for a wasm module built outside a bundler
  plugin, `-e wasi` for a WASI command and `-e native` for an executable. A project that makes one
  kind of binary can set `target.runtimeEnv` instead.
- Delete `export.bundle` from `crossbind.config.js`. A library that set `bundle: false` needs
  nothing else.
- In Node.js, import a Node-API package from its root or its `node/napi` entry and
  `await initNative()` before using its names, instead of importing one of its headers.
- Import each function you call from the header that declares it
  (`import { GDALVersionInfo } from '@crossbind/port-gdal/gdal.h'`), or take the header whole with
  `import * as`, which still binds every function.
- For a WASI build with your own wasi-sdk, run `CROSSBIND_RUNNER=LOCAL crossbind build -p wasi`.
- The first build after the upgrade regenerates every interface and bridge.

### Fixes

### Bindings and runtime

- Two pending calls of one bound function, or a call made again from a callback it ran, no longer
  free each other's arguments, which broke the heap silently in release builds.
- `_JSPI` calls run one at a time, so suspended calls no longer overwrite each other's C stack.
- Worker handles convert to JSON and to strings, worker objects share the module's channel, and
  logging a worker module no longer raises an error in Expo's web dev server.
- `FS.writeFile` replaces a file that exists.
- A debug build takes an enum member for an integer parameter, and its pthreads start from the
  main script.
- C function-pointer struct fields bind, and a callback's `const char *` followed by its length
  arrives as a handle that `readBuffer` reads exactly.
- Generated types read constructors, byte strings and literals.
- An app served from a subpath (Vite `base`, webpack `publicPath`) finds its runtime.
- A header installed twice is bound once, and SWIG reads the headers of a CMake package that ships
  its sources.

### Builds

- A newer or deleted native source rebuilds the library.
- Parallel builds take turns compiling in Docker, configure-based installs finish on Docker
  Desktop and keep the extracted source's file times, and source downloads retry with backoff.
- A binary publishes only into an output folder of its own, and a package's data comes only from
  packages that serve the target.
- A `RUNNER=LOCAL` build pulls no Docker image, and cargo refuses a runner it does not know.
- The bundler plugins build dependencies before they transform an import.
- Node.js addons of several packages run in one process, and on Windows a C++ `long` (zlib's
  `uLong` among others) crosses as a Number instead of failing with unbound types.
- WASI writes after `SEEK_END` land at the end of the file.

### React Native

- A failed native build fails `pod install` instead of surfacing later in the app build.
- A change to the runtime JavaScript rebuilds the Android bundle.

### Ports

- curl's wasm build no longer overflows a buffer on a long custom method, reports network and CORS
  failures instead of `CURLE_OK`, honours `FAILONERROR`, `MAXFILESIZE` and `TIMEOUT`, and calls
  the header callback. Only http and https work in this build.
- GDAL's single-threaded wasm build runs thread-pool jobs in place, LERC no longer writes
  uninitialized Huffman padding, SpatiaLite's WASI programs link, and libwebp links its mux and
  demux libraries.
- The GEOS npm packages are licensed LGPL-2.1-only.

### Known limitations

- Native executables: the Windows ones and the x64 macOS one are built and checked, not run.
  Nothing points an executable at a port's data, so set `GDAL_DATA` and `PROJ_DATA`. Rust packages
  make no executable.
- `conan:` imports: no WASI builds. Web and React Native builds link a package's own archives
  only; the system libraries and frameworks its recipe declares reach Node.js addons alone.
  Templates do not bind, and packages come from ConanCenter only.
- Remote runner: a desktop build also needs a web runner, because SWIG runs in the web image for
  every platform but Android. Cloudflare Containers built two to three times slower than a recent
  Mac's Docker, the first start after a deploy can take over four minutes, and some networks refuse
  `workers.dev` names, which a custom domain avoids. Cloud Run keeps the build tree in memory, and
  an Azure runner scaled to zero takes about 33 seconds to answer.
- Expo web: Metro does not watch the C++ sources, so reload the page after an edit, and a
  multithreaded build needs COOP/COEP from the production host.
- An import whose specifier is built from variables is not seen by the scan; import the functions
  by name or bind the header whole.
- Macros, variadic functions and globals take numbers, enums, booleans, strings and pointers only.
  A variadic call takes up to six extra arguments, and each variadic function adds about 25 KB to a
  wasm module.

## 2.0.0-beta.62

Builds native Node-API addons for macOS, Linux and Windows, imports single Rust modules with cargo:, binds struct fields and imported constants through SWIG, and moves to toolchain images 1.0.8.

### Highlights

- Builds a native Node-API addon from the same bindings as the wasm build:
  `crossbind build -p darwin`, `-p linux` or `-p win32` writes one `.node` file per architecture
  (arm64 and x64) and a loader that `require` and `import` both load. macOS addons build on a Mac;
  Linux and Windows addons build on any host with Docker, in the new `linux` and `windows`
  toolchain images. A Linux addon runs on glibc 2.28 or later and a Windows addon on Windows 10 or
  later, each with the C++ runtime linked in. On macOS, Electron's main process loads the same
  addon.
- Every `@crossbind/port-*` family gains macOS, Linux and Windows packages, such as
  `@crossbind/port-gdal-darwin`, `-linux` and `-win32`, with arm64 and x64 archives for native
  addons. Nothing from the build machine goes into them; the data a port needs, such as
  `GDAL_DATA` and `proj.db`, lands in `dist/data`, and a new `binary.addonFlags` target spec names
  the system libraries a port links (libxml2 for GDAL on macOS, Winsock and the certificate store
  for curl on Windows).
- Imports one module of a crate through a `cargo:` path such as `cargo:xxhash-rust/xxh3`. Rust
  bindings also carry `std::io` streams as classes, `Option` of
  64-bit integers and of byte or float slices, `NonZero` integers, `mut` parameters and fixed-size
  arrays.
- Binds C struct fields through SWIG, so the compiler resolves typedefs SWIG never read: numbers
  and strings by value, enums as their integer, data pointers as handles or instances.
- Binds the `#define` values and `const` globals an app imports from a header as module
  constants. Only the imported names are registered, so a header with thousands of macros costs
  nothing until one is used.
- Adds `readBuffer` and `writeBuffer`, which copy bytes to a `Uint8Array` and from any
  `ArrayBuffer` or view of one.
- Prints each binding the generator skips (a variadic function, a mutable global, a static
  method named `length`) with its header and line.
- Raises the pinned toolchain images to 1.0.8.
- Publishes every workspace package on one common version.

### Breaking changes

- `targetSpecs[].specs.cmake` must be an object such as `{ compileOptions: ['-O3'] }`. The array
  form was never read; it now stops the build with a message.

### Migration notes

- Replace a `specs.cmake` array with `specs.cmake: { compileOptions: [...] }`, and move CMake
  configure flags (`-D...`) into a recipe's `getBuildParams`.
- The first build after the upgrade regenerates every bridge and rebuilds each cargo package once.

### Fixes

- A never-built cargo dependency builds in one run, and a cargo archive built from an older
  embind-rs is rebuilt instead of linking stale glue or clashing with another archive.
- An interface copied from a package's `.i` is regenerated when that file changes or goes away.
- Debug wasm builds reject a 64-bit Number that is not a safe integer, as release builds do.
- Two or more `compileOptions` no longer fail CMake configure.
- Building OpenSSL from source (`--rebuild-deps`) runs `make all` before `make install`, so the
  install step no longer races on its own object files.
- The documentation shows the settings the build reads: `specs.binary.emccFlags`,
  `getBuildParams(target, depPaths, ext, buildPath)` and the wasm stack size, and no longer
  describes `LOG_LEVEL` or a `getSource` recipe hook.

### Known limitations

- Constants bind only for names imported from a header, so `crossbind build` output for Node.js,
  a plain browser page or an edge runtime binds none. A constant first imported while a dev server
  runs binds after the server restarts.
- Native addons: no `worker_threads`, and Rust packages build for macOS only. The arm64 Windows
  and x64 macOS addons are built and linked but have not been run on those machines yet.

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
