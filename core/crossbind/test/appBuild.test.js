import {
    afterEach, describe, expect, test, vi,
} from 'vitest';

const { state } = vi.hoisted(() => ({ state: { config: { target: {} } } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: isAppBuild } = await import('../src/utils/appBuild.js');
const { compilesAsApp } = await import('../src/utils/appApiHeader.js');

const inProject = (runtimeEnv) => {
    state.config.target = runtimeEnv ? { runtimeEnv } : {};
};

afterEach(() => vi.unstubAllEnvs());

describe('a run that builds an app', () => {
    test('is one that crossbind app starts, or that names the platform of an app', () => {
        inProject();

        expect(isAppBuild({ CROSSBIND_APP_BUILD: '1' })).toBe(true);
        expect(isAppBuild({ CROSSBIND_APP_PLATFORM: 'ios' })).toBe(true);
    });

    test('is any run of a project that is an app alone', () => {
        inProject('app');

        expect(isAppBuild({})).toBe(true);
    });

    test('is no run of a bundler that nothing says builds an app, which builds for the browser', () => {
        inProject();
        expect(isAppBuild({})).toBe(false);

        inProject('browser');
        expect(isAppBuild({})).toBe(false);
    });
});

describe("a project's own native code", () => {
    test('compiles as an app in a run that builds one, on the platforms an app runs on alone', () => {
        inProject();
        vi.stubEnv('CROSSBIND_APP_BUILD', '1');

        expect(compilesAsApp({ platform: 'darwin' })).toBe(true);
        expect(compilesAsApp({ platform: 'wasm' })).toBe(false);
    });

    test('compiles for the browser in a run that builds no app', () => {
        inProject();
        vi.stubEnv('CROSSBIND_APP_BUILD', '');
        vi.stubEnv('CROSSBIND_APP_PLATFORM', '');

        expect(compilesAsApp({ platform: 'darwin' })).toBe(false);
    });
});
