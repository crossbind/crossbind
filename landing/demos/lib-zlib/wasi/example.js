export const title = 'A gzip command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one uses gzopen, gzwrite and gzread, the .gz file functions zlib ships, and streams in 64 KB steps.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/zlib-tool-wasi-wasm32-st-release.wasm gzip access.log access.log.gz 6',
    'wasmtime run --dir=. .crossbind/build/zlib-tool-wasi-wasm32-st-release.wasm gunzip access.log.gz access.copy.log',
];
export const expected = [
    'zlib 1.3.2 gzip: access.log -> access.log.gz, 363636 B written',
    'zlib 1.3.2 gunzip: access.log.gz -> access.copy.log, 2537578 B written',
];

// The file the commands work on: the log the WebAssembly streaming example writes, so the two
// platforms can be compared byte for byte.
export function input() {
    let seed = 42;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const lines = Array.from({ length: 50000 }, (_, i) => `2026-09-24T12:00:${String(i % 60).padStart(2, '0')}Z GET /api/items/${random(9000)} ${random(10) ? 200 : 404} ${random(900)}ms`);
    return { 'access.log': lines.join('\n') };
}
