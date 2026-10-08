import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import { ENTRY_RUNTIMES } from '../src/utils/runtimeEntries.js';
import writeRuntimeEntry, { removeImportHooks, writeImportHooks } from '../src/actions/writeRuntimeEntry.js';

const EXTENSIONS = ['h', 'hpp', 'hxx', 'hh', 'i', 'rs'];

let work;

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-import-hooks-'))));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function write(file, text = '') {
    const full = upath.join(work, file);
    fs.mkdirSync(upath.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
}

// A bound header and the export list its bridge left, the way createBridgeFile leaves one.
function bound(file, names) {
    const bridge = write(`build/bridge/${upath.basename(file)}.i.cpp`);
    write(`build/bridge/${upath.basename(file)}.i.cpp.exports.json`, JSON.stringify(names));
    return { file: upath.join(work, file), bridge };
}

// A dist shaped like a Node build's: the CommonJS loader, the entry and the hooks beside it.
function writeBuild(headers, imports = new Map(), out = 'dist') {
    write(`${out}/demo.node.js`, [
        "const members = { Native: { sample: () => 'J3' }, ANSWER: 42, Matrix: class Matrix {}, semver_Version: class SemverVersion {}, argon2_Version: class Argon2Version {} };",
        'module.exports = () => Promise.resolve({ ...members });',
        'module.exports.terminate = () => {};',
        '',
    ].join('\n'));
    writeRuntimeEntry(upath.join(work, `${out}/node/wasm.mjs`), headers, ENTRY_RUNTIMES.node('demo.node.js'));
    writeImportHooks(upath.join(work, `${out}/node/wasm.mjs`), headers, imports, EXTENSIONS);
}

function runApp(app, out = 'dist') {
    const register = pathToFileURL(upath.join(work, `${out}/node/wasm.register.mjs`)).href;
    const { stdout, stderr, status } = spawnSync(process.execPath, ['--import', register, upath.join(work, app)], { encoding: 'utf8' });
    return { stdout: stdout.trim(), stderr, status };
}

describe('writeImportHooks', () => {
    test('lets an app import a header by relative path and a package header by its specifier', () => {
        write('src/native/native.h');
        write('pkg/include/Matrix.h');
        writeBuild(
            [bound('src/native/native.h', ['Native', 'ANSWER']), bound('pkg/include/Matrix.h', ['Matrix'])],
            new Map([[upath.join(work, 'pkg/include/Matrix.h'), { specifiers: ['@demo/matrix/Matrix.h'] }]]),
        );
        write('src/app.mjs', [
            "import { initNative, Native, ANSWER } from './native/native.h';",
            "import { Matrix } from '@demo/matrix/Matrix.h';",
            'await initNative();',
            'console.log(JSON.stringify({ sample: Native.sample(), answer: ANSWER, matrix: Matrix.name }));',
        ].join('\n'));

        const { stdout, status, stderr } = runApp('src/app.mjs');

        expect(stderr).toBe('');
        expect(status).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ sample: 'J3', answer: 42, matrix: 'Matrix' });
    });

    test('serves a Rust import by the names the build brings for it', () => {
        write('src/native/counter.rs');
        writeBuild([{ file: upath.join(work, 'src/native/counter.rs'), names: ['Matrix'] }]);
        write('src/app.mjs', "import { initNative, Matrix } from './native/counter.rs';\nawait initNative();\nconsole.log(Matrix.name);\n");

        expect(runApp('src/app.mjs')).toMatchObject({ stdout: 'Matrix', status: 0 });
    });

    test('gives each crate its own class when two crates export one name', () => {
        const crate = (name, wire) => ({ file: write(`.crossbind/rust-crates/${name}.rs`), names: [{ local: 'Version', wire }] });
        const crates = [crate('semver', 'semver_Version'), crate('argon2', 'argon2_Version')];
        writeBuild(crates, new Map(crates.map(({ file }) => [file, { specifiers: [`cargo:${upath.basename(file, '.rs')}`] }])));
        write('src/app.mjs', [
            "import { Version } from 'cargo:semver';",
            "import { initNative, Version as Argon2Version } from 'cargo:argon2';",
            'await initNative();',
            'console.log(`${Version.name} ${Argon2Version.name}`);',
        ].join('\n'));

        expect(runApp('src/app.mjs')).toMatchObject({ stdout: 'SemverVersion Argon2Version', status: 0 });
    });

    test('gives require() the header module, whose names initNative fills', () => {
        write('src/native/native.h');
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('src/app.cjs', [
            "const native = require('./native/native.h');",
            'native.initNative().then(() => console.log(native.Native.sample()));',
        ].join('\n'));

        expect(runApp('src/app.cjs')).toMatchObject({ stdout: 'J3', status: 0 });
    });

    test('names the build when the app imports a header it did not bind', () => {
        write('src/native/native.h');
        write('src/native/other.h');
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('src/app.mjs', "import { Other } from './native/other.h';\n");

        const { stderr, status } = runApp('src/app.mjs');

        expect(status).not.toBe(0);
        expect(stderr).toContain(`crossbind: ${path.join(work, 'src', 'native', 'other.h')} is not bound by the last crossbind build`);
    });

    test('names the build for a conan: or cargo: import it did not bind', () => {
        write('src/native/native.h');
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('src/conan.mjs', "import 'conan:zlib/zlib.h';\n");
        write('src/cargo.mjs', "import 'cargo:serde_json';\n");

        expect(runApp('src/conan.mjs').stderr).toContain('crossbind: conan:zlib/zlib.h, imported from');
        expect(runApp('src/cargo.mjs').stderr).toContain('crossbind: cargo:serde_json, imported from');
    });

    test('fails to link an import of a name the header does not export', () => {
        write('src/native/native.h');
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('src/app.mjs', "import { Missing } from './native/native.h';\n");

        expect(runApp('src/app.mjs').stderr).toMatch(/does not provide an export named 'Missing'/);
    });

    test.skipIf(process.platform === 'win32')('matches a header under a linked directory by its real path', () => {
        write('shared/native/native.h');
        fs.mkdirSync(upath.join(work, 'src'));
        fs.symlinkSync('../shared/native', upath.join(work, 'src/native'));
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('src/app.mjs', "import { initNative, Native } from './native/native.h';\nawait initNative();\nconsole.log(Native.sample());\n");

        expect(runApp('src/app.mjs')).toMatchObject({ stdout: 'J3', status: 0 });
    });

    test('removes the hooks once the sources import nothing native, keeping what another binary still loads', () => {
        write('src/native/native.h');
        writeBuild([bound('src/native/native.h', ['Native'])]);
        write('dist/node/napi.register.mjs');
        const exists = (file) => fs.existsSync(upath.join(work, 'dist/node', file));

        removeImportHooks(upath.join(work, 'dist/node/wasm.mjs'));
        expect([exists('wasm.register.mjs'), exists('hooks.mjs')]).toEqual([false, true]);
        removeImportHooks(upath.join(work, 'dist/node/napi.mjs'));
        expect([exists('napi.register.mjs'), exists('hooks.mjs')]).toEqual([false, false]);
    });

    test.skipIf(process.platform === 'win32')('serves a relative import when the build named its output through a link', () => {
        write('deep/app/src/native/native.h');
        fs.symlinkSync(upath.join(work, 'deep/app'), upath.join(work, 'app'));
        writeBuild([bound('deep/app/src/native/native.h', ['Native'])], new Map(), 'app/dist');
        write('deep/app/src/app.mjs', "import { initNative, Native } from './native/native.h';\nawait initNative();\nconsole.log(Native.sample());\n");

        expect(runApp('deep/app/src/app.mjs', 'app/dist')).toMatchObject({ stdout: 'J3', status: 0 });
    });
});
