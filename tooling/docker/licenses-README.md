# Bundled toolchain licenses

One place to see the license texts of everything these images redistribute.
Files here are either copied from the toolchain trees inside the image, or
fetched (sha256-pinned) from the exact upstream revisions when the binary
release ships no texts of its own.

`web` and `android` are built on `base`, so both inherit every `base` row.

| Image   | Component                             | File(s) here                               | Origin                                                                                                                                                |
| ------- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| base    | Node.js                               | `node-LICENSE`                             | copied from the digest-pinned `node:24.20.0-trixie-slim` image                                                                                        |
| base    | Rust (rustc, cargo, std)              | `rust/`                                    | exact Rust 1.98.1 distribution installed by rustup from the digest-pinned bootstrap image (`COPYRIGHT.html` plus the `licenses/` texts it references) |
| base    | swig (crossbind fork)                 | `swig-LICENSE*`                            | built from crossbind/swig @ `1b6501ab`; only the binary ships, so the texts are copied out of the build stage                                         |
| base    | apt packages (cmake, sqlite3, ...)    | not duplicated                             | Debian convention: `/usr/share/doc/<package>/copyright`                                                                                               |
| web     | emsdk                                 | `emsdk-LICENSE`                            | copied from the digest-pinned `emscripten/emsdk:6.0.9` image                                                                                          |
| web     | emscripten                            | `emscripten-LICENSE`                       | copied from the digest-pinned `emscripten/emsdk:6.0.9` image                                                                                          |
| web     | Rust sysroots (`/opt/crossbind/rust`) | `rust/` (same texts as the base toolchain) | rebuilt from the same pinned Rust release                                                                                                             |
| web     | wasi-sdk                              | `wasi-sdk-LICENSE`                         | fetched: WebAssembly/wasi-sdk @ `wasi-sdk-34` (the binary tarball ships no texts)                                                                     |
| web     | LLVM (both toolchains' runtimes)      | `llvm-LICENSE.TXT`                         | fetched: llvm/llvm-project @ `895aa2c896ad` (wasi-sdk's clang revision; the same text governs the emsdk-side LLVM)                                    |
| web     | wasi-libc                             | `wasi-libc-LICENSE*`                       | fetched: WebAssembly/wasi-libc @ `2e6fb9d8ee0c` (wasi-sdk's pinned submodule)                                                                         |
| android | Android NDK                           | `ndk-NOTICE`, `ndk-NOTICE.toolchain`       | copied from the NDK root; the NDK is additionally governed by the Android SDK license terms accepted at image build time                              |
