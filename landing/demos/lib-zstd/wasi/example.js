export const title = 'A zstd command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one streams files through zstd in 128 KB steps.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/zstd-tool-wasi-wasm32-st-release.wasm compress access.log access.log.zst 3',
    'wasmtime run --dir=. .crossbind/build/zstd-tool-wasi-wasm32-st-release.wasm decompress access.log.zst access.copy.log',
];
export const expected = [
    'zstd 1.5.7 compress: access.log -> access.log.zst, 378699 B written',
    'zstd 1.5.7 decompress: access.log.zst -> access.copy.log, 2537578 B written',
];

// The file the commands work on: the log the WebAssembly streaming example writes, so the two
// platforms can be compared byte for byte.
export function input() {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const lines = Array.from({ length: 50000 }, (_, i) => `2026-09-24T12:00:${String(i % 60).padStart(2, '0')}Z GET /api/items/${random(9000)} ${random(10) ? 200 : 404} ${random(900)}ms`);
    return { 'access.log': lines.join('\n') };
}
