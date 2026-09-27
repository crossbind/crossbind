export const title = 'A PROJ command-line tool';
export const summary =
    "WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one reads PROJ's database, proj.db, which the build copies to dist/data/proj; the PROJ_DATA variable tells PROJ where it is. It describes a CRS and turns GPS positions into Swiss LV95 grid coordinates, through EPSG's Helmert transformation, which EPSG gives an accuracy of 1 m.";
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. --env PROJ_DATA=dist/data/proj dist/proj-tool-wasi-wasm32-st-release.wasm info EPSG:2056',
    'wasmtime run --dir=. --env PROJ_DATA=dist/data/proj dist/proj-tool-wasi-wasm32-st-release.wasm EPSG:4326 EPSG:2056 points.txt',
];
export const expected = [
    'CH1903+ / LV95',
    'area: 5.95 45.81 10.5 47.81, Liechtenstein; Switzerland.',
    'axes: E east, N north',
    'Inverse of CH1903+ to WGS 84 (1) + Swiss Oblique Mercator 1995',
    'Zurich: 2683196.61 1248035.31',
    'Bern: 2600408.64 1199501.66',
    'Geneva: 2500986.15 1118138.65',
    'Matterhorn: 2617047.96 1091660.42',
];

// The points the second command reads: longitude, latitude and a label on each line.
export function input() {
    return {
        'points.txt': '8.5403 47.3779 Zurich\n7.4440 46.9466 Bern\n6.1557 46.2074 Geneva\n7.6586 45.9763 Matterhorn\n',
    };
}
