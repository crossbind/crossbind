import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state } = vi.hoisted(() => ({ run: vi.fn(), state: { config: {} } }));

vi.mock('replace', () => ({ default: vi.fn() }));
vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/getDependLibs.js', () => ({ default: () => [] }));
vi.mock('../src/actions/getData.js', () => ({ default: (kind) => (kind === 'binary' ? { emccFlags: ['-sCUSTOM_FLAG=1'] } : {}) }));
vi.mock('../src/actions/buildJs.js', () => ({ default: async () => {} }));
vi.mock('../src/actions/extensions.js', () => ({ default: () => {} }));
vi.mock('../src/utils/resolveEmbindRust.js', () => ({ default: () => '/embind-rust' }));
vi.mock('../src/utils/appRustCrates.js', () => ({ default: () => [] }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: buildWasm } = await import('../src/actions/buildWasm.js');

const ENVIRONMENTS = { browser: 'web,webview,worker', edge: 'web', node: 'node' };

function makeTarget(runtimeEnv) {
    return {
        runtimeEnv,
        buildType: 'release',
        platform: 'wasm',
        arch: 'wasm32',
        runtime: 'st',
        path: 'wasm-wasm32-st-release',
        jsName: `demo.${runtimeEnv}.js`,
        wasmName: `demo.${runtimeEnv}.wasm`,
        rawJsName: `demo.raw.${runtimeEnv}.js`,
        dataName: 'demo.data',
        dataTxtName: 'demo.data.txt',
    };
}

describe('buildWasm link step', () => {
    let work;

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-buildwasm-'));
        state.config = {
            export: {},
            general: { name: 'demo' },
            paths: { build: work, output: `${work}/out`, cli: `${work}/cli`, cache: `${work}/cache` },
            dependencyParameters: { getCmakeDepends: () => [] },
            cargoDependencies: {},
            excludedDependencies: [],
        };
        for (const env of Object.keys(ENVIRONMENTS)) fs.writeFileSync(`${work}/demo.raw.${env}.js`, '');
        run.mockReset();
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test.each(Object.entries(ENVIRONMENTS))('links the %s target with em++ and the emsdk-6 flag set', async (runtimeEnv, environment) => {
        const target = makeTarget(runtimeEnv);

        await buildWasm(target, { force: true });

        expect(run).toHaveBeenCalledTimes(1);
        const [program, args, prefix, calledTarget] = run.mock.calls[0];
        expect(program).toBe('em++');
        expect(prefix).toBeNull();
        expect(calledTarget).toBe(target);
        expect(args).toEqual(expect.arrayContaining(['-lembind', '-sCUSTOM_FLAG=1', '-msimd128', '-O3', '-fwasm-exceptions', '-sEXPORT_EXCEPTION_HANDLING_HELPERS']));
        expect(args[args.indexOf('MODULARIZE=1') - 1]).toBe('-s');
        expect(args[args.indexOf(`ENVIRONMENT=${environment}`) - 1]).toBe('-s');
        expect(args[args.indexOf('-o') + 1]).toBe(`${work}/${target.rawJsName}`);
        // emsdk 6 links with BigInt support by default; the old explicit flag must not come back.
        expect(args.some((arg) => String(arg).includes('WASM_BIGINT'))).toBe(false);
    });
});
