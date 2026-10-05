import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import { ENTRY_RUNTIMES, runtimeEntryModule, uniqueBindings } from '../src/utils/runtimeEntries.js';
import writeRuntimeEntry from '../src/actions/writeRuntimeEntry.js';

let work;

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-runtime-entries-')));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

// A CommonJS loader shaped like the Node-API loader and the Node wasm build: it resolves the module and
// remembers the configs it booted with.
function writeLoader(members) {
    fs.writeFileSync(upath.join(work, 'demo.native.cjs'), [
        `const members = ${members};`,
        'function boot(config) { boot.configs.push(config); return Promise.resolve({ ...members }); }',
        'boot.configs = [];',
        'boot.terminate = () => { boot.terminated = true; };',
        'module.exports = boot;',
        '',
    ].join('\n'));
    return createRequire(upath.join(work, 'demo.cjs'))('./demo.native.cjs');
}

async function importEntry(names, members) {
    const boot = writeLoader(members);
    const entry = upath.join(work, 'node', 'napi.mjs');
    fs.mkdirSync(upath.dirname(entry), { recursive: true });
    fs.writeFileSync(entry, runtimeEntryModule(names, ENTRY_RUNTIMES.node('demo.native.cjs')));
    return { boot, entry: await import(pathToFileURL(entry).href) };
}

describe('uniqueBindings', () => {
    test('exports a name two headers bind once, under its first wire name', () => {
        expect(uniqueBindings(['compress', { local: 'iconv_open', wire: 'libiconv_open' }, 'compress', 'iconv_open']))
            .toEqual([{ local: 'compress', wire: 'compress' }, { local: 'iconv_open', wire: 'libiconv_open' }]);
    });

    test('leaves out the names the module itself exports', () => {
        expect(uniqueBindings(['initNative', 'AllSymbols', 'Matrix'])).toEqual([{ local: 'Matrix', wire: 'Matrix' }]);
    });
});

describe('runtimeEntryModule', () => {
    test('fills every bound name when initNative resolves', async () => {
        const { entry } = await importEntry(['Matrix', 'ZERO'], '{ Matrix: class Matrix {}, ZERO: 0, toArray: () => [] }');

        expect(entry.Matrix).toBeNull();
        const module = await entry.initNative();

        expect(entry.Matrix).toBe(module.Matrix);
        expect(entry.ZERO).toBe(0);
        expect(entry.AllSymbols).toBe(module);
        expect(module.toArray).toBeTypeOf('function');
    });

    test('boots the loader with the config initNative was given', async () => {
        const { boot, entry } = await importEntry([], '{}');

        await entry.initNative({ dataPath: '/opt/data' });

        expect(boot.configs).toEqual([{ dataPath: '/opt/data' }]);
    });

    test('reads a name the header renames from its wire name', async () => {
        const { entry } = await importEntry([{ local: 'iconv_open', wire: 'libiconv_open' }], '{ libiconv_open: () => 7 }');

        await entry.initNative();

        expect(entry.iconv_open()).toBe(7);
    });

    test('exports a bound name that is a JavaScript reserved word', async () => {
        const { entry } = await importEntry(['delete', 'new'], '{ delete: () => "deleted", new: 1 }');

        await entry.initNative();

        expect(entry.delete()).toBe('deleted');
        expect(entry.new).toBe(1);
    });

    test('terminates through the loader', async () => {
        const { boot, entry } = await importEntry([], '{}');

        entry.initNative.terminate();

        expect(boot.terminated).toBe(true);
    });

    // Edge runtimes compile no WebAssembly from bytes; their bundler turns the import into a module.
    test('hands an edge build its wasm module as an import', () => {
        const text = runtimeEntryModule(['Matrix'], ENTRY_RUNTIMES.edge('demo.edge.js', 'demo.edge.wasm'));

        expect(text).toContain("import boot from '../demo.edge.js';");
        expect(text).toContain("import wasm from '../demo.edge.wasm';");
        expect(text).toContain('return boot({ getWasmFunction: () => wasm, ...config }).then((m) => {');
    });
});

describe('writeRuntimeEntry', () => {
    function header(name, text, names) {
        const file = upath.join(work, 'include', name);
        fs.mkdirSync(upath.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
        const bridge = upath.join(work, 'bridge', `${name}.i.cpp`);
        fs.mkdirSync(upath.dirname(bridge), { recursive: true });
        if (names) fs.writeFileSync(`${bridge}.exports.json`, JSON.stringify(names));
        return { file, bridge };
    }

    const matrixHeader = 'class Matrix {\npublic:\n    Matrix(int size, double value);\n    double get(int i);\n};\n';
    const entryAt = (relative) => upath.join(work, 'dist', relative);
    const read = (relative) => fs.readFileSync(entryAt(relative), 'utf8');

    test('writes one module and its declarations for every header bound into the binary', () => {
        const headers = [
            header('Matrix.h', matrixHeader, ['Matrix']),
            header('zlib.h', '#define Z_OK 0\nint compressBound(int sourceLen);\n', ['compressBound', 'Z_OK']),
        ];

        writeRuntimeEntry(entryAt('node/napi.mjs'), headers, ENTRY_RUNTIMES.node('demo.native.cjs'));

        expect(read('node/napi.mjs')).toContain('export { $Matrix as Matrix, $compressBound as compressBound, $Z_OK as Z_OK };');
        expect(read('node/napi.d.mts')).toContain('export declare class Matrix {');
        expect(read('node/napi.d.mts')).toContain('    get(i: number): number;');
        expect(read('node/napi.d.mts')).toContain('export declare const compressBound: any;');
        expect(read('node/napi.d.mts')).toContain('export declare function initNative(config?: Record<string, unknown>): Promise<unknown>;');
    });

    test('declares a class two headers both bind once', () => {
        const headers = [header('a/Matrix.h', matrixHeader, ['Matrix']), header('b/Matrix.h', matrixHeader, ['Matrix'])];

        writeRuntimeEntry(entryAt('node/wasm.mjs'), headers, ENTRY_RUNTIMES.node('demo.node.js'));

        expect(read('node/wasm.d.mts').match(/export declare class Matrix/g)).toHaveLength(1);
    });

    test('exports a name under the alias its header gives it', () => {
        const headers = [header('iconv.h', '#define iconv_open libiconv_open\nvoid* iconv_open(const char* to, const char* from);\n', ['libiconv_open'])];

        writeRuntimeEntry(entryAt('node/napi.mjs'), headers, ENTRY_RUNTIMES.node('demo.native.cjs'));

        expect(read('node/napi.mjs')).toContain('$iconv_open = m.libiconv_open;');
    });

    test('fails for a header whose bridge left no export list', () => {
        const headers = [header('zlib.h', 'int compressBound(int sourceLen);\n', null)];

        expect(() => writeRuntimeEntry(entryAt('node/napi.mjs'), headers, ENTRY_RUNTIMES.node('demo.native.cjs')))
            .toThrow(/zlib\.h left no export list/);
    });
});
