export const imports = {
    '@crossbind/port-sqlite3/sqlite3.h': [
        'sqlite3_open',
        'sqlite3_close',
        'sqlite3_exec',
        'sqlite3_prepare_v2',
        'sqlite3_bind_text',
        'sqlite3_step',
        'sqlite3_column_text',
        'sqlite3_finalize',
        'sqlite3_errmsg',
        'allocPointer',
        'readPointerAt',
        'writeNumberAt',
        'readCString',
    ],
};
export const note = 'The SQL does all the JSON work, so nothing changes but the plumbing: each query is prepared, bound, stepped once and finalized by hand, and its one text column is read with `readCString` before `sqlite3_finalize` frees it.';
export const expected = ['{"ada":13.75,"linus":15.0}', '{"pen":12,"pad":3,"ink":1}', '["ada","linus"]'];

export default async function example({ sqlite3_open, sqlite3_close, sqlite3_exec, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_step, sqlite3_column_text, sqlite3_finalize, sqlite3_errmsg, allocPointer, readPointerAt, writeNumberAt, readCString }, console) {
    // sqlite3.h's constants are macros without bindings. SQLITE_TRANSIENT is
    // ((sqlite3_destructor_type)-1): a pointer with the address -1, which a slot holding -1 reads back.
    const SQLITE_OK = 0, SQLITE_ROW = 100;
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
    await sqlite3_exec(db, 'create table orders(id integer primary key, doc text not null check (json_valid(doc)))', null, null, null);

    const add = async (json) => {
        const insert = await prepare('insert into orders(doc) values (?1)');
        await sqlite3_bind_text(insert, 1, json, -1, SQLITE_TRANSIENT);
        await sqlite3_step(insert);
        if (await sqlite3_finalize(insert) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    };
    // The first column of the first row, with `parameter` bound to ?1 when there is one.
    const value = async (sql, parameter) => {
        const query = await prepare(sql);
        if (parameter !== undefined) await sqlite3_bind_text(query, 1, parameter, -1, SQLITE_TRANSIENT);
        if (await sqlite3_step(query) !== SQLITE_ROW) throw new Error(await sqlite3_errmsg(db));
        const text = await sqlite3_column_text(query, 0);
        const result = text ? await readCString(text) : 'null';
        await sqlite3_finalize(query);
        return result;
    };

    await add('{"customer":"ada","items":[{"sku":"pen","qty":2,"price":1.5},{"sku":"ink","qty":1,"price":4}]}');
    await add('{"customer":"linus","items":[{"sku":"pen","qty":10,"price":1.5}]}');
    await add('{"customer":"ada","items":[{"sku":"pad","qty":3,"price":2.25}]}');
    console.log(await value(`
        select json_group_object(customer, total order by customer) from (
          select doc ->> 'customer' as customer, sum((item.value ->> 'qty') * (item.value ->> 'price')) as total
          from orders, json_each(orders.doc, '$.items') as item group by customer)`));
    console.log(await value(`
        select json_group_object(sku, units order by units desc, sku) from (
          select item.value ->> 'sku' as sku, sum(item.value ->> 'qty') as units
          from orders, json_each(orders.doc, '$.items') as item group by sku)`));
    console.log(await value(`
        select json_group_array(distinct doc ->> 'customer' order by doc ->> 'customer')
          from orders, json_each(orders.doc, '$.items') as item where item.value ->> 'sku' = ?1`, 'pen'));
    await sqlite3_close(db);
}
