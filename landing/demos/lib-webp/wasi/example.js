export const title = 'A WebP command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links libwebp, built into one .wasm and run with wasmtime. This one encodes a PPM to WebP at a quality and reads a WebP header back.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/webp-tool-wasi-wasm32-st-release.wasm encode landscape.ppm landscape.webp 80',
    'wasmtime run --dir=. .crossbind/build/webp-tool-wasi-wasm32-st-release.wasm info landscape.webp',
];
export const expected = [
    'webp 1.6.0 encode: landscape.ppm 256x256 -> landscape.webp, 1966 B at quality 80',
    'webp 1.6.0 info: landscape.webp 256x256 lossy, 1966 B, alpha: no, animated: no',
];

// The file the commands work on: the landscape the WebAssembly examples encode, as a binary PPM, so
// the two platforms can be compared byte for byte.
export function input() {
    let seed = 1;
    const random = (n) => (seed = (seed * 48271) % 2147483647) % n;
    const header = new TextEncoder().encode('P6\n256 256\n255\n');
    const pixels = new Uint8Array(256 * 256 * 3);
    for (let y = 0; y < 256; y += 1) {
        for (let x = 0; x < 256; x += 1) {
            const sun = (x - 180) ** 2 + (y - 70) ** 2 < 900;
            const hill = y > 170 + (((x - 128) ** 2) >> 8);
            const [r, g, b] = sun ? [255, 214, 90] : hill ? [40 + (y >> 2), 120 + (x >> 3), 50] : [90 + (y >> 1), 150 + (y >> 2), 235];
            pixels.set([r ^ random(8), g ^ random(8), b ^ random(8)], (y * 256 + x) * 3);
        }
    }
    const file = new Uint8Array(header.length + pixels.length);
    file.set(header);
    file.set(pixels, header.length);
    return { 'landscape.ppm': file };
}
