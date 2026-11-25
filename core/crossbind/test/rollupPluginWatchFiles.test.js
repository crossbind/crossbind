import { describe, expect, test, vi } from 'vitest';

// The Rollup plugin's header transform, on crossbind's integration api with the steps under it stood in for: which files
// it asks the bundler to watch with the header. Vite takes those for imports of the header.
const pageApi = vi.hoisted(() => ({ file: null }));
vi.mock('../src/state/index.js', () => ({
    default: {
        config: {
            target: {},
            ext: { header: ['h'], module: ['i'], source: ['cpp'] },
            paths: { project: '/project', native: [], build: '/project/.crossbind/build', cache: '/project/.crossbind/cache' },
        },
        targets: [],
    },
}));
vi.mock('../src/utils/appBuild.js', () => ({ default: () => false }));
vi.mock('../src/utils/resolveAppHost.js', () => ({ findAppPageApi: () => pageApi.file, resolveAppPageApi: vi.fn() }));
vi.mock('../src/utils/appSources.js', () => ({ default: () => ['/project/src/main.js'], isAppSource: () => false }));
vi.mock('../src/actions/target.js', () => ({ getTargetParams: () => ({}), getFilteredBuildTargets: () => [{ buildType: 'release' }] }));
vi.mock('../src/actions/createInterface.js', () => ({ default: () => '/project/.crossbind/build/bridge/native.i.cpp' }));
vi.mock('../src/integration/getCrossbindScript.js', () => ({ default: () => 'export {};', getRustJsScript: vi.fn() }));
vi.mock('../src/integration/getDependFilePath.js', () => ({ default: vi.fn() }));

const { default: rollupPlugin } = await import('../../../extensions/rollup/src/plugin.js');
const { default: apiHandle } = await import('../src/integration/apiHandle.js');
const rollupCrossbindPlugin = () => rollupPlugin(apiHandle('rollup'));

async function watchedWithHeader(command) {
    const plugin = rollupCrossbindPlugin();
    if (command) plugin.configResolved({ base: '/', command });
    const watched = [];
    await plugin.transform.call({ addWatchFile: (file) => watched.push(file) }, '', '/project/src/native/native.h');
    return watched;
}

describe('the Rollup plugin', () => {
    test('has a watching build transform a header again after an edit to any source, whose imports decide what it binds', async () => {
        expect(await watchedWithHeader(null)).toEqual(['/project/src/main.js']);
        expect(await watchedWithHeader('build')).toEqual(['/project/src/main.js']);
    });

    test("leaves the sources out of a header's imports on Vite's dev server, so an edit to the page still reaches it", async () => {
        expect(await watchedWithHeader('serve')).toEqual([]);
    });

    test("takes a web build's crossbind/app from the app host, where the project has one", async () => {
        pageApi.file = '/project/node_modules/@crossbind/core-app-host/js/app.js';
        expect(await rollupCrossbindPlugin().resolveId('crossbind/app')).toBe(pageApi.file);

        pageApi.file = null;
        expect(await rollupCrossbindPlugin().resolveId('crossbind/app')).toBeNull();
    });
});
