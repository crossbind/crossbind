// Maps a crossbind build target to the cargo target triple. Rust is built on the host (the rust
// toolchain is host-installed), so the host must have the matching linker/SDK: Xcode for apple,
// a sourced emsdk for wasm, an NDK for android.
export function cargoTripleFor(target) {
    switch (target.platform) {
        case 'wasm':
            return 'wasm32-unknown-emscripten';
        case 'ios':
            return target.arch === 'iphonesimulator' ? 'aarch64-apple-ios-sim' : 'aarch64-apple-ios';
        case 'android':
            return target.arch === 'x86_64' ? 'x86_64-linux-android' : 'aarch64-linux-android';
        case 'darwin':
            return target.arch === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin';
        default:
            return null; // wasi (no rust wasip3 target yet) and anything else: unsupported
    }
}
