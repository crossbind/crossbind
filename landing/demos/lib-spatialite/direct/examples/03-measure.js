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
        'sqlite3_column_type',
        'sqlite3_column_double',
        'sqlite3_finalize',
        'sqlite3_close',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
    ],
};
export const note = 'Each method of `measure.h` becomes a JavaScript function over the same calls, and the WKT stays a plain string, bound with `SQLITE_TRANSIENT` read from a slot holding -1. `SQLITE_NULL` is a macro as well, so the check for a shape SpatiaLite cannot measure spells out its value, 5.';
export const expected = ['0.000200 square degrees, 1868349 m²', '350462 m in UTM zone 35N, 350082 m on the ellipsoid'];

export default async function example({ spatialite_alloc_connection, spatialite_init_ex, spatialite_cleanup_ex, sqlite3_open, sqlite3_exec, sqlite3_errmsg, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_bind_int, sqlite3_step, sqlite3_column_type, sqlite3_column_double, sqlite3_finalize, sqlite3_close, allocPointer, readPointerAt, writeNumberAt }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is ((sqlite3_destructor_type)-1):
    // a pointer with the address -1, which a fresh pointer slot holding -1 reads back.
    const SQLITE_OK = 0;
    const SQLITE_ROW = 100;
    const SQLITE_NULL = 5;
    const minusOne = await allocPointer(1);
    await writeNumberAt(minusOne, 0, 'int32', -1);
    const SQLITE_TRANSIENT = await readPointerAt(minusOne, 0);
    const slot = await allocPointer(1);
    if ((await sqlite3_open(':memory:', slot)) !== SQLITE_OK) throw new Error('cannot open the database');
    const db = await readPointerAt(slot, 0);
    const cache = await spatialite_alloc_connection();
    await spatialite_init_ex(db, cache, 0);
    if ((await sqlite3_exec(db, "SELECT InitSpatialMetaData(1, 'WGS84')", null, null, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    const prepare = async (sql) => {
        if ((await sqlite3_prepare_v2(db, sql, -1, slot, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return readPointerAt(slot, 0);
    };
    const number = async (statement) => {
        if ((await sqlite3_step(statement)) !== SQLITE_ROW) throw new Error(await sqlite3_errmsg(db));
        if ((await sqlite3_column_type(statement, 0)) === SQLITE_NULL) throw new Error('cannot measure: check the WKT and the SRID');
        const value = await sqlite3_column_double(statement, 0);
        await sqlite3_finalize(statement);
        return value;
    };
    const area = async (wkt, srid) => {
        const statement = await prepare('SELECT ST_Area(ST_Transform(GeomFromText(?1, 4326), ?2))');
        await sqlite3_bind_text(statement, 1, wkt, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_int(statement, 2, srid);
        return number(statement);
    };
    const distance = async (a, b, srid) => {
        const statement = await prepare('SELECT ST_Distance(ST_Transform(GeomFromText(?1, 4326), ?3), ST_Transform(GeomFromText(?2, 4326), ?3))');
        await sqlite3_bind_text(statement, 1, a, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_text(statement, 2, b, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_int(statement, 3, srid);
        return number(statement);
    };
    const geodesicDistance = async (a, b) => {
        const statement = await prepare('SELECT ST_Distance(GeomFromText(?1, 4326), GeomFromText(?2, 4326), 1)');
        await sqlite3_bind_text(statement, 1, a, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_text(statement, 2, b, -1, SQLITE_TRANSIENT);
        return number(statement);
    };

    const block = 'POLYGON((28.97 41.00, 28.99 41.00, 28.99 41.01, 28.97 41.01, 28.97 41.00))';
    console.log(`${(await area(block, 4326)).toFixed(6)} square degrees, ${Math.round(await area(block, 32635))} m²`);
    const istanbul = 'POINT(28.9784 41.0082)';
    const ankara = 'POINT(32.8597 39.9334)';
    const projected = await distance(istanbul, ankara, 32635);
    const geodesic = await geodesicDistance(istanbul, ankara);
    console.log(`${Math.round(projected)} m in UTM zone 35N, ${Math.round(geodesic)} m on the ellipsoid`);
    await sqlite3_close(db);
    await spatialite_cleanup_ex(cache);
}
