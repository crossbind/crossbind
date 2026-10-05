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

## Upstream source downloads have no retry

`downloadFile` makes a single `fetch`. Every port build therefore depends on one uncached request to
an upstream host, and a momentary network failure on a runner fails the whole job. It failed the
curl family on 2026-09-23 while the same tarball fetched fine locally and on the macOS runner.

- Seen: 2026-09-23
- Check: `grep -ci 'retry\|attempt\|backoff' core/crossbind/src/utils/downloadAndExtractFile.js`
  prints 0.
- Remove when the fetch retries with backoff.

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

## `check:deps` answers "is any usage current" rather than "is every usage current"

The status of a dependency comes from the highest version in use anywhere in the tree, so one
manifest on the current release marks the whole dependency up to date while another still resolves
an older copy. Observed on 2026-09-23 with `prettier`, which read up to date while the lockfile
carried both 3.9.6 and 3.9.8; that pair has since been collapsed, so reproducing it needs a tree
where two manifests disagree.

- Seen: 2026-09-23
- Check: `grep -n 'highestInUse' scripts/check-external-dependencies.js` — the status line compares
  one aggregated version against npm, not each usage.
- Remove when the gate reports per-usage.

## The release verifier gives up before npm finishes indexing

The publish step waits 44 attempts over 1200 seconds for each package to appear with provenance. On
2026-09-23 `@crossbind/port-geos-wasm@2.0.0-beta.60` was published but not yet exposed, so the train
failed on verification; a re-run of the same job passed and all 107 packages were already there.
Until this is fixed, recover the same way — `gh run rerun <id> --failed` at the same commit, as
"Recovery and idempotency" in `docs/playbooks/releasing-crossbind.md` describes.

- Seen: 2026-09-23
- Check: `grep -n 'REGISTRY_MAX_DURATION_MS =' scripts/release/npm-registry.mjs` still shows the
  twenty-minute window that beta.60 outlasted.
- Remove when a publish that succeeded stops failing its own verification.

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

## `plugins/react-native/cpp/CMakeLists.txt` is dead

Nothing references it — Android builds through `plugins/react-native/script/CMakeLists.txt` — and
two of the paths it compiles no longer exist (`plugins/react-native-embind`,
`plugins/react-native/ReactCommon`). Only the file is dead: `cpp/src/JSI_module.cpp` next to it is
compiled by `script/build_android.js`.

- Seen: 2026-09-23
- Check: `grep -rn 'cpp/CMakeLists\|\.\./cpp' plugins/react-native --exclude-dir=node_modules --exclude-dir=cpp` returns nothing.
- Remove when the file is deleted.

## Apps served from a subpath cannot find their loader

The boot code every bundler plugin injects (`getCrossbindScript`) imports a root-absolute
`/crossbind.js`, and the worker runtime's `resolveScriptUrl` turns a relative `path` into a root
one. An app served from `/app/` therefore asks the site root for its loader and wasm. The site's
live demos work only because `scripts/site/build-example-demos.mjs` rewrites both after the build.

- Seen: 2026-09-11
- Check: `grep -n "'/crossbind.js'" core/crossbind/src/integration/getCrossbindScript.js` finds the
  absolute import.
- Remove when the plugins honour the bundler's base (`base` in Vite, `output.publicPath` in Rspack)
  and the demo builder's rewrites can go.

## The docs describe two recipe hooks that nothing reads

`prepare(state)` and `build(state)` appear in the recipe shape, pipeline, hook table and a
`prepare` example of `docs/api/crossbind-build.md`, and in `docs/api/overrides.md`,
`docs/api/build-state.md`, `docs/playbooks/code-review.md` and `docs/ARCHITECTURE.md`. No code calls
either: a recipe that patches its source in `prepare` builds the unpatched source, and one that
replaces the build in `build` gets the default build. No port defines them.

- Seen: 2026-09-13
- Check: `grep -rnwE '(prepare|build)\(state\)' core/crossbind/src` returns nothing.
- Remove when both work or the docs stop describing them.

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

## An edited native header keeps the old build

`buildLib` skips a target's own library whenever `.crossbind/prebuilt/<target>/lib` exists. After an
edit to the body of a function in a `src/native` header, `crossbind build` logs `lib cached but
native sources are newer`, reports every step as cached, exits 0, and the app keeps running the old
code until `.crossbind` and `dist` are deleted. The site's demo builder is unaffected because it
builds each demo in a fresh temporary copy.

- Seen: 2026-09-23 (a wasm build of a `landing/demos` module)
- Check: `grep -n 'native sources are newer' core/crossbind/src/actions/buildLib.js` finds the
  warning in the branch that skips the rebuild.
- Remove when a newer native source rebuilds the library.

## `docs/api/wasi.md` runs the program from `dist/`

`crossbind build -p wasi` writes the command to
`.crossbind/build/<name>-wasi-wasm32-st-release.wasm` and its data to `.crossbind/build/data/`
(`buildWasiCommand.js`, `paths.build`), and copies them to `dist/` only when the app sets
`paths.output: 'dist'`. The quick start runs `dist/<name>-wasi-…wasm` and the table preopens
`dist/data/` without saying so, so both fail for an app with the default paths.

- Seen: 2026-09-23
- Check: `grep -n 'dist/<name>-wasi\|dist/data/' docs/api/wasi.md` matches.
- Remove when the doc names the real paths or the build copies to `dist/`.

## GEOS's npm licence says "or later"; its recipe says "only"

The `license` field of `@crossbind/port-geos` and its wasm, android, ios and wasi packages is
`LGPL-2.1-or-later`, while the same `package.json` declares the upstream licence as
`LGPL-2.1-only`, and `crossbind licenses` and the standalone-wasi package derive `LGPL-2.1-only`. GEOS
ships the LGPL 2.1 text as `COPYING` and names no version in its headers.

- Seen: 2026-09-24
- Check: `grep -n '"license"\|"declared"' ports/geos/base/package.json` shows the two values.
- Remove when both name the same licence.

## `m.FS.writeFile` appends to a file that already exists in the browser

Browser builds use WASMFS, whose `_wasmfs_write_file` (emsdk `system/lib/wasmfs/js_api.cpp`) writes
at the file's current size instead of truncating it. Writing a path twice therefore concatenates the
two contents, where Emscripten's classic FS and Node replace the file. The site's streaming examples
printed 5,075,156 B instead of 2,537,578 B on a second run until each run got its own directory.

- Seen: 2026-09-24 (landing/demos/lib-zstd `02-stream`, lib-zlib, lib-expat, run twice on one page)
- Check: in a browser build, `await m.FS.writeFile(p, 'hello world')` and then
  `await m.FS.writeFile(p, 'bye')`; `m.getFileBytes(p)` decodes to `hello worldbye`.
- Remove when the second write replaces the file.

## The header scanner reads braces and `//` inside string literals

`parseCppSurface` in `core/crossbind/src/utils/cppDts.js` strips `//` to the end of the line and
`bodyStatements` counts every `{` and `}`, both without skipping string and character literals. An
inline method that contains `"}"` or a URL shifts the brace depth, so later locals are read as public
fields. `createInterface.js` injects field bindings from that model, and the bridge fails to compile
(`no member named 'json' in 'XmlNames'`).

- Seen: 2026-09-24 (landing/demos/lib-expat)
- Check: `grep -n "if (ch === '{')" core/crossbind/src/utils/cppDts.js` — the loop keeps no
  string-literal state.
- Remove when literals and comments are told apart.

## Byte-string methods are missing from the generated types

`tsType` in `core/crossbind/src/utils/cppDts.js` maps `std::string` but not `std::u16string`, so a
method that takes or returns bytes the way the binding docs describe is left out of the `.d.ts`
(`crossbind: dts: skipped XmlFirehose::feed (unsupported parameter type)`). The binding itself works.

- Seen: 2026-09-24
- Check: `grep -c 'u16string' core/crossbind/src/utils/cppDts.js` prints 0.
- Remove when `std::u16string` maps to `string`.

## LERC 4.2.0 writes four uninitialised bytes into lossless float blobs

Upstream `EncodeHuffman` (`fpl_EsriHuffman.cpp`) leaves a trailing read-ahead `uint32` of its
`malloc`'d buffer unwritten, so every Huffman-coded plane of a lossless float blob carries 4 bytes of
heap memory. Two encodes of the same raster differ and the blob's checksum changes from run to run;
decoding is unaffected. A native build with `MallocScribble` shows the bytes as `0xAA`.

- Seen: 2026-09-24 (landing/demos/lib-lerc, which pins only sizes for lossless floats)
- Check: encode the same float32 raster losslessly twice with `lerc_encode` and compare the blobs.
- Remove when upstream initialises the word and the port picks the release up.

## The libjpeg-turbo port ships neither TurboJPEG nor lossless transforms

`ports/jpegturbo/base/build.mjs` configures every platform with `-DWITH_TURBOJPEG=OFF`, so there is
no `turbojpeg.h` (`tj3*`), and `transupp` is not built, so lossless rotate, flip and crop exist only
in the `jpegtran-wasi` command of the standalone-wasi package. Only the libjpeg API is available.

- Seen: 2026-09-24
- Check: `grep -c 'WITH_TURBOJPEG=OFF' ports/jpegturbo/base/build.mjs` prints 4.
- Remove when the library packages ship TurboJPEG, or the port README says it is left out on purpose.

## libiconv is built without its extra encodings

`ports/iconv/base/build.mjs` does not pass `--enable-extra-encodings`, so `iconv_open` fails for
CP437 and most other DOS code pages (CP737, CP775, CP852 and more), the EBCDIC code pages (IBM037,
IBM-1047, IBM500), SHIFT_JISX0213 and BIG5-2003, among others. 112 encodings under 349 names remain.

- Seen: 2026-09-24
- Check: `grep -c 'extra-encodings' ports/iconv/base/build.mjs` prints 0.
- Remove when the recipe enables them or the README states the choice.

## The WebP port ships mux and demux but never links them

`ports/webp/base/mergeConfig.mjs` sets `libName: ['webp', 'sharpyuv']`, so a consumer's link line
leaves out `libwebpmux` and `libwebpdemux` although every platform package ships their headers and
archives. Animated WebP (`WebPAnimEncoder`, `WebPAnimDecoder`) and ICC, EXIF and XMP chunks
(`WebPMux*`, `WebPDemux*`) fail at `wasm-ld` with 17 undefined symbols. Adding both names to
`libName` in a consumer override links and runs.

- Seen: 2026-09-24
- Check: `grep -n "libName" ports/webp/base/mergeConfig.mjs` lists only `webp` and `sharpyuv`.
- Remove when `libName` includes `webpmux` and `webpdemux`.

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

## Listing every platform of a data-carrying port breaks the web build

The README of each port tells apps to import its wasm, Android and iOS configs together. PROJ's
`mergeConfig` declares `data: { 'share/proj': 'proj' }` in a target spec with no platform filter, and
`getData` in `core/crossbind/src/actions/getData.js` applies it to every dependency without checking
that the directory exists, so a web build of such an app preloads
`port-proj-android/dist/prebuilt/wasm-wasm32-st-release/share/proj` and the file packager fails. The
same holds for every port that carries or inherits data: PROJ, libgeotiff, SpatiaLite and GDAL. A
config that lists only the wasm package builds.

- Seen: 2026-09-24 (a `create-crossbind` React Vite app with PROJ, on beta.50 and beta.60)
- Check: `grep -n -A3 'targetSpecs' ports/proj/base/mergeConfig.mjs` shows the data spec without a
  `platform`, and a web build with `projWasm, projAndroid, projIos` fails in the file packager.
- Remove when the data spec is filtered by platform or missing directories are skipped.

## `crossbind build -p wasi` deletes its own data before copying it

`paths.output` defaults to `paths.build` (`core/crossbind/src/state/loadConfig.js`), and
`createWasiCommands` in `core/crossbind/src/bin.js` removes `<output>/data` and then copies
`<build>/data` into it. With the default paths that deletes the source first, so a WASI build of any
app whose dependencies ship data (PROJ, OpenSSL's certificates through curl, GDAL) exits 1 with
`ENOENT … .crossbind/build/data`; a second run exits 0 without the data. Setting
`paths.output: 'dist'` avoids it.

- Seen: 2026-09-24 (landing/demos/lib-proj/wasi, lib-curl/wasi)
- Check: `grep -n 'paths.output}/data' core/crossbind/src/bin.js` shows the `rmSync` of the output
  directory before the `cpSync` from the build directory, with no check that the two differ.
- Remove when the copy is skipped for identical directories.

## Generated types make classes with an implicit constructor unconstructible

`emitCppDts` in `core/crossbind/src/utils/cppDts.js` writes `private constructor();` for any class
without a parsed constructor. A class that relies on the implicit default constructor, or declares
`X() = default;`, which the parser does not recognise either, is constructible from JavaScript but
rejected by TypeScript.

- Seen: 2026-09-24 (landing/demos/lib-proj)
- Check: `grep -n "private constructor" core/crossbind/src/utils/cppDts.js` shows the fallback.
- Remove when implicit and defaulted constructors produce a public one.

## SpatiaLite programs for WASI do not link

The WASI build of SQLite leaves extension loading out, but `libspatialite.a` (`stored_procedures.o`)
calls `sqlite3_enable_load_extension`, and `core/crossbind/src/assets/wasi-runtime/stubs.c` does not
provide it. Every WASI program that links `@crossbind/port-spatialite-wasi` fails in `wasm-ld` with
`undefined symbol: sqlite3_enable_load_extension` until it defines the function itself.

- Seen: 2026-09-25 (landing/demos/lib-spatialite/wasi, which defines it returning `SQLITE_ERROR`)
- Check: `grep -c sqlite3_enable_load_extension core/crossbind/src/assets/wasi-runtime/stubs.c`
  prints 0, and a `main` that calls `spatialite_init_ex` fails to link for `-p wasi`.
- Remove when the WASI SQLite or the stubs provide the symbol.

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

## A field written on a worker instance can arrive after the next call

On worker runtimes the worker exposes every embind object it hands out over its own `MessageChannel`,
while module functions go over the worker's own port. Messages on different ports keep no order, so
`luma.h_samp_factor = 1` followed by `jpeg_start_compress(cinfo, 1)` can run the call first: the
libjpeg-turbo encoder wrote a 3221-byte 4:4:4 file instead of 2791 bytes once in a run. Reading the
field back (`await luma.h_samp_factor`) before the call orders them.

- Seen: 2026-09-26
- Check: `grep -n "new MessageChannel" core/crossbind/src/assets/js-runtime/adapters/worker-comlink.js`
  shows the channel each returned object gets.
- Remove when a call waits for the field writes before it, or instances share the module's channel.

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

## A package that installs a header twice binds it twice

libpng installs its headers both in `include/` and in `include/libpng16/`. A header's dependency
bridges come from the headers under its include root that define the types it uses, and the copy
defines the same types, so binding `png.h` also binds `libpng16/png.h`: a second bridge with the same
292 names is compiled into the module. The registration guards keep the second set from clashing, so
it costs build time and module size, not behaviour.

- Seen: 2026-10-03
- Check: in `e2e/web-vite-conan`, after `pnpm run build`, `ls .crossbind/build/bridge/ | grep -c '^png.*\.i\.cpp$'`
  prints 2.
- Remove when a header's copy elsewhere under the same include root is not bound a second time.

## A worker handle breaks `JSON.stringify` and `String()`

On worker-backed runtimes, `JSON.stringify(handle)` returns `{}` and `String(handle)` throws "Cannot
convert object to primitive value"; each also logs an uncaught "Cannot read properties of undefined
(reading 'apply')". The cause is not verified; the proxy may answer `toJSON` and `Symbol.toPrimitive`
as remote calls.

- Seen: 2026-09-25
- Check: in a worker-backed page, `JSON.stringify(await m.allocBuffer(4))` logs the page error.
- Remove when handles stringify without a page error.

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

## Configure builds copy their sources without timestamps

`createLib` copies an autotools port's extracted source into its build directory with `fs.cpSync`,
which gives every file the time of the copy, in the order the filesystem lists them. make compares
those times, so a generated file can look older than its input. On GitHub's Ubuntu image 20260920,
libiconv's `po/` looked stale and `make install` tried to rebuild its message catalogs without
msgfmt, which failed every Linux build of iconv, SpatiaLite and GDAL; image 20260907 listed the files
in an order that happened to work. The iconv recipe now passes `--disable-nls` and no other port has
a `po/` directory, but any timestamp-driven rule in a configure build can fire the same way. Passing
`preserveTimestamps: true` is not a drop-in fix: `createLib` reuses the build directory when flags
change, so object files from the previous build would look newer than the copied sources and some
would not be recompiled.

- Seen: 2026-09-27
- Check: `grep -n 'cpSync(cmakeDir, buildPath' core/crossbind/src/actions/createLib.js` shows the copy
  without `preserveTimestamps`.
- Remove when configure builds keep the extracted tree's timestamps without reusing stale objects.

## Suspended `_JSPI` calls that resume out of order overwrite each other's C stack

JSPI suspends a call's wasm frames, but its C stack frames stay on the one linear-memory stack all
calls share, and neither crossbind nor Emscripten 6.0.9 gives a suspended call a stack of its own. A
call that starts while another is suspended puts its frames below the first one's. If the first call
resumes while the second is still suspended, the functions it calls next write over the second
call's frames. Three integer-only `_JSPI` calls that slept and resumed first in, first out had all
64 checked stack slots of the second and third call overwritten and left the stack pointer 512 bytes
low; resuming last in, first out they came back clean. A `_JSPI` call that returns without
suspending is nested inside the suspended one and safe. curl's fetch transport refuses a second
transfer while one waits for this reason, but any two `_JSPI` methods that suspend can meet it.

- Seen: 2026-09-30
- Check: in an app linked with `-sJSPI`, bind `int probe_JSPI(int seed, int ms)` that fills a
  `volatile int[64]` from `seed`, calls `emscripten_sleep(ms)`, then a function with a 2 KB local
  buffer, and returns how many of the 64 changed;
  `await Promise.all([1, 2, 3].map((seed) => probe_JSPI(seed, 200)))` gives `[0, 64, 64]`.
- Remove when each suspended call runs on a stack of its own, or crossbind queues `_JSPI` calls.

## `RUNNER: 'LOCAL'` still pulls the Docker images

`run()` pulls the target's image before it picks a runner, and the pull does not read `RUNNER`. A
build under `"RUNNER": "LOCAL"` in `~/.crossbind.json` therefore still runs `docker image inspect`
and `docker pull` before every wasm, android, linux, linuxmusl and win32 step, and before every
`swig` and `em++` call, darwin and ios builds included. Without Docker the build fails on the
missing `docker` binary; with Docker it downloads images it never runs. `runCargo` already keeps
everything on the host under `LOCAL`.

Fixing the pull alone does not make a build Docker-free. `swig -embind` exists only in the crossbind
fork the images carry, the port archives are built with the image's emsdk 6.0.9, and the linux,
win32 and android toolchains `run.js` points at (`/opt/crossbind/linux`, `/opt/llvm-mingw`,
`/opt/android-sdk/ndk/current`) exist only inside the images.

- Seen: 2026-10-03 (read from `run.js`; no build was run without Docker)
- Check: `grep -n -B3 'pullDockerImage(imageRoleFor(target)' core/crossbind/src/actions/run.js`
  shows the pull guarded by the platform and the program, not by `RUNNER`.
- Remove when a build under `RUNNER: 'LOCAL'` makes no docker call.

## A misspelled `RUNNER` runs cargo on the host

`cargoRunner` in `runCargo.js` takes any value other than `DOCKER_RUN` and `DOCKER_EXEC` for
`LOCAL`. A `docker_run`, a trailing space or `podman` in `~/.crossbind.json` builds crates and runs
their build scripts on the host with the user's permissions instead of in the image, and nothing
says so. `run()` throws for the same value, and so does `conanRunner`.

- Seen: 2026-10-03 (the security review of `conan:` imports; read from `runCargo.js`)
- Check: `grep -n "'DOCKER_EXEC' ? runner : 'LOCAL'" core/crossbind/src/utils/runCargo.js` matches.
- Remove when `cargoRunner` throws for a value that is not a runner.

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
