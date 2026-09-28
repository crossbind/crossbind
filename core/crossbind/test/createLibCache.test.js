import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state } = vi.hoisted(() => ({ run: vi.fn(), state: { config: {} } }));

vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/getCmakeParameters.js', () => ({ default: () => [] }));
vi.mock('../src/actions/getData.js', () => ({ default: () => ({}) }));
vi.mock('../src/actions/extensions.js', () => ({ default: () => {} }));
vi.mock('../src/utils/dependencyBridges.js', () => ({ withDependencyBridges: (glob) => glob }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: createLib } = await import('../src/actions/createLib.js');

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

    test('rebuilds when a header the sources compile against changes', () => {
        build({ inputs: [header] });
        fs.writeFileSync(header, '// runtime v2');

        expect(build({ inputs: [header] })).toBe(true);
    });
});
