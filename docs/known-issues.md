# Known issues

Defects and gaps that are real but not yet fixed, so a later session does not rediscover them.

Every entry carries the command that proves it is still real. Run the check before acting on an
entry, and delete the entry when the check comes back clean — an entry nobody can verify is worse
than no entry. Scope each check so it cannot match this file, which quotes what the checks look for.

Fixing something here is not a prerequisite for anything else; this is a list, not a queue.

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

## A remote web runner fails the React Native iOS bridge pass

With `RUNNER=REMOTE` and the web runner's address and token pointing at the Cloudflare web runner,
`pod install` in `e2e/mobile-reactnative-cli/ios` stops in the Metro bridge pass with "crossbind:
command failed (swig) with exit code 1" and no SWIG output. With `RUNNER=DOCKER_RUN`, so that SWIG
runs in the local Docker, the same `pod install` passes. Node.js addon builds bridged through the
same runner the same day, so the failure belongs to this path; its cause is not known.

- Seen: 2026-10-07
- Check: with `CROSSBIND_RUNNER=REMOTE` and a web runner in `CROSSBIND_REMOTE_URL_WEB` and
  `CROSSBIND_TOKEN_WEB`, run `pod install` in `e2e/mobile-reactnative-cli/ios`; it fails at swig.
- Rechecked: 2026-10-08. `pod install` passes through a temporary local HTTP web runner using the pinned web image, after building `@crossbind/conformance-rust` for iOS. The deployed Cloudflare runner still needs the same check; its address and credentials are not available in this checkout.
- Remove when that `pod install` passes through the deployed Cloudflare web runner.
