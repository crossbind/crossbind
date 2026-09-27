export const title = 'A GeoTIFF command-line tool';
export const summary = 'WASI has no JavaScript bindings: the program is a main() that links libgeotiff, libtiff and PROJ, built into one .wasm and run with wasmtime. It writes the first usage example\'s file, byte for byte, then says where it is. GTIFGetDefn looks EPSG codes up in PROJ\'s proj.db, which the build copies to dist/data; the last command mounts that folder and sets PROJ_DATA.';
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. dist/geotiff-tool-wasi-wasm32-st-release.wasm write utm33.tif 32633 500000 4650000 30',
    'wasmtime run --dir=. --dir=dist/data::/data --env PROJ_DATA=/data/proj dist/geotiff-tool-wasi-wasm32-st-release.wasm info utm33.tif',
];
export const expected = [
    'libgeotiff 1.7.4 write: utm33.tif, 100 x 100 pixels in EPSG:32633, 10262 B',
    'utm33.tif: 100 x 100 pixels, 1 band, 8 bits per sample',
    'EPSG:32633 WGS 84 / UTM zone 33N, datum World Geodetic System 1984',
    'upper left 500000.000 4650000.000 = lon 15.000000, lat 42.002015',
    'lower right 503000.000 4647000.000 = lon 15.036210, lat 41.974990',
];

// No input files: the program writes the GeoTIFF it then reads.
export function input() {
    return {};
}
