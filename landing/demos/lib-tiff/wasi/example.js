export const title = 'A TIFF archiving tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links libtiff, built into one .wasm and run with wasmtime. This one rewrites every page of a TIFF losslessly, black-and-white pages as CCITT Group 4 and the others as Deflate with a predictor, the job a scan archive runs on each upload. The WASI build of libtiff has the codecs that need no library or only zlib: no JPEG, ZSTD or LERC.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/tiff-tool-wasi-wasm32-st-release.wasm sample scan.tif',
    'wasmtime run --dir=. .crossbind/build/tiff-tool-wasi-wasm32-st-release.wasm archive scan.tif archive.tif',
    'wasmtime run --dir=. .crossbind/build/tiff-tool-wasi-wasm32-st-release.wasm info archive.tif',
];
export const expected = [
    'wrote scan.tif: 3 pages, 2194119 B',
    'libtiff 4.7.2: scan.tif 2194119 B -> archive.tif 57777 B',
    'page 1 "letter": 1240x1754, 1 x 1-bit, CCITT Group 4, 2971 B',
    'page 2 "grey": 800x600, 1 x 8-bit, AdobeDeflate, 36879 B',
    'page 3 "colour": 800x600, 3 x 8-bit, AdobeDeflate, 15296 B',
];
