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
export const note = 'FTS4, `MATCH` and `snippet()` are SQL, so the search is the same; JavaScript binds the query, steps through the matches and reads each snippet with `readCString`. Errors come back as codes: a malformed query ends the loop, `sqlite3_finalize` returns 1 and `sqlite3_errmsg` says "malformed MATCH expression", which the code throws itself where the C++ wrapper threw.';
export const expected = [
    'parse -> libcurl [parses] and normalizes URLs exactly like the… | [Parsing] XML with expat',
    '"signing request" -> …key, a certificate [signing] [request] and a self…',
    'brows* -> SQLite in the [browser]',
    'parser NOT expat -> curl URL [parser]',
    'tag NEAR/2 text -> …start tag, end [tag] and [text] run as…',
];

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
    // The porter tokenizer reduces English words to their stems: "parse" also finds "parses" and "parsing".
    await sqlite3_exec(db, 'create virtual table docs using fts4(title, body, tokenize=porter)', null, null, null);

    const add = async (title, body) => {
        const insert = await prepare('insert into docs(title, body) values (?1, ?2)');
        await sqlite3_bind_text(insert, 1, title, -1, SQLITE_TRANSIENT);
        await sqlite3_bind_text(insert, 2, body, -1, SQLITE_TRANSIENT);
        await sqlite3_step(insert);
        if (await sqlite3_finalize(insert) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
    };
    // A snippet of every matching document with the hits in [brackets], joined by " | ".
    const search = async (query) => {
        const select = await prepare("select snippet(docs, '[', ']', '…', -1, 8) from docs where docs match ?1 order by docid");
        await sqlite3_bind_text(select, 1, query, -1, SQLITE_TRANSIENT);
        const snippets = [];
        while (await sqlite3_step(select) === SQLITE_ROW) snippets.push(await readCString(await sqlite3_column_text(select, 0)));
        if (await sqlite3_finalize(select) !== SQLITE_OK) throw new Error(await sqlite3_errmsg(db));
        return snippets.join(' | ');
    };

    await add('SQLite in the browser', 'SQLite runs inside the browser tab as WebAssembly; queries never leave the page.');
    await add('OpenSSL certificates', 'Generate a key, a certificate signing request and a self-signed certificate offline.');
    await add('curl URL parser', 'libcurl parses and normalizes URLs exactly like the curl command line tool.');
    await add('Parsing XML with expat', 'expat is a stream-oriented parser: it reports each start tag, end tag and text run as it reads.');
    for (const query of ['parse', '"signing request"', 'brows*', 'parser NOT expat', 'tag NEAR/2 text']) {
        console.log(`${query} -> ${await search(query)}`);
    }
    await sqlite3_close(db);
}
