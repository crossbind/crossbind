import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({ state: { config: {}, targets: [] } }));
vi.mock('../src/state/index.js', () => ({ default: h.state, setAllDependecyPaths: vi.fn() }));
vi.mock('../src/utils/conanInstall.js', () => ({ default: vi.fn(async () => false) }));
vi.mock('../src/state/refreshConanDependencies.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));

const { default: prepareConanDependencies } = await import('../src/actions/prepareConanDependencies.js');
const { default: installConanPackages } = await import('../src/utils/conanInstall.js');
const { default: createXCFramework } = await import('../src/actions/createXCFramework.js');
const { nodeBridgeTarget } = await import('../src/utils/boundHeaders.js');

const target = (platform, arch, runtime, buildType = 'release') => ({
    platform, arch, runtime, buildType, path: `${platform}-${arch}-${runtime}-${buildType}`, releasePath: `${platform}-${arch}-${runtime}-release`,
});
const WASM32 = target('wasm', 'wasm32', 'st');
const WASM64 = target('wasm', 'wasm64', 'st');
const ANDROID = target('android', 'arm64-v8a', 'mt');
const IPHONE = target('ios', 'iphoneos', 'mt');
const SIMULATOR = target('ios', 'iphonesimulator', 'mt');
const IOS = [IPHONE, SIMULATOR, target('ios', 'iphoneos', 'mt', 'debug'), target('ios', 'iphonesimulator', 'mt', 'debug')];

const installed = () => installConanPackages.mock.calls[0][1].map((t) => t.path);
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const runningOn = (platform) => Object.defineProperty(process, 'platform', { ...hostPlatform, value: platform });

beforeEach(() => {
    h.state.config = { conanDependencies: { zlib: { version: '1.3.2', options: {} } }, allDependencies: [] };
    h.state.targets = [WASM32, WASM64, ANDROID];
    installConanPackages.mockClear();
    createXCFramework.mockClear();
    // iOS and macOS packages build on a Mac alone.
    runningOn('darwin');
});

afterEach(() => Object.defineProperty(process, 'platform', hostPlatform));

test('a build on another machine leaves the iOS and macOS targets out, as the rest of the build does', async () => {
    runningOn('linux');

    await prepareConanDependencies([target('linux', 'x64', 'mt'), target('darwin', 'arm64', 'mt'), IPHONE]);

    expect(installed()).toEqual(['linux-x64-mt-release']);
});

test('a wasm build also stages the first wasm target, which bridges read headers for', async () => {
    await prepareConanDependencies([WASM64]);

    expect(installed()).toEqual([WASM64.path, WASM32.path]);
});

test('an android build stages only its own targets, as release ones', async () => {
    await prepareConanDependencies([target('android', 'x86_64', 'mt', 'debug')]);

    expect(installed()).toEqual(['android-x86_64-mt-release']);
});

test('a Node addon build stages its own targets as release ones, the one its bridges read headers for among them', async () => {
    const targets = [target('linuxmusl', 'arm64', 'mt', 'debug'), target('linux', 'x64', 'mt', 'debug')];

    await prepareConanDependencies(targets);

    expect(installed()).toEqual(['linuxmusl-arm64-mt-release', 'linux-x64-mt-release']);
    expect(installed()).toContain(nodeBridgeTarget(targets).path);
});

test('a project without conanDependencies installs nothing', async () => {
    h.state.config = {};

    await prepareConanDependencies([WASM32]);

    expect(installConanPackages).not.toHaveBeenCalled();
});

test('an iOS build stages both SDKs, which one xcframework holds', async () => {
    h.state.targets = [WASM32, ...IOS];

    await prepareConanDependencies([target('ios', 'iphonesimulator', 'mt', 'debug')]);

    expect(installed()).toEqual([SIMULATOR.path, IPHONE.path]);
});

describe('the xcframeworks an iOS build links', () => {
    let scratch;
    const conanDependency = (name, libName) => {
        const project = path.join(scratch, name);
        return { general: { name: `conan-${name}`, conan: { name } }, export: { libName }, paths: { project, output: path.join(project, 'dist') } };
    };
    const archive = (dependency, t, lib) => path.join(dependency.paths.output, 'prebuilt', t.path, 'lib', `lib${lib}.a`);
    const plist = (dependency, lib) => path.join(dependency.paths.project, `${lib}.xcframework`, 'Info.plist');
    const touch = (file, seconds) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '');
        fs.utimesSync(file, seconds, seconds);
    };
    const stage = (dependency, seconds) => dependency.export.libName.forEach((lib) => [IPHONE, SIMULATOR].forEach((t) => touch(archive(dependency, t, lib), seconds)));

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-prepare-conan-'));
        h.state.targets = [WASM32, ...IOS];
    });

    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

    test('are made for a staged library that has none, with a slice for each SDK', async () => {
        const zlib = conanDependency('zlib', ['z']);
        h.state.config.allDependencies = [{ general: { name: 'matrix' }, export: { libName: ['matrix'] } }, zlib];
        stage(zlib, 1000);

        await prepareConanDependencies([IPHONE]);

        expect(createXCFramework).toHaveBeenCalledTimes(1);
        const [{ paths, export: exported, targetParams }] = createXCFramework.mock.calls[0];
        expect(paths).toEqual(zlib.paths);
        expect(exported.libName).toEqual(['z']);
        expect(targetParams).toEqual({
            platform: ['ios'], arch: expect.arrayContaining(['iphoneos', 'iphonesimulator']), runtime: ['mt'], buildType: ['release'],
        });
    });

    test('are made again once a library is staged after its xcframework', async () => {
        const fmt = conanDependency('fmt', ['fmt', 'fmt-c']);
        h.state.config.allDependencies = [fmt];
        stage(fmt, 1000);
        touch(plist(fmt, 'fmt'), 2000);
        touch(plist(fmt, 'fmt-c'), 500);

        await prepareConanDependencies([IPHONE]);

        expect(createXCFramework).toHaveBeenCalledTimes(1);
    });

    test('are left alone while each is newer than its archives', async () => {
        const fmt = conanDependency('fmt', ['fmt', 'fmt-c']);
        h.state.config.allDependencies = [fmt];
        stage(fmt, 1000);
        touch(plist(fmt, 'fmt'), 2000);
        touch(plist(fmt, 'fmt-c'), 1000);

        await prepareConanDependencies([IPHONE]);

        expect(createXCFramework).not.toHaveBeenCalled();
    });

    // A recipe can name a library on another platform only, as libpng is png16 on Windows.
    test('wrap only the libraries staged for every SDK', async () => {
        const png = conanDependency('libpng', ['png', 'png16']);
        h.state.config.allDependencies = [png];
        [IPHONE, SIMULATOR].forEach((t) => touch(archive(png, t, 'png'), 1000));
        touch(archive(png, IPHONE, 'png16'), 1000);

        await prepareConanDependencies([IPHONE]);

        expect(createXCFramework).toHaveBeenCalledTimes(1);
        expect(createXCFramework.mock.calls[0][0].export.libName).toEqual(['png']);
    });

    test('a build without iOS targets makes none', async () => {
        const zlib = conanDependency('zlib', ['z']);
        h.state.config.allDependencies = [zlib];
        stage(zlib, 1000);

        await prepareConanDependencies([WASM32]);

        expect(createXCFramework).not.toHaveBeenCalled();
    });
});
