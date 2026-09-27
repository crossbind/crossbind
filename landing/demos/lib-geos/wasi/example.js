export const title = 'A GEOS command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one reads shapes from WKT files and prints what GEOS makes of them.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. .crossbind/build/geos-tool-wasi-wasm32-st-release.wasm intersection parcel.wkt flood.wkt',
    'wasmtime run --dir=. .crossbind/build/geos-tool-wasi-wasm32-st-release.wasm difference parcel.wkt flood.wkt',
    'wasmtime run --dir=. .crossbind/build/geos-tool-wasi-wasm32-st-release.wasm validate bowtie.wkt',
];
export const expected = [
    'intersection parcel.wkt flood.wkt: POLYGON ((5 5, 5 10, 10 10, 10 5, 5 5)), area 25',
    'difference parcel.wkt flood.wkt: POLYGON ((0 0, 0 10, 5 10, 5 5, 10 5, 10 0, 0 0)), area 75',
    'validate bowtie.wkt: Self-intersection[5 5]',
    'repaired: MULTIPOLYGON (((5 5, 10 10, 10 0, 5 5)), ((0 0, 0 10, 5 5, 0 0))), area 50',
];

// The shapes the commands read: the parcel and flood zone of the WebAssembly overlay example, and
// the bowtie of its validity example.
export function input() {
    return {
        'parcel.wkt': 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))\n',
        'flood.wkt': 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))\n',
        'bowtie.wkt': 'POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))\n',
    };
}
