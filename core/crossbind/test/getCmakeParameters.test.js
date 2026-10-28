import { beforeEach, describe, expect, test, vi } from 'vitest';

const { state, getData } = vi.hoisted(() => ({ state: { config: {} }, getData: vi.fn() }));

vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/getData.js', () => ({ default: getData }));

const { default: getCmakeParameters } = await import('../src/actions/getCmakeParameters.js');

const linux = {
    platform: 'linux', arch: 'x64', runtime: 'mt', buildType: 'release', runtimeEnv: 'node',
};
const wasm = {
    platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', runtimeEnv: 'browser',
};
const compileOptions = (target) => getCmakeParameters(target).find((param) => param.startsWith('-DCOMPILE_OPTIONS='));

describe('getCmakeParameters', () => {
    beforeEach(() => {
        getData.mockReset();
        getData.mockReturnValue({ compileOptions: ['-O2'] });
        state.config = {
            general: { name: 'demo' },
            target: { runtimeEnv: 'app' },
            paths: { cli: '/cli', project: '/project', build: '/build' },
            dependencyParameters: {
                headerPathWithDepends: '/headers',
                getCmakeDependsPathAndName: () => ({ pathsOfCmakeDepends: [], nameOfCmakeDepends: [] }),
            },
        };
    });

    test("defines CROSSBIND_APP in every flavour of an app's native archives", () => {
        expect(compileOptions(linux)).toBe('-DCOMPILE_OPTIONS=-O2;-DCROSSBIND_APP');
        expect(compileOptions({ ...linux, runtimeEnv: 'app' })).toBe('-DCOMPILE_OPTIONS=-O2;-DCROSSBIND_APP');
    });

    test("keeps an iOS app's debug information, for its dSYM", () => {
        expect(compileOptions({ ...linux, platform: 'ios', arch: 'iphoneos' })).toBe('-DCOMPILE_OPTIONS=-O2;-DCROSSBIND_APP;-g');
    });

    test("defines it neither in a library nor in an app's web build", () => {
        expect(compileOptions(wasm)).toBe('-DCOMPILE_OPTIONS=-O2');
        state.config.target = { runtimeEnv: 'browser' };

        expect(compileOptions({ ...linux, runtimeEnv: 'app' })).toBe('-DCOMPILE_OPTIONS=-O2');
    });
});
