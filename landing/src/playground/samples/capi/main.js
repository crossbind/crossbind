import {
    initNative, sqlite3_open, sqlite3_exec, sqlite3_changes,
    sqlite3_close, SQLITE_OK, allocPointer, readPointerAt,
} from '@crossbind/port-sqlite3/sqlite3.h';

await initNative();

// sqlite3_open hands the database back through a pointer slot.
const slot = await allocPointer(1);
const status = await sqlite3_open(':memory:', slot);
const db = await readPointerAt(slot, 0);
console.log('opened:', status === await SQLITE_OK);

await sqlite3_exec(db, 'create table t (x)', null, null, null);
const insert = 'insert into t values (1), (2)';
await sqlite3_exec(db, insert, null, null, null);
console.log('rows added:', await sqlite3_changes(db));
await sqlite3_close(db);
