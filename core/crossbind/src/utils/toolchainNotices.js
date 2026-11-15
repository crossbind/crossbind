// Where a build keeps the notices of the runtime a toolchain image linked into its binaries,
// relative to the build directory; crossbind licenses reads them from there.
export default function toolchainNoticesDir(platform) {
    return `toolchain-licenses/${platform}`;
}

// What a wasm build copies there (actions/wasmNotices.js).
export const WASM_NOTICES = {
    emscriptenText: 'emscripten-LICENSE',
    llvmText: 'llvm-LICENSE.TXT',
    emscriptenVersion: 'emscripten-version.txt',
    llvmVersion: 'clang-version.txt',
    image: 'image.txt',
};

// What a Linux, Windows or Android link copies there (actions/nativeNotices.js), beside a Windows image's mingw-w64
// notices, which keep their names.
export const NATIVE_NOTICES = {
    llvmText: 'llvm-LICENSE.TXT',
    clangVersion: 'clang-version.txt',
    libcxxVersion: 'libcxx-version.txt',
    mingwVersion: 'mingw-w64-version.txt',
};

export const MINGW_NOTICE = /^COPYING/;
