// Maps a crossbind build target to the cargo target triple. Apple targets build on the host with
// Xcode; every other platform builds in the toolchain image that links it, which carries the
// target's std.
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
        case 'linux':
            return target.arch === 'x64' ? 'x86_64-unknown-linux-gnu' : 'aarch64-unknown-linux-gnu';
        case 'linuxmusl':
            return target.arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl';
        case 'win32':
            return target.arch === 'x64' ? 'x86_64-pc-windows-gnullvm' : 'aarch64-pc-windows-gnullvm';
        default:
            return null; // wasi (no rust wasip3 target yet) and anything else: unsupported
    }
}

// What `rustc --print native-static-libs` asks a Linux or Windows link to add for a Rust staticlib.
// The other platforms' toolchains link these by themselves.
const RUST_STD_LIBS = {
    linux: ['-lgcc_s', '-lutil', '-lrt', '-lpthread', '-lm', '-ldl'],
    linuxmusl: ['-lgcc_s'],
    win32: ['-lkernel32', '-lntdll', '-luserenv', '-lws2_32', '-ldbghelp', '-lunwind'],
};

export function rustStdLibsFor(target) {
    return RUST_STD_LIBS[target.platform] ?? [];
}
