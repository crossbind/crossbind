export const imports = {
    '@crossbind/port-spatialite/spatialite.h': ['spatialite_alloc_connection', 'spatialite_init_ex', 'spatialite_cleanup_ex'],
    '@crossbind/port-sqlite3/sqlite3.h': [
        'sqlite3_open',
        'sqlite3_exec',
        'sqlite3_errmsg',
        'sqlite3_prepare_v2',
        'sqlite3_bind_text',
        'sqlite3_bind_int',
        'sqlite3_step',
        'sqlite3_changes',
        'sqlite3_column_text',
        'sqlite3_finalize',
        'sqlite3_close',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
        'readCString',
    ],
};
export const note = 'The same statements as `geojson_layer.h`, with `sqlite3_changes` telling a geometry `GeomFromGeoJSON` rejected from a stored one. The name and the GeoJSON are bound with `SQLITE_TRANSIENT`, read from a slot holding -1, and the FeatureCollection comes back from `sqlite3_column_text` through `readCString`.';
export const expected = [
    '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Galata Tower"},"geometry":{"type":"Point","coordinates":[28.97413,41.02564]}},{"type":"Feature","properties":{"name":"Galata Bridge"},"geometry":{"type":"LineString","coordinates":[[28.97336,41.01963],[28.97139,41.02402]]}}]}',
];

export default async function example({ spatialite_alloc_connection, spatialite_init_ex, spatialite_cleanup_ex, sqlite3_open, sqlite3_exec, sqlite3_errmsg, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_bind_int, sqlite3_step, sqlite3_changes, sqlite3_column_text, sqlite3_finalize, sqlite3_close, allocPointer, readPointerAt, writeNumberAt, readCString }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is ((sqlite3_destructor_type)-1):
    // a pointer with the address -1, which a fresh pointer slot holding -1 reads back.
    const SQLITE_OK = 0;
    const SQLITE_ROW = 100;
    const SQLITE_DONE = 101;
    const minusOne = await allocPointer(1);
    await writeNumberAt(minusOne, 0, 'int32', -1);
    const SQLITE_TRANSIENT = await readPointerAt(minusOne, 0);
    const slot = await allocPointer(1);
    if ((await sqlite3_open(':memory:', slot)) !== SQLITE_OK) throw new Error('cannot open the database');
    const db = await readPointerAt(slot, 0);
    const cache = await spatialite_alloc_connection();
    await spatialite_init_ex(db, cache, 0);
    const setup = `
        SELECT InitSpatialMetaData(1, 'WGS84');
        CREATE TABLE features (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        SELECT AddGeometryColumn('features', 'geom', 4326, 'GEOMETRY', 'XY');
    `;
    if ((await sqlite3_exec(db, setup, null, null, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    const prepare = async (sql) => {
        if ((await sqlite3_prepare_v2(db, sql, -1, slot, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return readPointerAt(slot, 0);
    };
    const add = async (name, geometry) => {
        const insert = await prepare(`
            INSERT INTO features (name, geom) SELECT ?1, shape FROM
            (SELECT SetSRID(GeomFromGeoJSON(?2), 4326) AS shape) WHERE shape IS NOT NULL
        `);
        await sqlite3_bind_text(insert, 1, name, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_text(insert, 2, geometry, -1, SQLITE_TRANSIENT);
        const error = (await sqlite3_step(insert)) === SQLITE_DONE ? null : await sqlite3_errmsg(db);
        await sqlite3_finalize(insert);
        if (error) throw new Error(error);
        if ((await sqlite3_changes(db)) === 0) throw new Error(`not a GeoJSON geometry: ${name}`);
    };

    await add('Galata Tower', '{"type":"Point","coordinates":[28.974128,41.025638]}');
    await add('Galata Bridge', '{"type":"LineString","coordinates":[[28.973364,41.019634],[28.971392,41.024021]]}');
    const collection = await prepare(`
        SELECT json_object('type', 'FeatureCollection', 'features', json_group_array(json_object(
        'type', 'Feature', 'properties', json_object('name', name), 'geometry', json(AsGeoJSON(geom, ?1)))))
        FROM (SELECT name, geom FROM features ORDER BY id)
    `);
    await sqlite3_bind_int(collection, 1, 5);
    if ((await sqlite3_step(collection)) !== SQLITE_ROW) throw new Error(await sqlite3_errmsg(db));
    console.log(await readCString(await sqlite3_column_text(collection, 0)));
    await sqlite3_finalize(collection);
    await sqlite3_close(db);
    await spatialite_cleanup_ex(cache);
}
