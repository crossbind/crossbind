# Bundled toolchain licenses

One place to see the license texts of everything these images redistribute.
Files here are either copied from the toolchain trees inside the image, or
fetched (sha256-pinned) from the exact upstream revisions when the binary
release ships no texts of its own.

`web` and `android` are built on `base`, so both inherit every `base` row.

| Image   | Component                             | File(s) here                               | Origin                                                                                                                                                |
| ------- | ------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| base    | Node.js                               | `node-LICENSE`                             | copied from the digest-pinned `node:24.21.0-trixie-slim` image                                                                                        |
| base    | Rust (rustc, cargo, std)              | `rust/`                                    | exact Rust 1.98.1 distribution installed by rustup from the digest-pinned bootstrap image (`COPYRIGHT.html` plus the `licenses/` texts it references) |
| base    | swig (crossbind fork)                 | `swig-LICENSE*`                            | built from crossbind/swig @ `9aa62a1e`; only the binary ships, so the texts are copied out of the build stage                                         |
| base    | apt packages (cmake, sqlite3, ...)    | not duplicated                             | Debian convention: `/usr/share/doc/<package>/copyright`                                                                                               |
| web     | emsdk                                 | `emsdk-LICENSE`                            | copied from the digest-pinned `emscripten/emsdk:6.0.9` image                                                                                          |
| web     | emscripten                            | `emscripten-LICENSE`                       | copied from the digest-pinned `emscripten/emsdk:6.0.9` image                                                                                          |
| web     | Rust sysroots (`/opt/crossbind/rust`) | `rust/` (same texts as the base toolchain) | rebuilt from the same pinned Rust release                                                                                                             |
| web     | wasi-sdk                              | `wasi-sdk-LICENSE`                         | fetched: WebAssembly/wasi-sdk @ `wasi-sdk-34` (the binary tarball ships no texts)                                                                     |
| web     | LLVM (both toolchains' runtimes)      | `llvm-LICENSE.TXT`                         | fetched: llvm/llvm-project @ `895aa2c896ad` (wasi-sdk's clang revision; the same text governs the emsdk-side LLVM)                                    |
| web     | wasi-libc                             | `wasi-libc-LICENSE*`                       | fetched: WebAssembly/wasi-libc @ `2e6fb9d8ee0c` (wasi-sdk's pinned submodule)                                                                         |
| android | Android NDK                           | `ndk-NOTICE`, `ndk-NOTICE.toolchain`       | copied from the NDK root; the NDK is additionally governed by the Android SDK license terms accepted at image build time                              |
| linux   | glibc 2.28 sysroots (Debian 10)       | `linux-sysroot/<triple>/*-copyright`       | copied from the sha256-pinned Debian 10 packages the sysroots are extracted from (`linux-sysroot.txt`)                                                |
| linux   | libc++ and libc++abi                  | `linux-sysroot/libcxx-LICENSE.TXT`         | built from the sha256-pinned llvm-project 19.1.7 source release                                                                                       |
| linux   | musl 1.2.5 sysroots (Alpine 3.23)     | `linux-sysroot/musl/`                      | fetched (sha256-pinned), as the Alpine packages of `linuxmusl-sysroot.txt` ship no texts: musl v1.2.5, the GCC 15.2.0 runtime and Linux v6.16 headers  |
| windows | llvm-mingw (LLVM, mingw-w64)          | `llvm-mingw/`                              | copied from the sha256-pinned llvm-mingw 20260922 release: LLVM `LICENSE.TXT` and the mingw-w64 `COPYING*` texts                                      |
| linux   | glibc 2.28 sysroots (Debian 10)       | `linux-sysroot/<triple>/*-copyright`       | copied from the sha256-pinned Debian 10 packages the sysroots are extracted from (`linux-sysroot.txt`)                                                |
| linux   | libc++ and libc++abi                  | `linux-sysroot/libcxx-LICENSE.TXT`         | built from the sha256-pinned llvm-project 19.1.7 source release                                                                                       |
| windows | llvm-mingw (LLVM, mingw-w64)          | `llvm-mingw/`                              | copied from the sha256-pinned llvm-mingw 20260922 release: LLVM `LICENSE.TXT` and the mingw-w64 `COPYING*` texts                                      |
