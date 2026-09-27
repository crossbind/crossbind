export const title = 'A GDAL command-line tool';
export const summary =
    "WASI has no JavaScript bindings: the program is a main() that links the library, built into one .wasm and run with wasmtime. This one is a small ogrinfo and ogr2ogr. The build copies GDAL's and PROJ's data files to dist/data, and the GDAL_DATA and PROJ_DATA variables tell GDAL and PROJ where they are; PROJ reads its coordinate systems from proj.db there.";
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. --env GDAL_DATA=dist/data/gdal --env PROJ_DATA=dist/data/proj dist/gdal-tool-wasi-wasm32-st-release.wasm info cities.geojson',
    'wasmtime run --dir=. --env GDAL_DATA=dist/data/gdal --env PROJ_DATA=dist/data/proj dist/gdal-tool-wasi-wasm32-st-release.wasm convert cities.geojson cities.gpkg GPKG EPSG:3857',
    'wasmtime run --dir=. --env GDAL_DATA=dist/data/gdal --env PROJ_DATA=dist/data/proj dist/gdal-tool-wasi-wasm32-st-release.wasm info cities.gpkg',
];
export const expected = [
    'cities: 3 Point, EPSG:4326, extent 27.1428 38.4237 32.8597 41.0082',
    'wrote cities.gpkg as GPKG',
    'cities: 3 Point, EPSG:3857, extent 3021523 4639455 3657925 5013551',
];

// The file the commands read: the three cities of the WebAssembly conversion example.
export function input() {
    const cities = [
        ['Istanbul', 28.9784, 41.0082],
        ['Ankara', 32.8597, 39.9334],
        ['Izmir', 27.1428, 38.4237],
    ];
    return {
        'cities.geojson': `${JSON.stringify({
            type: 'FeatureCollection',
            features: cities.map(([name, lon, lat]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
        })}\n`,
    };
}
