import {
    initNative, sqlite3_libversion, sqlite3_complete,
} from '@crossbind/port-sqlite3/sqlite3.h';

await initNative();

console.log('SQLite', await sqlite3_libversion());

const sql = 'select 1;';
console.log(sql, 'is complete:', await sqlite3_complete(sql));
