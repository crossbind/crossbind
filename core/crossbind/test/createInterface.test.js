import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The bridge depends on the header's declarations, but the interface text only names the header:
// a cache keyed on the interface alone kept stale bindings across header edits.
vi.mock('../src/actions/run.js', () => ({
    default: vi.fn(),
    cxxPreprocessorFor: () => 'em++',
}));

const holder = { config: {}, cache: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        get cache() { return holder.cache; },
        get targets() { return [{ platform: 'wasm', path: 'wasm-wasm32-st-release' }]; },
    },
    saveCache: vi.fn(),
}));

let work;
let header;

async function importFresh() {
    vi.resetModules();
    const { default: run } = await import('../src/actions/run.js');
    run.mockReset();
    run.mockImplementation((program, args) => {
        const out = args[args.indexOf('-o') + 1];
        fs.writeFileSync(out, program === 'swig' ? 'EMSCRIPTEN_BINDINGS(fixture) {}\n' : '');
        return '';
    });
    const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
    return { run, createBridgeFile };
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bridge-'));
    const native = path.join(work, 'src', 'native');
    fs.mkdirSync(native, { recursive: true });
    header = path.join(native, 'fixture.h');
    holder.config = {
        paths: { project: work, build: path.join(work, '.crossbind', 'build'), cache: path.join(work, '.crossbind'), header: [native] },
        ext: { header: ['h', 'hpp', 'hxx', 'hh'], module: ['i'] },
        dts: 'sync',
        export: {},
        allDependencies: [],
        dependencyParameters: { headerPathWithDepends: '', getCmakeDependsPathAndName: () => ({ pathsOfCmakeDepends: [] }) },
    };
    holder.cache = { interfaces: {}, hashes: {}, bridges: {} };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

const swigRuns = (run) => run.mock.calls.filter(([program]) => program === 'swig');

describe('createBridgeFile', () => {
    test('regenerates the bridge when the header changes but the interface text does not', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        createBridgeFile(header, target);
        expect(swigRuns(run)).toHaveLength(1);

        fs.writeFileSync(header, 'int one();\nint two();\n');
        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(2);
    });

    test('reuses the bridge while the header is unchanged', async () => {
        const { run, createBridgeFile } = await importFresh();
        const target = { platform: 'wasm', path: 'wasm-wasm32-st-release' };
        fs.writeFileSync(header, 'int one();\n');
        createBridgeFile(header, target);
        createBridgeFile(header, target);

        expect(swigRuns(run)).toHaveLength(1);
    });
});
