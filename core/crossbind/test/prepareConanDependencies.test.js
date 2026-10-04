import {
    test, expect, vi, beforeEach,
} from 'vitest';

const h = vi.hoisted(() => ({ state: { config: {}, targets: [] } }));
vi.mock('../src/state/index.js', () => ({ default: h.state, setAllDependecyPaths: vi.fn() }));
vi.mock('../src/utils/conanInstall.js', () => ({ default: vi.fn(async () => false) }));
vi.mock('../src/state/refreshConanDependencies.js', () => ({ default: vi.fn() }));

const { default: prepareConanDependencies } = await import('../src/actions/prepareConanDependencies.js');
const { default: installConanPackages } = await import('../src/utils/conanInstall.js');

const target = (platform, arch, runtime, buildType = 'release') => ({
    platform, arch, runtime, buildType, path: `${platform}-${arch}-${runtime}-${buildType}`, releasePath: `${platform}-${arch}-${runtime}-release`,
});
const WASM32 = target('wasm', 'wasm32', 'st');
const WASM64 = target('wasm', 'wasm64', 'st');
const ANDROID = target('android', 'arm64-v8a', 'mt');

const installed = () => installConanPackages.mock.calls[0][1].map((t) => t.path);

beforeEach(() => {
    h.state.config = { conanDependencies: { zlib: { version: '1.3.2', options: {} } } };
    h.state.targets = [WASM32, WASM64, ANDROID];
    installConanPackages.mockClear();
});

test('a wasm build also stages the first wasm target, which bridges read headers for', async () => {
    await prepareConanDependencies([WASM64]);

    expect(installed()).toEqual([WASM64.path, WASM32.path]);
});

test('an android build stages only its own targets, as release ones', async () => {
    await prepareConanDependencies([target('android', 'x86_64', 'mt', 'debug')]);

    expect(installed()).toEqual(['android-x86_64-mt-release']);
});

test('a project without conanDependencies installs nothing', async () => {
    h.state.config = {};

    await prepareConanDependencies([WASM32]);

    expect(installConanPackages).not.toHaveBeenCalled();
});
