import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    spatialite_version, spatialite_alloc_connection, spatialite_init_ex, spatialite_cleanup_ex,
} from '@crossbind/port-spatialite-node/spatialite.h';
import {
    sqlite3_open, sqlite3_prepare_v2, sqlite3_step, sqlite3_column_double, sqlite3_column_text, sqlite3_finalize, sqlite3_close,
    SQLITE_OK, SQLITE_ROW, AllSymbols,
} from '@crossbind/port-spatialite-node/sqlite3.h';

// The expected values come from elsewhere: the version from package.json, the area from the rectangle's sides.
const SQL = "SELECT ST_Area(GeomFromText('POLYGON((0 0, 4 0, 4 3, 0 3, 0 0))')), spatialite_version()";
const { allocPointer, readPointerAt, readCString } = AllSymbols;

const dbSlot = allocPointer(1);
assert.equal(sqlite3_open(':memory:', dbSlot), SQLITE_OK);
const db = readPointerAt(dbSlot, 0);
const connection = spatialite_alloc_connection();
spatialite_init_ex(db, connection, 0);

const statementSlot = allocPointer(1);
assert.equal(sqlite3_prepare_v2(db, SQL, -1, statementSlot, null), SQLITE_OK);
const statement = readPointerAt(statementSlot, 0);
assert.equal(sqlite3_step(statement), SQLITE_ROW);
assert.equal(sqlite3_column_double(statement, 0), 12);
assert.equal(readCString(sqlite3_column_text(statement, 1)), process.env.NATIVE_VERSION);
assert.equal(sqlite3_finalize(statement), SQLITE_OK);
assert.equal(sqlite3_close(db), SQLITE_OK);
spatialite_cleanup_ex(connection);

assert.equal(spatialite_version(), process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-spatialite-node/spatialite.h').spatialite_version, spatialite_version);
console.log(`ok: spatialite ${spatialite_version()} on ${process.platform}-${process.arch}`);
