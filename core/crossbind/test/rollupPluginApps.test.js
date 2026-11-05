import { beforeEach, describe, expect, test, vi } from 'vitest';

// The Rollup plugin of a desktop app's build for two arches, with crossbind stood in for: when it checks, publishes and
// ships each arch's app.
const steps = [];
const targets = ['x64', 'arm64'].map((arch) => ({ platform: 'linux', arch, buildType: 'release', runtimeEnv: 'app' }));
// The arch whose app could not be installed, as an installer's check says.
const refused = { arch: null };
vi.mock('crossbind', () => ({
    state: { config: { target: { runtimeEnv: 'app' }, ext: { header: ['h'], module: ['i'] }, paths: { project: '/project', native: [] } } },
    appTargetParams: () => ({}),
    getTargetParams: () => ({}),
    getFilteredBuildTargets: () => targets,
    appOutputName: (target) => `demo-linux-${target.arch}`,
    checkInstaller: async (target) => {
        steps.push(`check ${target.arch}`);
        if (target.arch === refused.arch) throw new Error(`crossbind: no installer can make the ${target.arch} app.`);
    },
    buildDependencies: async () => {
        steps.push('dependencies');
    },
    publishApp: (target, { to }) => {
        steps.push(`publish ${target.arch}`);
        return to;
    },
    shipApp: async (target, to) => {
        steps.push(`ship ${target.arch} ${to}`);
    },
    createLib: vi.fn(),
    buildWasm: vi.fn(),
    createBridgeFile: vi.fn(),
    getCrossbindScript: vi.fn(),
    getRustJsScript: vi.fn(),
    getDependFilePath: vi.fn(),
    isSourceNewer: vi.fn(),
    appSourceFiles: () => [],
    buildProjectApp: vi.fn(),
}));

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

    test("puts the page into every arch's app before any installer writes beside them, where a later app's page would take their files in", async () => {
        await rollupCrossbindPlugin().writeBundle({ dir: '/project/dist' });
        expect(steps).toEqual(['publish x64', 'publish arm64', 'ship x64 /project/dist/demo-linux-x64', 'ship arm64 /project/dist/demo-linux-arm64']);
    });
});
