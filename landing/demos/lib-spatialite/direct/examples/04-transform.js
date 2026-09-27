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
        'sqlite3_column_text',
        'sqlite3_finalize',
        'sqlite3_close',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
        'readCString',
    ],
};
export const note = '`ST_Transform` reads PROJ\'s `proj.db` from the data preloaded with the module, the same file the C++ build ships, with no configuration of its own. The WKT is bound with `SQLITE_TRANSIENT`, read from a slot holding -1, and every answer comes back from `sqlite3_column_text` through `readCString`.';
export const expected = [
    'WGS 84 / Pseudo-Mercator: POINT(3225860.732004 5013551.237223)',
    'WGS 84 / UTM zone 35N: POINT(666370.505017 4541552.487191)',
    'back to WGS 84: POINT(28.9784 41.0082)',
];

export default async function example({ spatialite_alloc_connection, spatialite_init_ex, spatialite_cleanup_ex, sqlite3_open, sqlite3_exec, sqlite3_errmsg, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_bind_int, sqlite3_step, sqlite3_column_text, sqlite3_finalize, sqlite3_close, allocPointer, readPointerAt, writeNumberAt, readCString }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is ((sqlite3_destructor_type)-1):
    // a pointer with the address -1, which a fresh pointer slot holding -1 reads back.
    const SQLITE_OK = 0;
    const SQLITE_ROW = 100;
    const minusOne = await allocPointer(1);
    await writeNumberAt(minusOne, 0, 'int32', -1);
    const SQLITE_TRANSIENT = await readPointerAt(minusOne, 0);
    const slot = await allocPointer(1);
    if ((await sqlite3_open(':memory:', slot)) !== SQLITE_OK) throw new Error('cannot open the database');
    const db = await readPointerAt(slot, 0);
    const cache = await spatialite_alloc_connection();
    await spatialite_init_ex(db, cache, 0);
    if ((await sqlite3_exec(db, 'SELECT InitSpatialMetaData(1)', null, null, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    const prepare = async (sql) => {
        if ((await sqlite3_prepare_v2(db, sql, -1, slot, null)) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return readPointerAt(slot, 0);
    };
    const text = async (statement, missing) => {
        const value = (await sqlite3_step(statement)) === SQLITE_ROW ? await sqlite3_column_text(statement, 0) : null;
        const result = value === null ? null : await readCString(value);
        await sqlite3_finalize(statement);
        if (result === null) throw new Error(missing);
        return result;
    };
    const transform = async (wkt, from, to) => {
        const statement = await prepare('SELECT AsText(ST_Transform(GeomFromText(?1, ?2), ?3))');
        await sqlite3_bind_text(statement, 1, wkt, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_int(statement, 2, from);
        await sqlite3_bind_int(statement, 3, to);
        return text(statement, 'cannot transform: check the WKT and both EPSG codes');
    };
    const srsName = async (srid) => {
        const statement = await prepare('SELECT ref_sys_name FROM spatial_ref_sys WHERE srid = ?1');
        await sqlite3_bind_int(statement, 1, srid);
        return text(statement, 'unknown EPSG code');
    };

    const istanbul = 'POINT(28.9784 41.0082)';
    for (const srid of [3857, 32635]) console.log(`${await srsName(srid)}: ${await transform(istanbul, 4326, srid)}`);
    const utm = await transform(istanbul, 4326, 32635);
    console.log(`back to ${await srsName(4326)}: ${await transform(utm, 32635, 4326)}`);
    await sqlite3_close(db);
    await spatialite_cleanup_ex(cache);
}
