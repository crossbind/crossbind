import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import {
    sqlite3_libversion, sqlite3_open, sqlite3_prepare_v2, sqlite3_bind_text, sqlite3_step, sqlite3_column_int,
    sqlite3_column_text, sqlite3_finalize, sqlite3_close, SQLITE_OK, SQLITE_ROW, AllSymbols,
} from '@crossbind/port-sqlite3-node/sqlite3.h';

// The expected values come from elsewhere: the version from package.json, the row from Node's own SQLite.
const { allocPointer, readPointerAt, cstring, readCString } = AllSymbols;
const SQL = 'select 6*7 as v, upper(?) as s';
const WORD = 'crossbind';

const dbSlot = allocPointer(1);
assert.equal(sqlite3_open(':memory:', dbSlot), SQLITE_OK);
const db = readPointerAt(dbSlot, 0);
const statementSlot = allocPointer(1);
assert.equal(sqlite3_prepare_v2(db, SQL, -1, statementSlot, null), SQLITE_OK);
const statement = readPointerAt(statementSlot, 0);
// SQLite keeps the bound text without copying it, so it lives in a C string the statement outlasts.
const word = cstring(WORD);
assert.equal(sqlite3_bind_text(statement, 1, word, -1, null), SQLITE_OK);
assert.equal(sqlite3_step(statement), SQLITE_ROW);

const expected = new DatabaseSync(':memory:').prepare(SQL).get(WORD);
assert.equal(sqlite3_column_int(statement, 0), expected.v);
assert.equal(readCString(sqlite3_column_text(statement, 1)), expected.s);
assert.equal(sqlite3_finalize(statement), SQLITE_OK);
assert.equal(sqlite3_close(db), SQLITE_OK);

assert.equal(sqlite3_libversion(), process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-sqlite3-node/sqlite3.h').sqlite3_open, sqlite3_open);
console.log(`ok: sqlite ${sqlite3_libversion()} on ${process.platform}-${process.arch}`);
