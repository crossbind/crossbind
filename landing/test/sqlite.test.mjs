import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
    createStatement, DEFAULT_QUERY, insertStatement, MAIN_AFTER, MAIN_BEFORE, TABLE, toTable, withoutCommentLines,
} from '../src/live/sqlite.js';
import { SAMPLE_LIST } from '../src/playground/sampleList.js';
import { CATEGORY_LABELS, PORTS } from '../src/ports/catalog.js';

const sampleFile = (name) => readFileSync(new URL(`../src/playground/samples/sqlite/${name}`, import.meta.url), 'utf8');

test("the home page shows every line of the demo's database.h but its comments", () => {
    const real = readFileSync(new URL('../demos/panel-sqlite/src/native/database.h', import.meta.url), 'utf8');
    const code = real.split('\n').filter((line) => !line.trim().startsWith('//'));

    assert.equal(withoutCommentLines(real), code.join('\n'));
    assert.match(withoutCommentLines(real), /sqlite3_open\(/);
});

test('the page imports that header itself, so the code it shows cannot drift from the demo', () => {
    const page = readFileSync(new URL('../src/sections/LibraryDemo.jsx', import.meta.url), 'utf8');

    assert.ok(page.includes("from '../../demos/panel-sqlite/src/native/database.h?raw';"));
});

test("the playground's SQLite sample runs the home page's database.h, and its main.js opens with the one the home page shows", () => {
    const demo = readFileSync(new URL('../demos/panel-sqlite/src/native/database.h', import.meta.url), 'utf8');

    assert.equal(withoutCommentLines(sampleFile('native/database.h')), withoutCommentLines(demo));
    assert.ok(sampleFile('main.js').startsWith(`${MAIN_BEFORE}\n${DEFAULT_QUERY}\n${MAIN_AFTER}\n`));
});

test("the sample's catalog.js holds the catalog's libraries and categories in the home page's order, so its query prints the same rows", () => {
    const rows = [...sampleFile('catalog.js').matchAll(/^\s*\('((?:[^']|'')*)', '((?:[^']|'')*)'\)[,;]$/gm)]
        .map(([, name, category]) => [name, category].map((text) => text.replaceAll("''", "'")));

    assert.deepEqual(rows, PORTS.map((port) => [port.name, CATEGORY_LABELS[port.category] ?? port.category]));
});

test('Try in Playground, a text link across the row from Run, opens that sample with the SQLite port; phones leave it out', () => {
    const page = readFileSync(new URL('../src/sections/LibraryDemo.jsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

    assert.ok(SAMPLE_LIST.some(({ id, packages }) => id === 'sqlite' && packages.includes('port:sqlite3')));
    assert.match(page, /\?sample=sqlite`/);
    assert.match(page, /className="tap-target demo-try"[^>]*>\s*Try in Playground →\s*</);
    assert.doesNotMatch(page, /secondaryButtonStyle/);
    assert.match(css, /@media \(max-width: 860px\) \{[^@]*\.demo-try \{\s*display: none !important;/);
});

test("the demo's code wraps a long line rather than scrolling sideways", () => {
    const page = readFileSync(new URL('../src/sections/LibraryDemo.jsx', import.meta.url), 'utf8');

    assert.match(page, /whiteSpace: 'pre-wrap'/);
    assert.doesNotMatch(page, /whiteSpace: 'pre'(?!-)/);
});

test('the main.js the home page shows imports that header and hands the visitor\'s query to db.query', () => {
    assert.match(MAIN_BEFORE, /^import \{ initNative, Database \} from '\.\/native\/database\.h';$/m);
    assert.match(MAIN_BEFORE, /^import \{ catalogAsSql \} from '\.\/catalog\.js';$/m);
    assert.match(MAIN_BEFORE, /const db = await new Database\(\);/);
    assert.match(MAIN_BEFORE, /await db\.query\(`$/);
    assert.equal(MAIN_AFTER, '`);');
});

const port = (overrides) => ({
    name: 'GDAL',
    nativeVersion: '3.13.3',
    category: 'geo',
    license: 'MIT',
    targets: [
        { target: 'wasm', published: '2.0.0-beta.56' },
        { target: 'standalone-wasi', published: '2.0.0-beta.56' },
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
