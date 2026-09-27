export const title = 'A spatial SQL command-line tool';
export const summary =
    "WASI has no JavaScript bindings: the program is a main() that links SpatiaLite with SQLite, GEOS and PROJ, built into one .wasm and run with wasmtime. It runs SQL against a database file in the current directory and prints geometries as WKT, and the file it writes opens in QGIS and GDAL. ST_Transform reads PROJ's proj.db, which the build copies to dist/data/proj: the second --dir flag mounts that folder and PROJ_DATA tells PROJ where it is.";
export const source = 'src/native/main.cpp';
export const commands = [
    'npx crossbind build -p wasi -b release',
    'wasmtime run --dir=. --dir=dist/data/proj::/data/proj --env PROJ_DATA=/data/proj dist/spatialite-tool-wasi-wasm32-st-release.wasm cities.db < cities.sql',
    'wasmtime run --dir=. --dir=dist/data/proj::/data/proj --env PROJ_DATA=/data/proj dist/spatialite-tool-wasi-wasm32-st-release.wasm cities.db "SELECT name, ST_Transform(geom, 32635) FROM cities ORDER BY name"',
    'wasmtime run --dir=. --dir=dist/data/proj::/data/proj --env PROJ_DATA=/data/proj dist/spatialite-tool-wasi-wasm32-st-release.wasm cities.db "SELECT name, CAST(Round(ST_Distance(geom, MakePoint(28.9784, 41.0082, 4326), 1) / 1000) AS INTEGER) AS km FROM cities ORDER BY km"',
];
export const expected = [
    '1',
    '1',
    'spatialite 5.1.0, cities.db: 4 statements, 293 rows changed',
    'Ankara|POINT(1000822.269819 4436835.643104)',
    'Istanbul|POINT(666370.505017 4541552.487191)',
    'Izmir|POINT(512464.98383 4252836.769027)',
    'spatialite 5.1.0, cities.db: 1 statement, 0 rows changed',
    'Istanbul|0',
    'Izmir|327',
    'Ankara|350',
    'spatialite 5.1.0, cities.db: 1 statement, 0 rows changed',
];

// The script the second command reads: the cities of the WebAssembly distances example, as a
// SpatiaLite table.
export function input() {
    return {
        'cities.sql': [
            "SELECT InitSpatialMetaData(1, 'WGS84');",
            'CREATE TABLE cities (name TEXT NOT NULL);',
            "SELECT AddGeometryColumn('cities', 'geom', 4326, 'POINT', 'XY');",
            "INSERT INTO cities (name, geom) VALUES ('Istanbul', MakePoint(28.9784, 41.0082, 4326)), ('Ankara', MakePoint(32.8597, 39.9334, 4326)), ('Izmir', MakePoint(27.1428, 38.4237, 4326));",
            '',
        ].join('\n'),
    };
}
