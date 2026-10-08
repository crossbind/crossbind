import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: { get config() { return holder.config; } },
}));
vi.mock('../src/actions/createInterface.js', () => ({ default: vi.fn((header) => `${header}.bridge`) }));
vi.mock('../src/integration/getDependFilePath.js', () => ({ default: vi.fn() }));

const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');
const { default: bindHeaderImports } = await import('../src/integration/bindHeaderImports.js');

const target = { platform: 'android' };
let work;
let app;

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-header-imports-'))));
    fs.mkdirSync(`${work}/src/native`, { recursive: true });
    fs.writeFileSync(`${work}/src/native/native.h`, 'int one();\n');
    app = `${work}/src/App.tsx`;
    holder.config = { paths: { project: work }, ext: { header: ['h', 'hpp', 'hxx', 'hh'] } };
    createBridgeFile.mockClear();
    getDependFilePath.mockReset();
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

const boundHeaders = () => createBridgeFile.mock.calls.map(([header]) => header);

// Metro keeps a header's module as it first transformed it, so the source that imports the header binds it again.
describe('bindHeaderImports', () => {
    test('binds each header an app source imports once, for the target', () => {
        bindHeaderImports("import { one } from './native/native.h';\nimport { initNative } from './native/native.h';\n", app, target);

        expect(createBridgeFile.mock.calls).toEqual([[`${work}/src/native/native.h`, target]]);
    });

    test('finds a package header among the prebuilt headers of the target', () => {
        const prebuilt = `${work}/node_modules/@crossbind/port-zlib-android/dist/prebuilt/android/include/zlib.h`;
        fs.mkdirSync(upath.dirname(prebuilt), { recursive: true });
        fs.writeFileSync(prebuilt, 'unsigned long compressBound(unsigned long);\n');
        getDependFilePath.mockImplementation((specifier) => (specifier === '@crossbind/port-zlib/zlib.h' ? prebuilt : null));

        bindHeaderImports("import { compressBound } from '@crossbind/port-zlib/zlib.h';\n", app, target);

        expect(getDependFilePath).toHaveBeenCalledWith('@crossbind/port-zlib/zlib.h', target);
        expect(boundHeaders()).toEqual([prebuilt]);
    });

    test('resolves a header of a package that is no crossbind dependency as Node does', () => {
        fs.mkdirSync(`${work}/node_modules/plain/include`, { recursive: true });
        fs.writeFileSync(`${work}/node_modules/plain/include/plain.h`, 'int plain();\n');

        bindHeaderImports("import { plain } from 'plain/include/plain.h';\n", app, target);

        expect(boundHeaders()).toEqual([`${work}/node_modules/plain/include/plain.h`]);
    });

    test('skips a header that does not exist', () => {
        bindHeaderImports("import { gone } from './native/gone.h';\nimport { lost } from 'lost/lost.h';\n", app, target);

        expect(boundHeaders()).toEqual([]);
    });

    test('binds nothing for a file outside the app sources', () => {
        bindHeaderImports("import { one } from '../../src/native/native.h';\n", `${work}/node_modules/lib/index.js`, target);

        expect(boundHeaders()).toEqual([]);
    });
});
