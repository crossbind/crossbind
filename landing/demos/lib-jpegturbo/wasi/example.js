export const title = 'A JPEG command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one encodes a PPM at a chosen quality and makes a thumbnail with DCT scaling, decoding the photo straight at 1/8 of its size.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/jpeg-tool-wasi-wasm32-st-release.wasm encode photo.ppm photo.jpg 85',
    'wasmtime run --dir=. .crossbind/build/jpeg-tool-wasi-wasm32-st-release.wasm thumbnail photo.jpg thumb.jpg 8 85',
];
export const expected = [
    'libjpeg-turbo 3.2.0 encode: photo.ppm (640x480) -> photo.jpg, 15356 B at quality 85',
    'libjpeg-turbo 3.2.0 thumbnail: photo.jpg (640x480) -> thumb.jpg (80x60), 1341 B at quality 85',
];

// The file the commands work on: a 640x480 gradient with a red disc, as binary PPM.
export function input() {
    const [width, height] = [640, 480];
    const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
    const ppm = new Uint8Array(header.length + width * height * 3);
    ppm.set(header);
    for (let i = 0; i < width * height; i += 1) {
        const [x, y] = [i % width, Math.floor(i / width)];
        const disc = (x - 320) ** 2 + (y - 240) ** 2 < 120 ** 2;
        ppm.set(disc ? [230, 30, 40] : [Math.floor((x * 255) / 639), Math.floor((y * 255) / 479), 160], header.length + i * 3);
    }
    return { 'photo.ppm': ppm };
}
