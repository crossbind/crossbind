// Every archive linked into one wasm module must agree on exception handling, SIMD, threads and
// 64-bit memory, or wasm-ld refuses it. Port recipes, the app's own libraries and Conan packages all
// take their flags from here.
export const WASM_EXCEPTION_FLAGS = ['-fwasm-exceptions'];

export function targetArchiveFlags(target) {
    return [
        ...(target.runtime === 'mt' ? ['-pthread'] : []),
        ...(target.platform === 'wasm' ? ['-msimd128'] : []),
        ...(target.platform === 'wasm' && target.arch === 'wasm64' ? ['-sMEMORY64=1'] : []),
    ];
}
