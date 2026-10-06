import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const {
    run, state, rollup, getData,
} = vi.hoisted(() => ({
    run: vi.fn(),
    state: { config: {}, targets: [] },
    rollup: vi.fn(),
    getData: vi.fn(),
}));

vi.mock('rollup', () => ({ rollup }));
vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/getDependLibs.js', () => ({ default: () => ['/deps/libproj.a'] }));
vi.mock('../src/actions/getData.js', () => ({ default: getData }));
vi.mock('../src/utils/resolveEmbindNapi.js', () => ({
    default: () => '/napi',
    resolveEmbindJsiRoot: () => '/jsi',
}));
vi.mock('../src/utils/resolveEmbindRust.js', () => ({ default: () => '/embind-rust' }));
vi.mock('../src/utils/appRustCrates.js', () => ({ default: () => [] }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const {
    default: buildNode, addonsInPackages, bundleNodeLoader, nodeLoaderConfig, publishNodeData,
} = await import('../src/actions/buildNode.js');

const target = {
    platform: 'darwin',
    arch: 'arm64',
    runtime: 'mt',
    buildType: 'release',
    runtimeEnv: 'node',
    path: 'darwin-arm64-mt-release',
    addonPattern: 'demo.{platform}-{arch}.node',
    addonName: 'demo.darwin-arm64.node',
    jsName: 'demo.native.cjs',
};

const cmakeCalls = () => run.mock.calls.map(([, args]) => args);
const defineOf = (args, key) => args.find((arg) => String(arg).startsWith(`-D${key}=`))?.slice(key.length + 3);

describe('buildNode', () => {
    const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    let work;
    let written;

    beforeEach(() => {
        // A macOS addon links on a macOS host only; these tests describe that link on any host.
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-buildnode-'));
        state.config = {
            export: {},
            general: { name: 'demo' },
            paths: { build: work, output: `${work}/out` },
            dependencyParameters: { getCmakeDepends: () => [] },
        };
        state.targets = [target];
        getData.mockReset();
        getData.mockReturnValue({});
        written = [];
        run.mockReset();
        run.mockImplementation((program, args, prefix, calledTarget) => {
            if (args[1] === '--build') {
                const dir = `${work}/${prefix}/${calledTarget.path}`;
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(`${dir}/${calledTarget.addonName}`, 'addon');
            }
        });
        rollup.mockReset();
        rollup.mockImplementation(async (options) => ({
            write: async (output) => {
                written.push({ options, output });
                fs.writeFileSync(output.file, 'loader');
            },
            close: async () => {},
        }));
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', hostPlatform);
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('leaves a macOS addon to a macOS host', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });

        expect(await buildNode(target, { force: true })).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test('configures the addon project with the bridge force-loaded, then builds it', async () => {
        const built = await buildNode(target, { force: true });

        expect(built).toBe(true);
        const [configure, compile] = cmakeCalls();
        expect(configure.slice(0, 2)).toEqual(['cmake', '/napi/cpp']);
        expect(defineOf(configure, 'CMAKE_BUILD_TYPE')).toBe('Release');
        expect(defineOf(configure, 'CROSSBIND_ADDON_FILE')).toBe('demo.darwin-arm64.node');
        expect(defineOf(configure, 'CROSSBIND_JSI_ROOT')).toBe('/jsi');
        expect(defineOf(configure, 'CROSSBIND_LINK_ARGS')).toBe([
            '/deps/libproj.a',
            `${work}/Source-Release/darwin-arm64-mt-release/libdemo.a`,
            `-Wl,-force_load,${work}/Bridge-Release/darwin-arm64-mt-release/libdemo.a`,
        ].join(';'));
        expect(defineOf(configure, 'CROSSBIND_EXTRA_SOURCES')).toBe('');
        expect(compile.slice(0, 3)).toEqual(['cmake', '--build', '.']);
        expect(run.mock.calls.every(([program, , prefix, calledTarget]) => (
            program === null && prefix === 'Node-Release' && calledTarget === target))).toBe(true);
        expect(fs.readFileSync(`${work}/demo.darwin-arm64.node`, 'utf8')).toBe('addon');
    });

    test('compiles the addon in turn with other builds, configuring it freely', async () => {
        await buildNode(target, { force: true });

        const optionsOf = (isStep) => run.mock.calls.find(([, args]) => isStep(args))?.[4];
        expect(optionsOf((args) => args[1] === '--build')).toEqual({ exclusive: true });
        expect(optionsOf((args) => args[1] !== '--build')).toBeUndefined();
    });

    test('makes the addon link depend on every archive, force-loaded ones included', async () => {
        await buildNode(target, { force: true });

        const [configure] = cmakeCalls();
        expect(defineOf(configure, 'CROSSBIND_LINK_DEPENDS').split(';')).toEqual([
            '/deps/libproj.a',
            `${work}/Source-Release/darwin-arm64-mt-release/libdemo.a`,
            `${work}/Bridge-Release/darwin-arm64-mt-release/libdemo.a`,
        ]);
    });

    test('links Rust packages through the JSI adapter with their keep symbols pinned', async () => {
        state.config.dependencyParameters = {
            getCmakeDepends: () => [{ export: { type: 'cargo', libName: ['demo_rs'] }, paths: { project: work } }],
        };

        await buildNode(target, { force: true });

        const [configure] = cmakeCalls();
        expect(defineOf(configure, 'CROSSBIND_EXTRA_SOURCES')).toBe('/embind-rust/adapters/jsi.cpp');
        expect(defineOf(configure, 'CROSSBIND_LINK_ARGS').split(';')).toContain('-Wl,-u,_crossbind_keep_demo_rs');
    });

    test('links a linux addon with whole-archive groups and unprefixed keep symbols', async () => {
        const linux = {
            ...target, platform: 'linux', arch: 'x64', path: 'linux-x64-mt-release', addonName: 'demo.linux-x64.node',
        };
        state.targets = [linux];
        state.config.dependencyParameters = {
            getCmakeDepends: () => [{ export: { type: 'cargo', libName: ['demo_rs'] }, paths: { project: work } }],
        };

        await buildNode(linux, { force: true });

        const linkArgs = defineOf(cmakeCalls()[0], 'CROSSBIND_LINK_ARGS').split(';');
        expect(linkArgs).toContain('-Wl,--whole-archive');
        expect(linkArgs).toContain('-Wl,-u,crossbind_keep_demo_rs');
        expect(linkArgs.some((arg) => arg.includes('force_load'))).toBe(false);
    });

    test('keeps the runtime notices a Windows addon takes from its toolchain image', async () => {
        const win32 = {
            ...target, platform: 'win32', arch: 'x64', path: 'win32-x64-mt-release', addonName: 'demo.win32-x64.node',
        };
        state.targets = [win32];

        await buildNode(win32, { force: true });

        const copy = run.mock.calls.find(([, args]) => args.join(' ').includes('/opt/licenses/llvm-mingw'));
        expect(copy[1].join(' ')).toContain('toolchain-licenses/win32');
        expect(copy[2]).toBeNull();
        expect(copy[3]).toBe(win32);
    });

    test('copies no toolchain notices for a Linux addon, whose LLVM runtime needs none', async () => {
        const linux = {
            ...target, platform: 'linux', arch: 'x64', path: 'linux-x64-mt-release', addonName: 'demo.linux-x64.node',
        };
        state.targets = [linux];

        await buildNode(linux, { force: true });

        expect(run.mock.calls.some(([, args]) => args.join(' ').includes('/opt/licenses'))).toBe(false);
    });

    test('links the system libraries the dependencies declare for addons', async () => {
        getData.mockImplementation((kind) => (kind === 'binary' ? { addonFlags: ['-lxml2'] } : {}));

        await buildNode(target, { force: true });

        const [configure] = cmakeCalls();
        expect(defineOf(configure, 'CROSSBIND_LINK_ARGS').split(';').at(-1)).toBe('-lxml2');
    });

    test('bundles the loader with the addon name pattern it resolves at runtime', async () => {
        await buildNode(target, { force: true });

        expect(written).toHaveLength(1);
        const [{ options, output }] = written;
        expect(options.input).toBe('/napi/js/loader.js');
        expect(options.plugins.map((plugin) => plugin.name)).toContain('crossbind-scoped-embind');
        expect(output).toMatchObject({ file: `${work}/demo.native.cjs`, format: 'cjs', exports: 'default' });
    });

    test('keeps each addon\'s env apart in the loader they share', () => {
        const x64 = {
            ...target, arch: 'x64', path: 'darwin-x64-mt-release', addonName: 'demo.darwin-x64.node',
        };
        const debug = { ...target, buildType: 'debug', jsName: 'demo.native.debug.cjs' };
        state.targets = [target, x64, debug, { platform: 'wasm', runtimeEnv: 'node', jsName: 'demo-wasm.node.js' }];
        getData.mockImplementation((kind, t) => (kind === 'env' ? { ARCH: t.arch, TAG: () => t.buildType } : {}));

        expect(nodeLoaderConfig(target)).toEqual({
            env: {
                'darwin-arm64': { ARCH: 'arm64', TAG: 'release' },
                'darwin-x64': { ARCH: 'x64', TAG: 'release' },
            },
            general: { name: 'demo' },
            paths: { addon: 'demo.{platform}-{arch}.node' },
        });
    });

    test('points the loader at the platform packages a package lists as optional dependencies', () => {
        state.config.package = {
            name: '@crossbind/port-zlib-standalone-napi',
            optionalDependencies: { '@crossbind/port-zlib-standalone-napi-darwin-arm64': '2.0.0' },
        };

        expect(nodeLoaderConfig(target).paths).toEqual({
            addon: 'demo.{platform}-{arch}.node',
            addonPackage: '@crossbind/port-zlib-standalone-napi-{platform}-{arch}',
        });
    });

    // An app that has not built its addon yet must not be told to install a package that does not exist.
    test('keeps the loader to the addon beside it when no platform package is listed', () => {
        state.config.package = { name: 'demo-app', optionalDependencies: { fsevents: '2.3.3' } };

        expect(nodeLoaderConfig(target).paths).toEqual({ addon: 'demo.{platform}-{arch}.node' });
    });

    // Each listed platform package links its own addon, so the package that lists any builds none; the
    // packages it lists are the platforms it publishes for.
    test('finds addons in packages when the package lists any', () => {
        state.targets = [target, { ...target, arch: 'x64' }, { ...target, platform: 'linux', arch: 'x64' }];
        state.config.package = {
            name: '@crossbind/port-zlib-standalone-napi',
            optionalDependencies: { '@crossbind/port-zlib-standalone-napi-linux-x64': '2.0.0' },
        };

        expect(addonsInPackages()).toBe(true);
        state.config.package = { name: 'demo-app', optionalDependencies: { fsevents: '2.3.3' } };
        expect(addonsInPackages()).toBe(false);
    });

    test('tells the loader only about the platforms the package publishes addons for', () => {
        const linux = { ...target, platform: 'linux', arch: 'x64' };
        state.targets = [target, { ...target, arch: 'x64' }, linux];
        state.config.package = {
            name: '@crossbind/port-zlib-standalone-napi',
            optionalDependencies: {
                '@crossbind/port-zlib-standalone-napi-darwin-arm64': '2.0.0',
                '@crossbind/port-zlib-standalone-napi-linux-x64': '2.0.0',
            },
        };

        expect(Object.keys(nodeLoaderConfig(linux).env)).toEqual(['darwin-arm64', 'linux-x64']);
    });

    test('bundles the loader alone, linking no addon', async () => {
        await bundleNodeLoader(target);

        expect(run).not.toHaveBeenCalled();
        expect(written.map(({ output }) => output.file)).toEqual([`${work}/demo.native.cjs`]);
    });

    test('serves the cached addon while its link inputs are unchanged', async () => {
        await buildNode(target, { force: true });
        run.mockClear();

        const built = await buildNode(target);

        expect(built).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test('relinks when the link inputs change', async () => {
        await buildNode(target, { force: true });
        run.mockClear();
        state.config.export.wholeArchive = true;

        const built = await buildNode(target);

        expect(built).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('builds macOS addons only on a macOS host', async () => {
        const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');

        const built = await buildNode(target, { force: true });

        platform.mockRestore();
        expect(built).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test('leaves cargo packages to the consuming app', async () => {
        state.config.export.type = 'cargo';

        const built = await buildNode(target, { force: true });

        expect(built).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });
});

describe('publishNodeData', () => {
    let work;
    let source;

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-nodedata-'));
        source = `${work}/dep/share/gdal`;
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(`${source}/gdalvrt.xsd`, 'v1');
        state.config = { paths: { build: work, output: `${work}/out` } };
        getData.mockReset();
        getData.mockImplementation((kind) => (kind === 'data' ? { [source]: 'gdal', [`${work}/missing`]: 'proj' } : {}));
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('puts each dependency data directory under dist/data, where the loader looks', () => {
        publishNodeData(target, { refresh: false });

        expect(fs.readFileSync(`${work}/out/data/gdal/gdalvrt.xsd`, 'utf8')).toBe('v1');
        expect(fs.existsSync(`${work}/out/data/proj`)).toBe(false);
    });

    test('keeps published data for a cached addon and replaces it after a relink', () => {
        publishNodeData(target, { refresh: false });
        fs.writeFileSync(`${source}/gdalvrt.xsd`, 'v2');

        publishNodeData(target, { refresh: false });
        expect(fs.readFileSync(`${work}/out/data/gdal/gdalvrt.xsd`, 'utf8')).toBe('v1');

        publishNodeData(target, { refresh: true });
        expect(fs.readFileSync(`${work}/out/data/gdal/gdalvrt.xsd`, 'utf8')).toBe('v2');
    });
});
