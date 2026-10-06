# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

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
