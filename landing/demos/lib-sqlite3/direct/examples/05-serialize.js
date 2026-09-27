export const imports = {
    '@crossbind/port-sqlite3/sqlite3.h': [
        'sqlite3_open',
        'sqlite3_close',
        'sqlite3_exec',
        'sqlite3_serialize',
        'sqlite3_deserialize',
        'sqlite3_malloc64',
        'sqlite3_free',
        'sqlite3_prepare_v2',
        'sqlite3_bind_text',
        'sqlite3_step',
        'sqlite3_column_text',
        'sqlite3_column_int64',
        'sqlite3_finalize',
        'sqlite3_errmsg',
        'allocBuffer',
        'allocPointer',
        'readPointerAt',
        'readNumberAt',
        'writeNumberAt',
        'readBytes',
        'writeBytes',
        'readCString',
    ],
};
export const note = 'The memory handling the C++ wrapper hid is written out: `sqlite3_serialize` returns a handle to memory that JavaScript copies with `readBytes` and frees with `sqlite3_free`, and writes the size through a `sqlite3_int64 *`, here an 8-byte `allocBuffer` read as `int64`. `sqlite3_deserialize` takes its bytes in memory from `sqlite3_malloc64`, which SQLite frees with the connection; the `SQLITE_DESERIALIZE_*` flags are macros, so their values are written out.';
export const expected = ['8192 B, starts with "SQLite format 3"', 'readings(sensor TEXT, celsius REAL): 3 rows'];

export default async function example({ sqlite3_open, sqlite3_close, sqlite3_exec, sqlite3_serialize, sqlite3_deserialize, sqlite3_malloc64, sqlite3_free, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_step, sqlite3_column_text, sqlite3_column_int64, sqlite3_finalize, sqlite3_errmsg, allocBuffer, allocPointer, readPointerAt, readNumberAt, writeNumberAt, readBytes, writeBytes, readCString }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is
    // ((sqlite3_destructor_type)-1): a pointer with the address -1, which a slot holding -1 reads back.
    const SQLITE_OK = 0, SQLITE_ROW = 100;
    const SQLITE_DESERIALIZE_FREEONCLOSE = 1, SQLITE_DESERIALIZE_RESIZEABLE = 2;
    const minusOne = await allocPointer(1);
    await writeNumberAt(minusOne, 0, 'int32', -1);
    const SQLITE_TRANSIENT = await readPointerAt(minusOne, 0);

    // sqlite3_open and sqlite3_prepare_v2 hand back their handle through a pointer slot.
    const slot = await allocPointer(1);
    const open = async () => {
        if (await sqlite3_open(':memory:', slot) !== SQLITE_OK) throw new Error('cannot open the database');
        return await readPointerAt(slot, 0);
    };
    const prepare = async (db, sql) => {
        if (await sqlite3_prepare_v2(db, sql, -1, slot, null) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return await readPointerAt(slot, 0);
    };

    const db = await open();
    await sqlite3_exec(db, "create table readings(sensor text, celsius real); insert into readings values ('attic', 21.5), ('cellar', 12.25), ('garden', 17.0)", null, null, null);
    // The database file's bytes, as a string with one character per byte.
    const size = await allocBuffer(8);
    const data = await sqlite3_serialize(db, 'main', size, 0);
    if (!data) throw new Error('sqlite3_serialize could not copy the database');
    const image = await readBytes(data, await readNumberAt(size, 0, 'int64'));
    await sqlite3_free(data);
    await sqlite3_close(db);
    console.log(`${image.length} B, starts with "${image.slice(0, 15)}"`);

    const copy = await open();
    // SQLite owns this memory from here on: it frees it with the connection, or at once if the call fails.
    const bytes = await sqlite3_malloc64(image.length);
    await writeBytes(bytes, image);
    const flags = SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE;
    if (await sqlite3_deserialize(copy, 'main', bytes, image.length, image.length, flags) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(copy));

    // Each table as "name(column TYPE, ...): N rows".
    const lines = [];
    const tables = await prepare(copy, "select name from sqlite_schema where type = 'table' and name not like 'sqlite_%' order by name");
    while (await sqlite3_step(tables) === SQLITE_ROW) {
        const table = await readCString(await sqlite3_column_text(tables, 0));
        const columns = await prepare(copy, 'select name, type from pragma_table_info(?1)');
        await sqlite3_bind_text(columns, 1, table, -1, SQLITE_TRANSIENT);
        const described = [];
        while (await sqlite3_step(columns) === SQLITE_ROW) {
            described.push(`${await readCString(await sqlite3_column_text(columns, 0))} ${await readCString(await sqlite3_column_text(columns, 1))}`);
        }
        await sqlite3_finalize(columns);
        // A table name cannot be a bound parameter, so it is quoted as an identifier instead.
        const count = await prepare(copy, `select count(*) from "${table.replaceAll('"', '""')}"`);
        await sqlite3_step(count);
        lines.push(`${table}(${described.join(', ')}): ${await sqlite3_column_int64(count, 0)} rows`);
        await sqlite3_finalize(count);
    }
    await sqlite3_finalize(tables);
    console.log(lines.join('\n'));
    await sqlite3_close(copy);
}
