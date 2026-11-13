import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state, getData, getCmakeParameters, resolveAppHostRoot } = vi.hoisted(() => ({
    run: vi.fn(), state: { config: {} }, getData: vi.fn(), getCmakeParameters: vi.fn(() => []), resolveAppHostRoot: vi.fn(),
}));

vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/buildCargo.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/getCmakeParameters.js', () => ({ default: getCmakeParameters }));
vi.mock('../src/actions/getData.js', () => ({ default: getData }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/utils/resolveAppHost.js', () => ({ default: resolveAppHostRoot }));

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

    // A header edit can leave SWIG's output as it was (gdal3.js changed a parameter's type): the bridge is made again,
    // with another key, and the objects compiled from the old header are stale.
    test('rebuilds when a bridge is made again from a changed header, though its text is the same', () => {
        fs.writeFileSync(`${bridge}.key`, 'header v1');
        expect(build()).toBe(true);
        expect(build()).toBe(false);
        fs.writeFileSync(`${bridge}.key`, 'header v2');

        expect(build()).toBe(true);
    });

    test('rebuilds when a bridge the listed one depends on is made again from a changed header', () => {
        const dependency = `${work}/types.i.cpp`;
        fs.writeFileSync(dependency, '// dependency bridge');
        fs.writeFileSync(`${bridge}.deps`, `${dependency}\n`);
        fs.writeFileSync(`${dependency}.key`, 'header v1');
        build();
        fs.writeFileSync(`${dependency}.key`, 'header v2');

        expect(build()).toBe(true);
    });

    // An older crossbind, or a cache CI restores, leaves its bridges without keys.
    test('serves the library built from bridges without keys until one is made again', () => {
        expect(build()).toBe(true);
        expect(build()).toBe(false);
        fs.writeFileSync(`${bridge}.key`, 'header v2');

        expect(build()).toBe(true);
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

describe('createLib wasi source', () => {
    const wasi = {
        platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasi-wasm32-st-release',
    };
    let work;
    let header;

    const build = () => {
        run.mockClear();
        createLib(wasi, 'Source', { buildSource: true });
        fs.mkdirSync(`${work}/build/Source-Release/prebuilt/${wasi.path}/lib`, { recursive: true });
        return run.mock.calls.length > 0;
    };

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-createlib-wasi-'));
        const runtime = `${work}/cli/assets/wasi-runtime`;
        header = `${runtime}/http/include/crossbind/http.h`;
        fs.mkdirSync(path.dirname(header), { recursive: true });
        fs.writeFileSync(header, '// api v1');
        fs.writeFileSync(`${runtime}/stubs.c`, '');
        getData.mockReset();
        getData.mockReturnValue({});
        state.config = {
            paths: {
                build: `${work}/build`, cmakeDir: `${work}/cmake`, cli: `${work}/cli`, native: [],
            },
            build: {},
            export: {},
            allDependencyPaths: { [wasi.path]: {} },
        };
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('compiles the app against a staged <crossbind/http.h>', () => {
        build();
        const { headerDirs } = getCmakeParameters.mock.calls.at(-1)[1];
        expect(headerDirs).toEqual([`${work}/build/Source-Release/${wasi.path}/crossbind-wasi-http/include`]);
        expect(fs.readFileSync(`${headerDirs[0]}/crossbind/http.h`, 'utf8')).toBe('// api v1');
    });

    test('rebuilds when crossbind brings a new <crossbind/http.h>', () => {
        expect(build()).toBe(true);
        expect(build()).toBe(false);
        fs.writeFileSync(header, '// api v2');

        expect(build()).toBe(true);
    });
});

describe('createLib app source', () => {
    const linux = {
        platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'release', path: 'linux-x64-mt-release',
    };
    let work;
    let header;

    const build = (target) => {
        run.mockClear();
        getCmakeParameters.mockClear();
        createLib(target, 'Source', { buildSource: true });
        fs.mkdirSync(`${work}/build/Source-Release/prebuilt/${target.path}/lib`, { recursive: true });
        return run.mock.calls.length > 0;
    };
    const headerDirs = () => getCmakeParameters.mock.calls.at(-1)[1].headerDirs;

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-createlib-app-'));
        header = `${work}/app-host/cpp/include/crossbind/app.h`;
        fs.mkdirSync(path.dirname(header), { recursive: true });
        fs.writeFileSync(header, '// api v1');
        resolveAppHostRoot.mockReset();
        resolveAppHostRoot.mockReturnValue(`${work}/app-host`);
        getData.mockReset();
        getData.mockReturnValue({});
        state.config = {
            paths: {
                build: `${work}/build`, cmakeDir: `${work}/cmake`, cli: `${work}/cli`, native: [],
            },
            build: {},
            export: {},
            target: { runtimeEnv: 'app' },
            allDependencyPaths: { [linux.path]: {}, 'wasm-wasm32-st-release': {} },
        };
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test("a library's app-flavoured archives need no app host", () => {
        state.config.target = { runtimeEnv: 'browser' };
        resolveAppHostRoot.mockImplementation(() => {
            throw new Error('crossbind: apps need @crossbind/core-app-host - add it to your devDependencies.');
        });

        expect(build({ ...linux, runtimeEnv: 'app' })).toBe(true);
        expect(headerDirs()).toEqual([]);
    });

    test("an app's code compiles against a staged <crossbind/app.h> in every flavour of an app platform", () => {
        expect(build({ ...linux, runtimeEnv: 'node' })).toBe(true);
        expect(headerDirs()).toEqual([`${work}/build/Source-Release/${linux.path}/crossbind-app/include`]);
        expect(fs.readFileSync(`${headerDirs()[0]}/crossbind/app.h`, 'utf8')).toBe('// api v1');

        // The flavours share one build, so the next one finds it built.
        expect(build({ ...linux, runtimeEnv: 'app' })).toBe(false);
    });

    test("an app's web build gets no <crossbind/app.h>", () => {
        build({
            platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasm-wasm32-st-release', runtimeEnv: 'browser',
        });

        expect(headerDirs()).toEqual([]);
    });

    test('rebuilds when the app host brings a new <crossbind/app.h>', () => {
        const app = { ...linux, runtimeEnv: 'app' };
        expect(build(app)).toBe(true);
        expect(build(app)).toBe(false);
        fs.writeFileSync(header, '// api v2');

        expect(build(app)).toBe(true);
    });
});
