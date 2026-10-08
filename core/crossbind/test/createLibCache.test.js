import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state, getData } = vi.hoisted(() => ({ run: vi.fn(), state: { config: {} }, getData: vi.fn() }));

vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/buildCargo.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/getCmakeParameters.js', () => ({ default: () => [] }));
vi.mock('../src/actions/getData.js', () => ({ default: getData }));
vi.mock('../src/actions/extensions.js', () => ({ default: () => {} }));
vi.mock('../src/utils/dependencyBridges.js', () => ({ withDependencyBridges: (glob) => glob }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: createLib } = await import('../src/actions/createLib.js');
const { default: buildCargo } = await import('../src/actions/buildCargo.js');

const target = {
    platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasm-wasm32-st-release',
};

describe('createLib cache', () => {
    let work;
    let bridge;
    let header;

    const build = (options = {}) => {
        run.mockClear();
        createLib(target, 'Bridge', { buildSource: false, nativeGlob: [bridge], ...options });
        // run is mocked, so stand in for `make install` creating the library directory.
        fs.mkdirSync(`${work}/build/Bridge-Release/prebuilt/${target.path}/lib`, { recursive: true });
        return run.mock.calls.length > 0;
    };

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-createlib-'));
        bridge = `${work}/bridge.i.cpp`;
        header = `${work}/val.h`;
        fs.writeFileSync(bridge, '// bridge');
        fs.writeFileSync(header, '// runtime v1');
        getData.mockReset();
        getData.mockReturnValue({});
        buildCargo.mockReset();
        state.config = {
            paths: { build: `${work}/build`, cmakeDir: `${work}/cmake` },
            build: {},
            export: {},
            allDependencyPaths: { [target.path]: {} },
        };
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('serves the built library while its sources are unchanged', () => {
        expect(build()).toBe(true);

        expect(build()).toBe(false);
    });

    test('builds an automatically loaded cargo dependency without CMake dependency paths', () => {
        state.config.export.type = 'cargo';
        delete state.config.allDependencyPaths;
        buildCargo.mockImplementation((_target, libdir) => {
            fs.mkdirSync(`${libdir}/lib`, { recursive: true });
            return true;
        });
        run.mockClear();

        expect(createLib(target, 'Source', { buildSource: true })).toBe(true);
        expect(buildCargo).toHaveBeenCalledOnce();
        expect(run).not.toHaveBeenCalled();
    });

    // A dependency's compile options (Lerc's LERC_STATIC on Windows) change how the same sources compile.
    test('rebuilds when the compile options the dependencies declare change', () => {
        build();
        getData.mockImplementation((kind) => (kind === 'cmake' ? { compileOptions: ['-DLERC_STATIC'] } : {}));

        expect(build()).toBe(true);
    });

    test('rebuilds when a header the sources compile against changes', () => {
        build({ inputs: [header] });
        fs.writeFileSync(header, '// runtime v2');

        expect(build({ inputs: [header] })).toBe(true);
    });

    test('CMake source patches stay in the target copy and a changed patch rebuilds', () => {
        fs.mkdirSync(state.config.paths.cmakeDir);
        const original = `${state.config.paths.cmakeDir}/codec.cpp`;
        fs.writeFileSync(original, 'allocate();');
        state.config.build.sourceReplaceList = () => [{ regex: 'allocate', replacement: 'zeroAllocate', paths: ['codec.cpp'] }];
        expect(build()).toBe(true);
        const copy = `${work}/build/Bridge-Release/${target.path}/crossbind-source`;
        expect(fs.readFileSync(`${copy}/codec.cpp`, 'utf8')).toBe('zeroAllocate();');
        expect(fs.readFileSync(original, 'utf8')).toBe('allocate();');
        expect(run.mock.calls[0][1].slice(0, 2)).toEqual(['cmake', copy]);
        expect(build()).toBe(false);

        state.config.build.sourceReplaceList = () => [{ regex: 'allocate', replacement: 'safeAllocate', paths: ['codec.cpp'] }];
        expect(build()).toBe(true);
        expect(fs.readFileSync(`${copy}/codec.cpp`, 'utf8')).toBe('safeAllocate();');
    });
});
