export const imports = {
    '@crossbind/port-spatialite/spatialite.h': ['spatialite_alloc_connection', 'spatialite_init_ex', 'spatialite_cleanup_ex'],
    '@crossbind/port-sqlite3/sqlite3.h': [
        'sqlite3_open',
        'sqlite3_exec',
        'sqlite3_errmsg',
        'sqlite3_prepare_v2',
        'sqlite3_bind_text',
        'sqlite3_bind_double',
        'sqlite3_bind_int',
        'sqlite3_step',
        'sqlite3_reset',
        'sqlite3_column_text',
        'sqlite3_finalize',
        'sqlite3_close',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
        'readCString',
    ],
};
export const note = 'Numbers bind as they are; text needs `SQLITE_TRANSIENT`, `((sqlite3_destructor_type)-1)`, a macro. The Number -1 fails with `Cannot pass "-1" as a NativePointer`, so the pointer is read back from a slot holding -1, and SQLite copies each name as it does for the C++. `null` (`SQLITE_STATIC`) is no stand-in: the binding frees its copy of a JavaScript string when the call returns, and three strings bound that way read back as two empty strings and garbage.';
export const expected = ['Bursa, Edirne, Istanbul, Izmir', 'Bursa 133 km, Istanbul 189 km, Ankara 201 km'];

export default async function example({ spatialite_alloc_connection, spatialite_init_ex, spatialite_cleanup_ex, sqlite3_open, sqlite3_exec, sqlite3_errmsg, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_bind_double, sqlite3_bind_int, sqlite3_step, sqlite3_reset, sqlite3_column_text, sqlite3_finalize, sqlite3_close, allocPointer, readPointerAt, writeNumberAt, readCString }, console) {
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
        CREATE TABLE places (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        SELECT AddGeometryColumn('places', 'geom', 4326, 'POINT', 'XY');
        SELECT CreateSpatialIndex('places', 'geom');
    `;
    if ((await sqlite3_exec(db, setup, null, null, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    const prepare = async (sql) => {
        if ((await sqlite3_prepare_v2(db, sql, -1, slot, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return readPointerAt(slot, 0);
    };
    const lines = async (statement) => {
        const values = [];
        while ((await sqlite3_step(statement)) === SQLITE_ROW) values.push(await readCString(await sqlite3_column_text(statement, 0)));
        await sqlite3_finalize(statement);
        return values.join(', ');
    };

    const cities = [
        ['Istanbul', 28.9784, 41.0082],
        ['Ankara', 32.8597, 39.9334],
        ['Izmir', 27.1428, 38.4237],
        ['Bursa', 29.061, 40.1885],
        ['Antalya', 30.7133, 36.8969],
        ['Trabzon', 39.7168, 41.0027],
        ['Konya', 32.4846, 37.8746],
        ['Edirne', 26.5557, 41.6771],
    ];
    const insert = await prepare('INSERT INTO places (name, geom) VALUES (?1, MakePoint(?2, ?3, 4326))');
    for (const [name, lon, lat] of cities) {
        await sqlite3_bind_text(insert, 1, name, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_double(insert, 2, lon);
        await sqlite3_bind_double(insert, 3, lat);
        if ((await sqlite3_step(insert)) !== SQLITE_DONE) throw new Error(await sqlite3_errmsg(db));
        await sqlite3_reset(insert);
    }
    await sqlite3_finalize(insert);

    const inView = await prepare(`
        SELECT name FROM places WHERE ROWID IN (SELECT ROWID FROM SpatialIndex
        WHERE f_table_name = 'places' AND search_frame = BuildMbr(?1, ?2, ?3, ?4, 4326)) ORDER BY name
    `);
    await sqlite3_bind_double(inView, 1, 26);
    await sqlite3_bind_double(inView, 2, 38);
    await sqlite3_bind_double(inView, 3, 31);
    await sqlite3_bind_double(inView, 4, 42);
    console.log(await lines(inView));

    const nearest = await prepare(`
        SELECT p.name || ' ' || CAST(Round(k.distance_m / 1000) AS INTEGER) || ' km' FROM KNN2 AS k
        JOIN places AS p ON p.id = k.fid WHERE k.f_table_name = 'places'
        AND k.ref_geometry = MakePoint(?1, ?2, 4326) AND k.radius = ?3 AND k.max_items = ?4 ORDER BY k.pos
    `);
    const eskisehir = [30.5206, 39.7767];
    await sqlite3_bind_double(nearest, 1, eskisehir[0]);
    await sqlite3_bind_double(nearest, 2, eskisehir[1]);
    await sqlite3_bind_double(nearest, 3, 5);
    await sqlite3_bind_int(nearest, 4, 3);
    console.log(await lines(nearest));
    await sqlite3_close(db);
    await spatialite_cleanup_ex(cache);
}
