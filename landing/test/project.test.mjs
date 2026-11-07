import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_FILES, MAX_PACKAGES, validateRequest } from '../../tooling/cloud/compiler/validate.js';
import { PACKAGES } from '../../tooling/cloud/compiler/packages.js';
import { sampleProject } from '../../scripts/site/build-example-demos.mjs';
import { ImportError, importSpecifiers, prepareModules } from '../src/playground/modules.js';
import {
    addFile, addPackage, compileRequest, fileNames, importStatements, newFileError, removePackage, scriptsOf, servesProject, usageOf,
} from '../src/playground/project.js';
import { SAMPLE_LIST } from '../src/playground/sampleList.js';

const EMPTY = Object.freeze({ files: { 'main.js': '' }, packages: [] });
const TOKEN = 'crossbind-0123456789abcdef';

test('a new file is named the way the compiler takes it, once, within the file limit', () => {
    assert.equal(newFileError(EMPTY, 'greet.h'), null);
    assert.match(newFileError(EMPTY, 'greet.txt'), /\.h, \.hpp, \.cpp, \.cc or \.rs/);
    assert.match(newFileError(EMPTY, '../greet.h'), /C identifier/);
    assert.match(newFileError(addFile(EMPTY, 'greet.h'), 'greet.h'), /already/);
    const full = { ...EMPTY, files: Object.fromEntries(Array.from({ length: MAX_FILES }, (_, i) => [`native/f${i}.h`, ''])) };
    assert.match(newFileError(full, 'one.h'), new RegExp(`${MAX_FILES} files`));
});

test('a new header starts with #pragma once and the files list main.js first', () => {
    const project = addFile(addFile(EMPTY, 'b.rs'), 'a.h');
    assert.equal(project.files['native/a.h'], '#pragma once\n');
    assert.deepEqual(fileNames(project), ['main.js', 'native/a.h', 'native/b.rs']);
});

test('adding a package main.js imports writes its import once; one the C++ includes leaves main.js alone', () => {
    const sqlite = addPackage(EMPTY, 'port:sqlite3');
    assert.equal(sqlite.files['main.js'], "import { sqlite3_libversion } from '@crossbind/port-sqlite3/sqlite3.h';\n");
    assert.deepEqual(addPackage(sqlite, 'port:sqlite3'), sqlite);
    assert.equal(addPackage({ ...EMPTY, files: { 'main.js': "import { Uuid } from 'cargo:uuid';" } }, 'crate:uuid').files['main.js'], "import { Uuid } from 'cargo:uuid';");
    assert.deepEqual(addPackage(EMPTY, 'port:zlib'), { ...EMPTY, packages: ['port:zlib'] });
    assert.equal(usageOf(PACKAGES.find(({ id }) => id === 'port:zlib')).line, '#include <zlib.h>');
    assert.deepEqual(removePackage(sqlite, 'port:sqlite3').packages, []);
});

test('no more packages than the compiler takes', () => {
    const full = PACKAGES.slice(0, MAX_PACKAGES).reduce((project, { id }) => addPackage(project, id), EMPTY);
    assert.equal(full.packages.length, MAX_PACKAGES);
    assert.deepEqual(addPackage(full, PACKAGES[MAX_PACKAGES].id), full);
});

test('every sample, as a compile sends it, is a project the compiler accepts', () => {
    SAMPLE_LIST.forEach(({ id }) => assert.doesNotThrow(() => validateRequest(compileRequest(sampleProject(id))), id));
});

test('a compile sends main.js and the native files; the project\'s other scripts stay in the page', () => {
    const project = { files: { 'main.js': '', 'catalog.js': 'export const a = 1;', 'native/a.h': '' }, packages: ['port:zlib'] };
    assert.deepEqual(compileRequest(project), { files: { 'main.js': '', 'native/a.h': '' }, packages: ['port:zlib'] });
    assert.deepEqual(scriptsOf(project), { 'catalog.js': 'export const a = 1;' });
});

test('a prebuilt module serves edits to the project\'s scripts, which it never compiled', () => {
    const original = { files: { 'main.js': "import { a } from './catalog.js';", 'catalog.js': 'export const a = 1;', 'native/n.h': 'h' }, packages: [] };
    assert.ok(servesProject({ ...original, files: { ...original.files, 'catalog.js': 'export const a = 2;' } }, original));
});

test('a prebuilt module serves edits below main.js\'s imports, not to its imports, its native files or its packages', () => {
    const original = { files: { 'main.js': "import { greet } from './native/native.h';\n\nconsole.log(greet('a'));", 'native/native.h': 'h' }, packages: [] };
    const withMain = (text) => ({ ...original, files: { ...original.files, 'main.js': text } });
    assert.ok(servesProject(withMain("import  {  greet }\n  from './native/native.h';\nconsole.log(greet('b'));"), original));
    assert.ok(!servesProject(withMain("import { greet, Counter } from './native/native.h';\nconsole.log(greet('a'));"), original));
    assert.ok(!servesProject({ ...original, files: { ...original.files, 'native/native.h': 'changed' } }, original));
    assert.ok(!servesProject({ ...original, packages: ['port:zlib'] }, original));
    assert.ok(!servesProject(withMain("import { greet } from './native/native.h';\nconst { more } = await import('./native/more.h');"), original));
    assert.deepEqual(importStatements("import {\n  a,\n  b,\n} from 'x';\nconst c = 'import d from \"e\"';"), ["import { a, b, } from 'x'"]);
});

const IMPORTS = {
    natives: [
        { file: 'src/native/greet.h', specifiers: [], names: ['greet', 'Counter'] },
        { file: 'node_modules/@crossbind/port-sqlite3-wasm/dist/include/sqlite3.h', specifiers: ['@crossbind/port-sqlite3/sqlite3.h'], names: ['sqlite3_libversion'] },
        { file: '.crossbind/rust-crates/semver.rs', specifiers: ['cargo:semver'], names: [{ local: 'Version', wire: 'semver_Version' }] },
    ],
};

test('main.js\'s native imports point at the modules made from the import list, by file or by specifier', () => {
    const code = "import { greet } from './native/greet.h';\nimport { sqlite3_libversion } from \"@crossbind/port-sqlite3/sqlite3.h\";\nimport { Version } from 'cargo:semver';";
    const modules = prepareModules({ code, imports: IMPORTS, token: TOKEN });
    const main = modules.at(-1);
    assert.equal(modules.length, 5);
    assert.ok(main.includes(`from '${TOKEN}:1'`));
    assert.ok(main.includes(`from "${TOKEN}:2"`));
    assert.ok(main.includes(`from '${TOKEN}:3'`));
    assert.match(modules[0], /export \{ \$0 as greet, \$1 as Counter, \$2 as sqlite3_libversion, \$3 as semver_Version \};/);
    assert.equal(modules[3], `export { initNative, AllSymbols, semver_Version as Version } from '${TOKEN}:0';`);
});

test('main.js\'s import of a project script points at a module made from it, ahead of main.js; a missing one is named', () => {
    const scripts = { 'catalog.js': 'export const catalogAsSql = 1;' };
    const code = "import { catalogAsSql } from './catalog.js';\nimport { greet } from './native/greet.h';";
    const modules = prepareModules({ code, imports: IMPORTS, token: TOKEN, scripts });
    assert.equal(modules.at(-2), scripts['catalog.js']);
    assert.ok(modules.at(-1).includes(`from '${TOKEN}:${modules.length - 2}'`));
    assert.ok(modules.at(-1).includes(`from '${TOKEN}:1'`));
    assert.throws(() => prepareModules({ code: "import { x } from './gone.js';", imports: IMPORTS, token: TOKEN }), /'\.\/gone\.js'/);
});

test('a native import the project does not provide stops the run with its name; the browser resolves the others', () => {
    assert.throws(
        () => prepareModules({ code: "import _ from 'lodash';\nimport { x } from './native/missing.h';", imports: IMPORTS, token: TOKEN }),
        (error) => error instanceof ImportError && error.message.startsWith("main.js imports './native/missing.h', which"),
    );
});

test('text that only reads like an import is left as it is', () => {
    const code = "console.log('Result from', greet('a'), 'done');\nconsole.log('import', 'x');\n// greet comes from 'native'";
    assert.equal(prepareModules({ code, imports: IMPORTS, token: TOKEN }).at(-1), code);
});

test('an import list naming something other than an identifier never reaches the modules\' code', () => {
    const imports = { natives: [{ file: 'src/native/greet.h', specifiers: [], names: ['greet; alert(1)'] }] };
    assert.throws(() => prepareModules({ code: '', imports, token: TOKEN }), ImportError);
});

test('the import scan finds what crossbind\'s own scan finds', () => {
    assert.deepEqual(importSpecifiers("import a from 'a';\nexport { b } from \"b\";\nimport 'c';\nconst d = await import('d');\nconst e = 'e';"), ['a', 'b', 'c', 'd']);
});
