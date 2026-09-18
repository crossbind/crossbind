import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStatement, DEFAULT_QUERY, insertStatement, TABLE, toTable } from '../src/live/sqlite.js';

const port = (overrides) => ({
    name: 'GDAL',
    nativeVersion: '3.13.3',
    category: 'geo',
    license: 'MIT',
    targets: [
        { target: 'wasm', published: '2.0.0-beta.56' },
        { target: 'bin-wasi', published: '2.0.0-beta.56' },
        { target: 'ios', published: null },
    ],
    ...overrides,
});

test('creates the table the default query reads', () => {
    assert.match(createStatement(), /^create table libraries \(/);
    assert.ok(DEFAULT_QUERY.includes(`from ${TABLE}`));
});

test('counts only published library targets, leaving command packages out', () => {
    assert.ok(insertStatement([port()]).endsWith("('GDAL', '3.13.3', 'Geospatial', 'MIT', 1);"));
});

test('escapes a quote in a library name so the statement stays one row', () => {
    const statement = insertStatement([port({ name: "O'Brien" })]);

    assert.ok(statement.includes("('O''Brien', '3.13.3'"));
    assert.equal(statement.split('), (').length, 1);
});

test('keeps the column order the query asked for and blanks a null', () => {
    const table = toTable('[{"category":"geo","libraries":4,"names":null}]');

    assert.deepEqual(table.columns, ['category', 'libraries', 'names']);
    assert.deepEqual(table.rows, [['geo', '4', '']]);
});

test('reports no columns for an empty result', () => {
    assert.deepEqual(toTable('[]'), { columns: [], rows: [] });
});
