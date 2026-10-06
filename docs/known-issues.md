# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

## A failed native build does not fail `pod install`

`react-native-crossbind.podspec` runs the iOS build through Ruby's `system(...)`, which returns
false instead of raising, and the podspec does not read the result. A cmake failure is reported in
the log and then swallowed, so the error surfaces eight minutes later in the app build instead.

- Seen: 2026-09-22
- Check: `grep -n 'system(' plugins/react-native/react-native-crossbind.podspec` — the call has no
  `|| raise` and nothing inspects its return value.
- Remove when a non-zero exit from `build_ios.js` aborts `pod install`.

## The React Native Android release bundle keeps embind-jsi's old JavaScript

Gradle decides `createBundleReleaseJsAndAssets` is up to date from the app's own files, so a change
to `core/embind-jsi/js/embind.js` alone, reached through the workspace link, leaves the previous
bundle in the APK while the native libraries are rebuilt. A conformance run then tests new C++
against old glue and passes on what it did not load. iOS rebuilds its bundle on every build.

- Seen: 2026-09-25
- Check: after changing only `core/embind-jsi/js/embind.js`, `pnpm run run:android` in
  `e2e/mobile-reactnative-cli` prints `Task :app:createBundleReleaseJsAndAssets UP-TO-DATE`.
- Workaround: move `android/app/build/generated/assets/react/release` aside before building.
- Remove when a JavaScript-only change to a workspace package rebuilds the bundle.

## The React Native CLI sample's jest suite does not run

`@react-native/jest-preset` is not transformed, so the suite fails to start. It fails on `main` as
well, so this predates the 0.87 move, and no workflow runs it — the sample is only reached for the
iOS and Android e2e builds.

- Seen: 2026-09-22
- Check: `pnpm --filter @crossbind/example-mobile-reactnative-cli test` fails with
  `Jest encountered an unexpected token` at `@react-native/jest-preset/jest/setup.js`.
- Remove when the suite runs.

## The Expo sample is never installed in CI

`examples/mobile-reactnative-expo` keeps its own npm lockfile outside the pnpm workspace and no job
installs it, which is how its manifest and lockfile disagreed for months until `npm ci` was run by
hand.

- Seen: 2026-09-22
- Check: `grep -rl 'mobile-reactnative-expo' .github/workflows/` returns nothing.
- Remove when a job installs it.

## Most e2e fixtures never run in CI

The CI e2e legs run the `@crossbind/example-*` apps, the `port-zlib-wasi` and `port-zlib-linux`
e2e, and two of the thirteen `@crossbind/e2e-*` fixtures: `e2e-cli-native` and
`e2e-backend-nodejs-native-conan`. The other eleven are not built or run — the React Native one
included — so the conformance suites they carry never run either; besides the root `pnpm install`,
CI touches only `e2e-web-vanilla`, where `test-core.yml` runs `crossbind licenses --check`. Eight of
them depend on twelve or more ports while CI builds only zlib, and adding them was measured and
deferred on 2026-08-23. The `build-linux.yml` comment that explains the exclusion points to
AGENTS.md, which no longer says anything about it.

- Seen: 2026-08-22
- Check: `node -p "[...new Set(Object.entries(require('./package.json').scripts).filter(([k]) => k.startsWith('ci:')).flatMap(([, v]) => v.match(/e2e-[a-z-]+/g) ?? []))].join(' ')"` prints `e2e-cli-native e2e-backend-nodejs-native-conan`.
- Remove when every fixture runs in CI.

## Six of the nine gates in `pnpm run check` never run in CI

CI runs `check:agents`, `check:publish` and, on pull requests that touch dependency or toolchain
files, `check:dependency-automation`. The other six run only when someone runs `pnpm run check`.

`lint`, `check:wiring:strict` and `check:sources:strict` read nothing but the tree, so a change that
breaks them merges unnoticed. `check:dist` expects the prebuilt `dist/` of every port, which only a
machine that has built them all can satisfy. `check:deps:strict` and `check:native:strict` compare
the tree against the newest releases — npm for the first, the upstream projects for the second — so
they turn red on any day something publishes. `check:native` also needs `GITHUB_TOKEN` locally or it
rate-limits and reports most packages as `unknown`, which fails `--check`.

- Seen: 2026-09-23
- Check: `grep -rnE 'check:(deps|native|dist|wiring|sources)|run lint|eslint' .github/workflows/`
  returns nothing.
- Remove when each gate either runs in CI or leaves `pnpm run check`.

## npm's `latest` tag serves a placeholder and beta.50

Beta trains publish to `beta`, and only a stable train moves `latest`. An install without a tag thus
gets `crossbind@0.0.1`, the name-reservation placeholder, and 2.0.0-beta.50 of `create-crossbind`
and the `@crossbind/*` packages, while `beta` is on 2.0.0-beta.60. Most docs say `@beta`;
`docs/api/wasi.md`, `docs/api/rust.md` and `docs/api/lifecycle-and-types.md` do not. On 2026-09-16
`node scripts/check-port-links.mjs --tag latest`, which links GDAL, PROJ and GEOS from npm, failed
with `undefined symbol: _Unwind_CallPersonality`: beta.50 was compiled with an older toolchain image
than the one crossbind pins now.

- Seen: 2026-09-16
- Check: `npm view @crossbind/port-gdal-wasm dist-tags` shows `latest` behind `beta`.
- Remove when `latest` follows the trains or no install instruction depends on it.

## The React Native samples' `hermes-compiler` does not follow react-native's pin

All three React Native samples declare `hermes-compiler: "*"`, and on Android the declaration is
load-bearing. react-native no longer ships `sdks/hermesc`; its gradle plugin looks for the compiler
at `<app>/node_modules/hermes-compiler/hermesc/<os>-bin/hermesc` (`detectOSAwareHermesCommand`), and
pnpm links only direct dependencies there. Dropping the declaration would end that lookup in
`Couldn't determine Hermesc location` on every Android Release build. iOS takes hermesc from the
`hermes-engine` pod instead.

The `*` range resolves on its own, though. The two pnpm samples carry 250829098.0.10, while
react-native 0.87.1 depends on 250829098.0.17 and runs that Hermes version on Android.
react-native's own `react-native-xcode.sh` warns that a compiler and VM on different bytecode
versions crash at launch with `Wrong bytecode version`. Today's pair still passes the Android e2e,
but `*` lets Dependabot propose any Hermes release.

- Seen: 2026-09-23
- Check: `pnpm --filter @crossbind/example-mobile-reactnative-cli exec node -p "require('react-native/package.json').dependencies['hermes-compiler'] + ' vs ' + require('hermes-compiler/package.json').version"` prints two different versions.
- Remove when the samples pin the version react-native depends on.

## No CI job scaffolds the create-crossbind templates

`scripts/e2e-templates.js` (`pnpm run e2e:templates`) scaffolds every template from the published or
packed scaffolder, then installs, builds and runs each one's e2e. No workflow calls it. CI runs the
workspace samples instead, and workspace links hide what a standalone install resolves; the Babel 8
and ESLint 10 bumps of September 2026 passed both sample jobs. The harness itself runs only
`e2e:prod` for the web templates, and only one mobile platform — iOS when a simulator and an
emulator are both available.

- Seen: 2026-09-23
- Check: `grep -rn 'e2e-templates\|e2e:templates' .github/workflows/` returns nothing.
- Remove when a workflow runs the harness.

## Two templates are never built

Nothing depends on `@crossbind/example-lib-source` or `@crossbind/example-lib-cmake`, and neither
has a build script, so no sample, fixture or harness run builds them; the harness can only scaffold
and install them. `lib-source` is also the only package with `export.type: 'source'`.

- Seen: 2026-09-23
- Check: `grep -rl --include=package.json --exclude-dir=node_modules -e '"@crossbind/example-lib-source"' -e '"@crossbind/example-lib-cmake"' examples e2e plugins core ports landing`
  lists only the two packages' own manifests.
- Remove when an app or fixture builds against both.

## LERC 4.2.0 writes four uninitialised bytes into lossless float blobs

Upstream `EncodeHuffman` (`fpl_EsriHuffman.cpp`) leaves a trailing read-ahead `uint32` of its
`malloc`'d buffer unwritten, so every Huffman-coded plane of a lossless float blob carries 4 bytes of
heap memory. Two encodes of the same raster differ and the blob's checksum changes from run to run;
decoding is unaffected. A native build with `MallocScribble` shows the bytes as `0xAA`.

- Seen: 2026-09-24 (landing/demos/lib-lerc, which pins only sizes for lossless floats)
- Check: encode the same float32 raster losslessly twice with `lerc_encode` and compare the blobs.
- Remove when upstream initialises the word and the port picks the release up.

## WASI programs write at the wrong offset after seeking to the end

Built for `wasm32-wasip3` (or `-wasip2`) with wasi-sdk 34.0-rc.3 and run by wasmtime 47.0.2, a
`write()` after `lseek(fd, 0, SEEK_END)` lands at the descriptor's previous position, although `lseek`
returns the right offset. `wasm32-wasip1` and native builds are correct. libtiff seeks this way
before every page after the first, so multi-page TIFFs written through `TIFFOpen` come out corrupt,
including those from the published `tiffcp` in `@crossbind/port-tiff-standalone-wasi`, which still exits 0.

- Seen: 2026-09-24
- Check: compile a program that writes `AAAA`, seeks to 0, writes `B`, seeks to the end and writes
  `CC`, with `$WASI_SDK_PATH/bin/clang --target=wasm32-wasip3`, and run it with
  `wasmtime run --dir=.`: the file reads `BCCA` instead of `BAAACC`.
- Remove when the same program writes `BAAACC`.

## GDAL's thread pools hang or fail in single-threaded wasm

`GDALViewshedGenerate` hands its work to a fixed pool of four threads, which a single-threaded wasm
build cannot create, so the call never returns. ogr2ogr's Arrow path on GeoPackage input fails with
`Cannot start worker thread`, and the GeoPackage R-tree build logs thread errors before falling back.
landing/demos/lib-gdal runs pool jobs in place (`-Wl,--wrap` of `CPLJobQueue::SubmitJob` and
`CPLWorkerThreadPool::SubmitJob`) and sets `OGR2OGR_USE_ARROW_API=NO` and `OGR_GPKG_NUM_THREADS=1`.

- Seen: 2026-09-25
- Check: call `GDALViewshedGenerate` from a `-r st` browser build of `@crossbind/port-gdal-wasm`
  without those wraps; it does not return.
- Remove when the port's single-threaded build runs pool jobs inline.

## Function-pointer fields of C structs have no binding

Bridges bind data pointer fields as handles or instances but leave function pointers out, declared
directly or through a typedef. `WebPPicture.writer` stays unset, so the advanced WebP encoder, which
needs it pointed at `WebPMemoryWrite`, still takes C++. libjpeg's error manager keeps its default
`error_exit`, which ends the program on a corrupt file instead of throwing.

- Seen: 2026-09-26
- Check: after a web-vite build, `grep -c 'is_function_v<std::remove_pointer_t<U>>' e2e/web-vite/.crossbind/build/bridge/encode.i.cpp`
  prints 1: `crossbind::bindField` binds no function pointer.
- Remove when a function-pointer field takes a JavaScript function or a C function's handle.

## A C string that comes with a length is read up to a NUL byte

A callback argument `const char *s, int len` crosses as a string built with `toJsCString`, which
ignores `len` and reads to the next NUL. Expat's character-data handler gets text past the run it
reports, and for an entity such as `&amp;` bytes past Expat's one-character buffer: `"&N\u0002"` with
`len` 1. `landing/demos/lib-expat/direct` cuts every string back to `len` UTF-8 bytes.

- Seen: 2026-09-25
- Check: log `JSON.stringify(s)` and `len` in the character handler of a copy of
  `landing/demos/lib-expat/direct/examples/01-tree.js`; the string is longer than `len` bytes.
- Remove when such arguments arrive cut to their length, or as handles.

## Function-like macros, renaming macros and mutable globals have no binding

Constants bind when the app imports them (`docs/api/cpp-binding-rules.md`, rule 8), but a function-like
macro (`OPENSSL_free`, `BIO_get_mem_data`, `deflateInit2`) has no binding, a macro that renames a
function (`iconv_open` to `libiconv_open`) binds only the target name, and a global that is not const
(`_libiconv_version`) stays out. The JavaScript-only examples call the functions behind the macros.

- Seen: 2026-09-25
- Check: add `deflateInit2` to the export list in a copy of `landing/demos/lib-zlib/direct/src/headers.js`;
  `npx vite build` fails with `MISSING_EXPORT`.
- Remove when function-like macros, renaming macros and mutable globals bind.

## Variadic C functions have no binding

SWIG skips any function with `...` or a `va_list` (warning 505). That removes `TIFFSetField` and
`TIFFGetField`, `GTIFKeySet`, `curl_easy_setopt` and `curl_easy_getinfo`, and `EVP_PKEY_Q_keygen`,
so from JavaScript alone libtiff and libgeotiff cannot write a file or read most tags, and curl cannot
be given a URL. Only a C++ wrapper reaches them.

- Seen: 2026-09-25
- Check: add `curl_easy_setopt` to the `curl/easy.h` export list in a copy of
  `landing/demos/lib-curl/direct/src/headers.js`; `npx vite build` fails with `MISSING_EXPORT`.
- Remove when variadic functions get typed entry points.

## The site's demo builder rewrites a loader the next release no longer emits

`scripts/site/build-example-demos.mjs` builds the live demos from the published packages, whose boot code
imports a root-absolute `/crossbind.js`, so `patchBundles` rewrites that import and the runtime `path` to
each demo's subpath. The plugins in this tree load the runtime from Vite's `base` and webpack's public
path instead, and a relative `path` resolves against the page. Once a release carries them, the Vite and
Rspack demos have nothing to rewrite and `patchBundles` throws "no bundle needed the subpath patch".

- Seen: 2026-10-06
- Check: `grep -n "patchBundles(out, id)" scripts/site/build-example-demos.mjs` finds the rewrites.
- Remove when the demos build against a release with the base-aware plugins and the rewrites are gone,
  `verifyDemo` still loading each demo from its subpath.

## A debug build does not take an enum member for an integer

`core/crossbind/src/utils/embindArgumentGuards.js` rewrites embind's integer and enum conversions in the
release glue only. In the debug glue, which the dev servers load, embind's own integer conversion throws a
TypeError for any object, an enum member included, where a release build takes the member's number. On a
worker runtime the rejected write goes unnoticed: `config.image_hint = WebPImageHint.WEBP_HINT_PHOTO`
leaves the field at 0. Measured the same on the tree this branch started from.

- Seen: 2026-10-06
- Check: in `e2e/web-rspack`, `npx playwright test --config playwright.dev.config.cjs --project chromium`
  ends the conformance line with `NO pkgField:enumMember=0`.
- Remove when a debug build takes an enum member, a Number and a one-letter string as a release build does.

## The JavaScript-only demos work around fixes that are not released yet

`landing/demos/lib-*/direct` builds against the published `beta`, which predates what this tree fixed:
the sqlite3 and SpatiaLite ports' `ignoredDeclarations`, Expat's `headerPrelude`, NDEBUG for SWIG, the
struct field bindings (typedef'd structs, typedef'd numbers, `#if` in dependency headers, enum and pointer fields),
the worker's handling of objects a property returns, the integer and enum argument checks, `emccFlags`
after `-O3`, same-named headers and imported constants. Until a release carries them,
`lib-sqlite3/direct/crossbind.config.js` and `lib-spatialite/direct/crossbind.overrides.js` carry the
ignore lists, the examples write constants out as numbers, Expat's limits example prints three of its four lines, the GEOS and Expat examples pass
enum members, `.value` and `'|'.charCodeAt(0)`, and the reasons in zstd 02, zlib 04, WebP 02 and 03,
libjpeg-turbo, libgeotiff 04 and PROJ 05 describe the older field bindings. Built with this tree, zstd 02,
zlib 04 and libjpeg-turbo 01 and 05 ran from JavaScript alone with the C++ versions' output. GDAL 05
stays out on size: with GEOS and `-Oz` the JavaScript-only wasm is 26,505,868 bytes.

- Seen: 2026-09-25
- Check: `grep -c NOT_IN_THIS_BUILD landing/demos/lib-sqlite3/direct/crossbind.config.js` prints 2.
- Remove when the demos build against a release with these fixes and the workarounds and texts are updated.

## An Android app can ship without a dependency's shared library

The React Native plugin asks for CMake `3.25.0+` (`plugins/react-native/android/build.gradle`). On a
machine whose Android SDK had CMake 3.22.1, 3.31.1, 4.1.0 and 4.1.2, the Android Gradle plugin
built with 3.31.1, and the release APK of `examples/mobile-reactnative-cli` left out
`libcrossbind-example-lib-prebuilt-matrix.so`, which `libreact-native-crossbind.so` needs: the app
died at start with `dlopen failed: library "libcrossbind-example-lib-prebuilt-matrix.so" not found`.
With `cmake.dir` set to the 4.1.2 that CI installs, the same build packaged it. Only zlib and
openssl build static archives on Android (`libType: 'static'`); curl, webp, tiff and the ports that
keep the default ship shared libraries there, so they are exposed the same way (not tried). Why AGP
packages the library with one CMake and not the other was not traced.

- Seen: 2026-10-04 (macOS; ninja ran from `sdk/cmake/3.31.1`)
- Check: with no `android/local.properties` in `examples/mobile-reactnative-cli` and CMake 3.31.1
  installed, run `pnpm --filter @crossbind/example-lib-prebuilt-matrix run build:android`, then
  `pnpm exec react-native run-android --no-packager --mode Release --active-arch-only` in the
  example; `unzip -l android/app/build/outputs/apk/release/app-release.apk | grep -c prebuilt-matrix`
  prints 0.
- Remove when the APK carries the dependency's `.so` whichever CMake the plugin's range lets AGP
  pick.

## iOS accepts a string for a Rust byte-slice parameter

In the React Native conformance leg, `confRsBytesSum('abc')` returns on the iOS simulator instead
of throwing, so `rs:napi:bytesRejectString` fails there (`CONFORMANCE 303/304`). Android and the
Node addon leg throw "Cannot pass "abc" as a Uint8Array" from the same embind.js and Rust sources.
The iOS app carried Rust archives built that day and a bundle with the current runtime, and the
typed-argument ids sat at distinct addresses, so the difference lies elsewhere in the iOS build.
When it started is not known: the check arrived on 28 Sep, and no later iOS run is recorded.

- Seen: 2026-10-04 (iPhone 16 Pro simulator, iOS 27, Xcode 27, RN 0.87)
- Check: in `e2e/mobile-reactnative-cli`, run `pod install` in `ios/`, `pnpm run run:ios`, then
  `maestro --device <udid> hierarchy`; the report holds `NO rs:napi:bytesRejectString`.
- Remove when the iOS leg's report has no `NO` line.
