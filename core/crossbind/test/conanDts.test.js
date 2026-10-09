import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { writeConanImportDts, writeHeaderDts } from '../src/utils/cppDts.js';

let project;
const cacheDir = () => upath.join(project, '.crossbind');
const stagedHeader = () => upath.join(cacheDir(), 'conan', 'packages', 'zlib', 'dist', 'prebuilt', 'wasm-wasm32-st-release', 'include', 'zlib.h');

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-dts-')));
    fs.mkdirSync(path.dirname(stagedHeader()), { recursive: true });
    fs.writeFileSync(stagedHeader(), 'const char* zlibVersion(void);\nunsigned long compressBound(unsigned long sourceLen);\n');
    fs.writeFileSync(upath.join(project, 'zlib.i.cpp.exports.json'), JSON.stringify(['zlibVersion', 'compressBound']));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

const writeOptions = () => ({
    headerFile: stagedHeader(), exportsFile: upath.join(project, 'zlib.i.cpp.exports.json'), projectPath: project, cacheDir: cacheDir(),
});

describe('editor types of a conan: import', () => {
    test('an ambient module named after the import declares what the bridge exports', () => {
        writeConanImportDts(writeOptions());

        const dts = fs.readFileSync(upath.join(cacheDir(), 'conan', 'types', 'zlib', 'zlib.h.d.ts'), 'utf8');
        expect(dts.startsWith("declare module 'conan:zlib/zlib.h' {\n")).toBe(true);
        expect(dts).toContain('    export const zlibVersion: any;');
        expect(dts).toContain('    export function initNative(');
        // `declare` is an error inside an ambient module (TS1038).
        expect(dts).not.toMatch(/\bdeclare (?!module)/);
    });

    test('the project mirror leaves a staged Conan header to its ambient module', () => {
        writeHeaderDts(writeOptions());

        expect(fs.existsSync(upath.join(cacheDir(), 'types'))).toBe(false);
    });

    test('offers unimported functions from the full declaration catalog', () => {
        const declarationsFile = upath.join(project, 'zlib.declarations.json');
        fs.writeFileSync(writeOptions().exportsFile, JSON.stringify(['zlibVersion']));
        fs.writeFileSync(declarationsFile, JSON.stringify(['zlibVersion', 'compressBound']));

        writeConanImportDts({ ...writeOptions(), declarationsFile });

        const dts = fs.readFileSync(upath.join(cacheDir(), 'conan/types/zlib/zlib.h.d.ts'), 'utf8');
        expect(dts).toContain('export const compressBound: any;');
    });

    test('also declares what the bridge binds beyond the whole header, a variadic function the app imports', () => {
        const declarationsFile = upath.join(project, 'zlib.declarations.json');
        fs.writeFileSync(writeOptions().exportsFile, JSON.stringify(['zlibVersion', 'gzprintf', 'vaDouble']));
        fs.writeFileSync(declarationsFile, JSON.stringify(['zlibVersion', 'compressBound']));

        writeConanImportDts({ ...writeOptions(), declarationsFile });

        const dts = fs.readFileSync(upath.join(cacheDir(), 'conan/types/zlib/zlib.h.d.ts'), 'utf8');
        expect(dts).toContain('export const compressBound: any;');
        expect(dts).toContain('export const gzprintf: any;');
        expect(dts).toContain('export const vaDouble: any;');
    });

    test('a header that is not staged by Conan gets no ambient module', () => {
        const header = upath.join(project, 'src', 'native', 'zlib.h');
        fs.mkdirSync(path.dirname(header), { recursive: true });
        fs.copyFileSync(stagedHeader(), header);

        writeConanImportDts({ ...writeOptions(), headerFile: header });

        expect(fs.existsSync(upath.join(cacheDir(), 'conan', 'types'))).toBe(false);
    });
});
