export const imports = {
    '@crossbind/port-sqlite3/sqlite3.h': [
        'sqlite3_open',
        'sqlite3_close',
        'sqlite3_exec',
        'sqlite3_prepare_v2',
        'sqlite3_bind_text',
        'sqlite3_bind_int64',
        'sqlite3_step',
        'sqlite3_reset',
        'sqlite3_column_text',
        'sqlite3_column_int64',
        'sqlite3_finalize',
        'sqlite3_errmsg',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
        'readCString',
    ],
};
export const note = 'The same `BEGIN`, reset-and-rebind loop and `COMMIT`; the failing row now makes the code finalize and `ROLLBACK` by hand, and the rows stay JavaScript arrays instead of one "account,amount" string. `sqlite3_column_int64` returns a BigInt. Each call is its own round trip to the worker, so the 10000 rows take about 40000 of them (0.85 s in headless Chromium when this was checked) where the C++ version crossed once.';
export const expected = [
    '10000 rows applied',
    'alice 13333, bob 13330, carol 13331',
    'rolled back: CHECK constraint failed: total >= 0',
    'alice 13333, bob 13330, carol 13331',
];

export default async function example({ sqlite3_open, sqlite3_close, sqlite3_exec, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_bind_int64, sqlite3_step, sqlite3_reset, sqlite3_column_text, sqlite3_column_int64, sqlite3_finalize, sqlite3_errmsg, allocPointer, readPointerAt, writeNumberAt, readCString }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is
    // ((sqlite3_destructor_type)-1): a pointer with the address -1, which a slot holding -1 reads back.
    const SQLITE_OK = 0, SQLITE_ROW = 100, SQLITE_DONE = 101;
    const minusOne = await allocPointer(1);
    await writeNumberAt(minusOne, 0, 'int32', -1);
    const SQLITE_TRANSIENT = await readPointerAt(minusOne, 0);

    // sqlite3_open and sqlite3_prepare_v2 hand back their handle through a pointer slot.
    const slot = await allocPointer(1);
    if (await sqlite3_open(':memory:', slot) !== SQLITE_OK) throw new Error('cannot open the database');
    const db = await readPointerAt(slot, 0);
    const prepare = async (sql) => {
        if (await sqlite3_prepare_v2(db, sql, -1, slot, null) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return await readPointerAt(slot, 0);
    };
    await sqlite3_exec(db, 'create table balances(account text primary key, total integer not null check (total >= 0))', null, null, null);

    // All rows or none: one prepared upsert, reset and re-bound for every row, inside BEGIN ... COMMIT.
    const apply = async (rows) => {
        const upsert = await prepare('insert into balances(account, total) values (?1, ?2) on conflict(account) do update set total = total + excluded.total');
        await sqlite3_exec(db, 'begin', null, null, null);
        for (const [account, amount] of rows) {
            await sqlite3_bind_text(upsert, 1, account, -1, SQLITE_TRANSIENT);
            await sqlite3_bind_int64(upsert, 2, amount);
            if (await sqlite3_step(upsert) !== SQLITE_DONE) {
                const reason = await sqlite3_errmsg(db);
                await sqlite3_finalize(upsert);
                await sqlite3_exec(db, 'rollback', null, null, null);
                throw new Error(reason);
            }
            await sqlite3_reset(upsert);
        }
        await sqlite3_finalize(upsert);
        await sqlite3_exec(db, 'commit', null, null, null);
        return rows.length;
    };
    const balances = async () => {
        const query = await prepare('select account, total from balances order by account');
        const parts = [];
        while (await sqlite3_step(query) === SQLITE_ROW) {
            parts.push(`${await readCString(await sqlite3_column_text(query, 0))} ${await sqlite3_column_int64(query, 1)}`);
        }
        await sqlite3_finalize(query);
        return parts.join(', ');
    };

    const accounts = ['alice', 'bob', 'carol'];
    const rows = Array.from({ length: 10000 }, (_, i) => [accounts[i % 3], (i % 7) + 1]);
    console.log(await apply(rows), 'rows applied');
    console.log(await balances());
    try {
        await apply([['alice', 5], ['bob', -1000000]]);
    } catch (error) {
        console.log('rolled back:', error.message);
    }
    console.log(await balances());
    await sqlite3_close(db);
}
