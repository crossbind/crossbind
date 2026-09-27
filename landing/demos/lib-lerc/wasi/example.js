export const title = 'A LERC command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one compresses a float32 height grid within an error bound, reads the header back, then decodes and measures the largest difference.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/lerc-tool-wasi-wasm32-st-release.wasm encode dem.f32 256 256 0.01 dem.lerc',
    'wasmtime run --dir=. .crossbind/build/lerc-tool-wasi-wasm32-st-release.wasm info dem.lerc',
    'wasmtime run --dir=. .crossbind/build/lerc-tool-wasi-wasm32-st-release.wasm decode dem.lerc dem.copy.f32 dem.f32',
];
export const expected = [
    'LERC 4.2.0 encode: dem.f32 -> dem.lerc, 262144 B -> 94775 B within 0.01',
    'dem.lerc: Lerc2 v6, 256x256, 1 band of float32, 65536 valid pixels, 1032.268 to 1500.945, max error 0.0098779',
    'dem.lerc -> dem.copy.f32, 262144 B, largest difference from dem.f32 0.0098877',
];

// The grid the commands work on: the heights of the first WebAssembly example, so the two platforms
// can be compared byte for byte.
export function input() {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const heights = new Float32Array(256 * 256);
    for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
            const dx = x - 128;
            const dy = y - 128;
            heights[y * 256 + x] = 1500 - (dx * dx + dy * dy) / 70 + random(1000) / 1000;
        }
    }
    return { 'dem.f32': new Uint8Array(heights.buffer) };
}
