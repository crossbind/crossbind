import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';

const { state, createBridgeFile, getRustSymbols, getDependFilePath } = vi.hoisted(() => ({
    state: { config: {} },
    createBridgeFile: vi.fn(),
    getRustSymbols: vi.fn(),
    getDependFilePath: vi.fn(),
}));

vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/createInterface.js', () => ({ default: createBridgeFile }));
vi.mock('../src/integration/getCrossbindScript.js', () => ({ getRustSymbols }));
vi.mock('../src/integration/getDependFilePath.js', () => ({ default: getDependFilePath }));

const { findAppNativeImports, createImportedBridges } = await import('../src/actions/createImportedBridges.js');

const TARGET = { platform: 'linux', path: 'linux-x64-mt-release' };
// What getDependFilePath does with a crate the config does not declare.
const undeclared = (source) => {
    if (source.startsWith('cargo:')) throw new Error(`crossbind: '${source}' is not declared - add 'uuid' to cargoDependencies in crossbind.config.`);
    return null;
};

let work;

function write(file, text = '') {
    const full = upath.join(work, file);
    fs.mkdirSync(upath.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
}

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-imported-'))));
    state.config = { paths: { project: work }, ext: { header: ['h'], module: ['i'] } };
    createBridgeFile.mockReset().mockImplementation((file) => `${file}.i.cpp`);
    getRustSymbols.mockReset().mockReturnValue(['Counter']);
    getDependFilePath.mockReset().mockImplementation(undeclared);
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('findAppNativeImports', () => {
    test('finds a relative import by its real path, with no specifier for the hooks to map', () => {
        const header = write('src/native/native.h');
        write('src/app.mjs', "import { Native } from './native/native.h';\n");
        write('src/worker.cjs', "const native = require('./native/native.h');\n");

        expect([...findAppNativeImports([TARGET]).values()]).toEqual([{ file: header, target: TARGET, specifiers: [] }]);
    });

    test('keeps each bare specifier once, from any source the app writes in', () => {
        const header = write('pkg/x.h');
        getDependFilePath.mockImplementation((source) => (source === '@demo/pkg/x.h' ? header : null));
        write('src/a.mts', "import { X } from '@demo/pkg/x.h';\n");
        write('src/b.cts', "export { X } from '@demo/pkg/x.h';\n");

        expect([...findAppNativeImports([TARGET]).values()]).toEqual([{ file: header, target: TARGET, specifiers: ['@demo/pkg/x.h'] }]);
    });

    test('fails the build for a cargo: import the config does not declare, with what to declare', () => {
        write('src/app.mjs', "import { Uuid } from 'cargo:uuid';\n");

        expect(() => findAppNativeImports([TARGET])).toThrow(/add 'uuid' to cargoDependencies/);
    });

    test('warns about a header no dependency ships and goes on', () => {
        write('src/app.mjs', "import { X } from '@missing/pkg/x.h';\n");
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(findAppNativeImports([TARGET]).size).toBe(0);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('imports @missing/pkg/x.h, which no dependency ships'));
        warn.mockRestore();
    });
});

describe('createImportedBridges', () => {
    test('binds what no bridge covers: a header through a bridge of its own, a Rust file by its names', () => {
        const bound = write('src/native/native.h');
        const other = write('src/native/other.h');
        const counter = write('src/native/counter.rs');
        const imports = new Map([bound, other, counter].map((file) => [file, { file, target: TARGET, specifiers: [] }]));

        const bridges = createImportedBridges([{ file: bound, bridge: `${bound}.i.cpp` }], imports);

        expect(bridges).toEqual([{ file: other, bridge: `${other}.i.cpp` }, { file: counter, names: ['Counter'] }]);
        expect(createBridgeFile).toHaveBeenCalledWith(other, TARGET);
    });
});
