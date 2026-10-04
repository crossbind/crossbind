import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import writeHeaderEntries from '../src/actions/writeHeaderEntries.js';

let work;
let outputDir;

function boundHeader(specifier, includePath, names) {
    const file = upath.join(work, 'include', includePath);
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, '#define Z_OK 0\nint compressBound(int sourceLen);\n');
    const bridge = upath.join(work, 'bridge', `${upath.basename(includePath)}.i.cpp`);
    fs.mkdirSync(upath.dirname(bridge), { recursive: true });
    fs.writeFileSync(`${bridge}.exports.json`, JSON.stringify(names));
    return { specifier, file, bridge };
}

const read = (relative) => fs.readFileSync(upath.join(outputDir, relative), 'utf8');

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-entries-')));
    outputDir = upath.join(work, 'dist');
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('writeHeaderEntries', () => {
    test('writes an entry module and its declarations at the header\'s include path', () => {
        writeHeaderEntries([boundHeader('@crossbind/port-zlib/zlib.h', 'zlib.h', ['compressBound', 'Z_OK'])], { outputDir, loaderName: 'demo.native.cjs' });

        expect(read('zlib.h.cjs')).toContain("const initNative = require('./demo.native.cjs');");
        expect(read('zlib.h.cjs')).toContain('exports.compressBound = Module.compressBound;');
        expect(read('zlib.h.d.cts')).toContain('export declare const compressBound: any;');
        expect(read('zlib.h.d.cts')).toContain('export declare const Z_OK: any;');
    });

    test('fails for a header whose bridge left no export list', () => {
        const header = boundHeader('@crossbind/port-zlib/zlib.h', 'zlib.h', []);
        fs.rmSync(`${header.bridge}.exports.json`);

        expect(() => writeHeaderEntries([header], { outputDir, loaderName: 'demo.native.cjs' })).toThrow(/@crossbind\/port-zlib\/zlib\.h/);
    });

    test('reaches the loader from a header in a subdirectory', () => {
        writeHeaderEntries([boundHeader('@crossbind/port-curl/curl/curl.h', 'curl/curl.h', ['curl_version'])], { outputDir, loaderName: 'demo.native.cjs' });

        expect(read('curl/curl.h.cjs')).toContain("const initNative = require('../demo.native.cjs');");
    });
});
