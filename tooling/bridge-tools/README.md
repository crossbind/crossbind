# @crossbind/bridge-tools

What a Mac makes the bridges of macOS and iOS builds with in place of crossbind's web image, so those builds need no
Docker: the SWIG the image runs, compiled to WebAssembly and run in crossbind's own process, and the headers and
predefined macros of the image's em++, with which Xcode's clang reads a header as em++ does. crossbind installs it on
macOS as an optional dependency.

## API

- `swig(args, { cwd })` runs a new SWIG in this process and returns `{ status, output }`. SWIG runs in the absolute
  directory `cwd` and sees only `SWIG_LIB` of the environment; its output comes back in `output`, and the process keeps
  its own exit code. A crash throws, with the output so far in the error's `output`.
- `preprocessorArgs` are the flags with which `/usr/bin/clang` preprocesses C++ as the web image's em++ does, when its
  environment has no `CPATH` or `CPLUS_INCLUDE_PATH`: clang reads both despite `-nostdinc`.

## Build and checks

`node scripts/build.mjs` builds the package in the web image that `core/crossbind/src/assets/toolchain-digests.json`
pins. It compiles PCRE2, from the release `sources.json` pins, and SWIG, from the revision `tooling/docker/base.Dockerfile`
pins, to wasm64, after checking each download's sha256. It writes `dist/`, `LICENSE` and `sbom.cdx.json`.

`node scripts/reference.mjs` has the web image make the macro tables and bridges of `e2e/conformance`'s headers, and
`node scripts/parity.mjs` checks on a Mac that the package makes the same ones: the bridges, their files and SWIG's
messages byte for byte. The `test bridge-tools` workflow runs both for every change.

## Licenses

`LICENSE` holds each component's license text and `sbom.cdx.json` lists the components:

- `index.js`: MIT, as crossbind.
- SWIG: GPL-3.0-or-later. That license does not reach the bridges SWIG writes: the source of its embind module, from
  revision a93ac710c on, gives what the module writes, in every version, the SWIG library's terms. `LICENSE` quotes
  the exception.
- SWIG's library, `dist/swig/share`: SWIG's library terms, without restriction.
- PCRE2, linked into SWIG: BSD-3-Clause.
- emscripten's headers and runtime: MIT OR NCSA; musl's headers and C library: MIT; the headers and code of libc++,
  libc++abi and compiler-rt, and clang's headers: Apache-2.0 WITH LLVM-exception.
- The headers of other projects that emscripten carries, such as SDL, the Khronos GL headers, X11 and mimalloc:
  `LicenseRef-Emscripten-Third-Party-Headers`, each under the permissive notice in its file. `LICENSE` lists them.

The source of the WebAssembly SWIG is the archive of crossbind's SWIG fork at the revision `tooling/docker/base.Dockerfile`
pins, `https://github.com/crossbind/swig/archive/<revision>.zip`, built by the scripts in this folder of the crossbind
repository, at the tag of this package's version.
