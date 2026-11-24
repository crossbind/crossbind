import { beforeEach, describe, expect, test, vi } from 'vitest';

// The Rollup plugin of a desktop app's build for two arches, on crossbind's integration api with the steps under it
// stood in for: when it checks, publishes and ships each arch's app.
const steps = [];
const targets = ['x64', 'arm64'].map((arch) => ({ platform: 'linux', arch, buildType: 'release', runtimeEnv: 'app' }));
// The arch whose app could not be installed, as an installer's check says.
const refused = { arch: null };
vi.mock('../src/state/index.js', () => ({
    default: {
        config: {
            target: { runtimeEnv: 'app' },
            ext: { header: ['h'], module: ['i'], source: ['cpp'] },
            paths: { project: '/project', native: [], build: '/project/.crossbind/build', cache: '/project/.crossbind/cache' },
        },
        targets,
    },
}));
vi.mock('../src/utils/appBuild.js', () => ({ default: () => true }));
vi.mock('../src/utils/appSources.js', () => ({ default: () => [], isAppSource: () => false }));
vi.mock('../src/actions/target.js', () => ({ getTargetParams: () => ({}), getFilteredBuildTargets: () => targets }));
vi.mock('../src/actions/buildApp.js', () => ({
    appTargetParams: () => ({}),
    appOutputName: (target) => `demo-linux-${target.arch}`,
    appPlatform: () => 'linux',
    appLayout: vi.fn(),
    buildProjectApp: vi.fn(),
    emptyAppOutDir: vi.fn(),
    publishApp: (target, { to }) => {
        steps.push(`publish ${target.arch}`);
        return to;
    },
}));
vi.mock('../src/actions/appInstaller.js', () => ({
    checkInstaller: async (target) => {
        steps.push(`check ${target.arch}`);
        if (target.arch === refused.arch) throw new Error(`crossbind: no installer can make the ${target.arch} app.`);
    },
    shipApp: async (target, to) => {
        steps.push(`ship ${target.arch} ${to}`);
    },
}));
vi.mock('../src/actions/buildDependencies.js', () => ({
    default: async () => {
        steps.push('dependencies');
    },
}));
vi.mock('../src/actions/createInterface.js', () => ({ default: vi.fn() }));
vi.mock('../src/integration/getCrossbindScript.js', () => ({ default: vi.fn(), getRustJsScript: vi.fn() }));
vi.mock('crossbind', async () => ({ integrationApi: (await import('../src/integration/api.js')).default }));

const { default: rollupCrossbindPlugin } = await import('../../../plugins/rollup/index.js');

beforeEach(() => {
    steps.length = 0;
    refused.arch = null;
});

describe("the Rollup plugin of a desktop app's build", () => {
    test('checks what each app ships with before the dependencies build', async () => {
        const plugin = rollupCrossbindPlugin();
        plugin.configResolved({ base: '/', command: 'build' });
        await plugin.buildStart.call({ addWatchFile: () => {} });
        expect(steps).toEqual(['check x64', 'check arm64', 'dependencies']);
    });

    test('stops the build on a check that fails, before the dependencies build', async () => {
        refused.arch = 'x64';
        const plugin = rollupCrossbindPlugin();
        plugin.configResolved({ base: '/', command: 'build' });
        await expect(plugin.buildStart.call({ addWatchFile: () => {} })).rejects.toThrow('crossbind: no installer can make the x64 app.');
        expect(steps).toEqual(['check x64']);
    });

    // A dependency's header lies under the include root of the target that builds it: bound for wasm, which the app does
    // not build, it was included by its file name alone.
    test("binds a header the page imports for the app's target", async () => {
        const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
        const plugin = rollupCrossbindPlugin();
        plugin.configResolved({ base: '/', command: 'build' });

        await plugin.transform.call({ addWatchFile: () => {} }, '', '/project/node_modules/lib/Lib.h');

        expect(createBridgeFile).toHaveBeenCalledWith('/project/node_modules/lib/Lib.h', targets[0]);
    });

    test("puts the page into every arch's app before any installer writes beside them, where a later app's page would take their files in", async () => {
        await rollupCrossbindPlugin().writeBundle({ dir: '/project/dist' });
        expect(steps).toEqual(['publish x64', 'publish arm64', 'ship x64 /project/dist/demo-linux-x64', 'ship arm64 /project/dist/demo-linux-arm64']);
    });
});
