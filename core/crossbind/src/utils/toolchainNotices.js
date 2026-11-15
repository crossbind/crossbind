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
