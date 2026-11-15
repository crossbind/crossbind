# libc++ (license only)

An Android app carries the NDK's libc++ as `libc++_shared.so` beside its host (`cpp/CMakeLists.txt`). The NDK keeps
libc++'s license only inside its `NOTICE.toolchain`, among the whole toolchain's; this folder keeps it, which
`crossbind licenses` quotes with the version of the NDK's clang the app's build reads from the image.

- Upstream: https://github.com/llvm/llvm-project/blob/main/libcxx/LICENSE.TXT
- License: Apache-2.0 WITH LLVM-exception, see `LICENSE.TXT`, llvm-project 19.1.7's `libcxx/LICENSE.TXT` as the linux
  image keeps it (`/opt/licenses/linux-sysroot/libcxx-LICENSE.TXT`),
  sha256 `539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b`: the same bytes as libc++'s notice in
  NDK 30.0.16248370's `NOTICE.toolchain`

An NDK update checks that its libc++ notice still matches.
