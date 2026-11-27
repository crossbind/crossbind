import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import upath from 'upath';

// crossbind's integration api, which a bundler's plugin reaches crossbind through, with the steps under it stood in for.
const holder = {
    config: {}, targets: [], isApp: false, preview: null, web: [], app: [],
};
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        get targets() { return holder.targets; },
    },
}));
vi.mock('../src/utils/appBuild.js', () => ({ default: () => holder.isApp }));
vi.mock('../src/actions/target.js', () => ({
    getTargetParams: (params) => ({ ...params, from: 'web' }),
    getFilteredBuildTargets: (params, filter) => (params.from === 'app' ? holder.app : holder.web)
        .filter((target) => target.buildType === filter.buildType && (!filter.runtimeEnv || target.runtimeEnv === filter.runtimeEnv)),
}));
vi.mock('../src/actions/buildApp.js', () => ({
    appTargetParams: () => ({ from: 'app' }),
    appOutputName: (target) => `app-${target.arch}`,
    appPlatform: () => 'macos',
    appLayout: vi.fn(),
    buildProjectApp: vi.fn(),
    emptyAppOutDir: vi.fn(),
    publishApp: vi.fn((target, { to }) => to),
}));
vi.mock('../src/actions/appInstaller.js', () => ({ checkInstaller: vi.fn(), shipApp: vi.fn() }));
vi.mock('../src/actions/buildDependencies.js', () => ({ default: vi.fn(async () => {}) }));
vi.mock('../src/actions/createInterface.js', () => ({ default: vi.fn((header) => `${header}.bridge`) }));
vi.mock('../src/actions/createLib.js', () => ({ default: vi.fn(() => false) }));
vi.mock('../src/actions/buildWasm.js', () => ({ default: vi.fn(async () => {}) }));
vi.mock('../src/actions/isSourceNewer.js', () => ({ default: vi.fn(() => false) }));
vi.mock('../src/actions/getAllBridges.js', () => ({ default: vi.fn(() => ['on-disk.i.cpp']) }));
vi.mock('../src/actions/pageLicenses.js', () => ({ default: vi.fn(async () => ({ fileName: 'licenses.json', source: '[]' })) }));
vi.mock('../src/integration/getCrossbindScript.js', () => ({
    default: vi.fn((target, bridge) => `module of ${bridge}`),
    getRustJsScript: vi.fn((target, file) => `rust module of ${file}`),
}));
vi.mock('../src/integration/getDependFilePath.js', () => ({ default: vi.fn((source) => (source === 'dep/x.h' ? '/deps/x.h' : undefined)) }));
vi.mock('../src/integration/bindHeaderImports.js', () => ({ default: vi.fn(() => []) }));
vi.mock('../src/utils/appSources.js', () => ({
    default: vi.fn(() => ['/project/src/main.js']),
    isAppSource: vi.fn((project, file) => file.endsWith('.js')),
}));
vi.mock('../src/utils/resolveAppHost.js', () => ({ findAppPageApi: () => null, resolveAppPageApi: () => '/host/page-api.js' }));
vi.mock('../src/utils/previewSession.js', () => ({
    PAGE_API_PATH: '/__crossbind/app.js',
    guardServer: vi.fn(),
    previewGate: vi.fn(() => 'gate'),
    previewOf: () => holder.preview,
    previewSocketGate: vi.fn(() => 'socket gate'),
}));

const { default: integrationApi } = await import('../src/integration/api.js');
const { default: buildDependencies } = await import('../src/actions/buildDependencies.js');
const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
const { default: createLib } = await import('../src/actions/createLib.js');
const { default: buildWasm } = await import('../src/actions/buildWasm.js');
const { default: isSourceNewer } = await import('../src/actions/isSourceNewer.js');
const { default: pageLicensesAsset } = await import('../src/actions/pageLicenses.js');
const { default: getCrossbindScript, getRustJsScript } = await import('../src/integration/getCrossbindScript.js');
const { checkInstaller, shipApp } = await import('../src/actions/appInstaller.js');
const { buildProjectApp, publishApp } = await import('../src/actions/buildApp.js');
const { guardServer, previewSocketGate } = await import('../src/utils/previewSession.js');

const web = (buildType) => ({
    platform: 'wasm',
    arch: 'wasm32',
    runtime: 'st',
    buildType,
    runtimeEnv: 'browser',
    path: `wasm-wasm32-st-${buildType}`,
    jsName: `${buildType}.js`,
    wasmName: `${buildType}.wasm`,
    dataTxtName: `${buildType}.data.txt`,
});
const release = web('release');
const debug = web('debug');
const COMMON_BRIDGES = '/cli/assets/cpp-runtime/commonBridges.cpp';
let work;

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-integration-api-'))));
    fs.mkdirSync(`${work}/build/bridge`, { recursive: true });
    holder.config = {
        ext: { header: ['h', 'hpp'], module: ['i'], source: ['cpp', 'c'] },
        paths: {
            project: work, build: `${work}/build`, cache: `${work}/cache`, output: `${work}/build`, native: [`${work}/src/native`], cli: '/cli',
        },
        allDependencies: [],
    };
    holder.targets = [release, debug, { platform: 'ios', arch: 'arm64', buildType: 'release' }];
    holder.isApp = false;
    holder.preview = null;
    holder.web = [release, debug];
    holder.app = [];
    vi.clearAllMocks();
    isSourceNewer.mockReturnValue(false);
    createLib.mockReturnValue(false);
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('the targets of the page a tool builds', () => {
    test("a browser's wasm, release and debug", () => {
        expect(integrationApi().targets).toMatchObject({ release, debug });
    });

    test('each of release and debug stands in for the other', () => {
        holder.web = [release];
        expect(integrationApi().targets).toMatchObject({ release, debug: release });
        holder.web = [debug];
        expect(integrationApi().targets).toMatchObject({ release: debug, debug });
    });

    test('a project that builds no wasm32 browser target stops, naming why', () => {
        holder.web = [];
        expect(() => integrationApi().targets).toThrow('crossbind.config.js leaves no wasm32 browser target');
        expect(integrationApi().web).toBeNull();
    });

    test("in an app build, every arch's app; and none on a machine apps do not build on", () => {
        holder.isApp = true;
        const apps = ['x64', 'arm64'].map((arch) => ({
            platform: 'darwin', arch, buildType: 'release', runtimeEnv: 'app',
        }));
        holder.app = apps;
        const api = integrationApi();
        expect(api.targets.release).toBe(apps[0]);
        expect(api.app.targets).toEqual(apps);
        holder.app = [];
        expect(() => integrationApi().targets).toThrow('desktop apps build on macOS, Linux and Windows so far');
    });

    test("React Native's target for iOS and Android", () => {
        expect(integrationApi().nativeTarget('ios')).toBe(holder.targets[2]);
        expect(integrationApi().nativeTarget('android')).toBeUndefined();
    });
});

describe('what a native import becomes', () => {
    test('tells headers, modules, sources and Rust apart', () => {
        const { kindOf } = integrationApi();
        expect(['a.h', 'b.hpp', 'c.i', 'd.cpp', 'e.rs', 'f.js', 'g.h?import'].map(kindOf))
            .toEqual(['header', 'header', 'module', 'source', 'rust', null, null]);
    });

    test('a header binds for the target and becomes its module, its bridge kept for the link', async () => {
        const api = integrationApi();
        expect(api.transform('/project/src/native.h', release, { base: '/app/', liveExports: true })).toBe('module of /project/src/native.h.bridge');
        expect(createBridgeFile).toHaveBeenCalledWith('/project/src/native.h', release);
        expect(getCrossbindScript).toHaveBeenCalledWith(release, '/project/src/native.h.bridge', { base: '/app/', liveExports: true, atBase: false });
        await api.link(release);
        expect(createLib).toHaveBeenCalledWith(release, 'Bridge', expect.objectContaining({ nativeGlob: [COMMON_BRIDGES, '/project/src/native.h.bridge'] }));
    });

    test('a Rust surface needs no bridge, and other files are none of crossbind', () => {
        const api = integrationApi();
        expect(api.transform('/project/src/lib.rs', release, { base: '/app/', atBase: true })).toBe('rust module of /project/src/lib.rs');
        expect(getRustJsScript).toHaveBeenCalledWith(release, '/project/src/lib.rs', { base: '/app/', atBase: true });
        expect(createBridgeFile).not.toHaveBeenCalled();
        expect(api.transform('/project/src/main.js', release)).toBeNull();
    });

    test("resolves a dependency's file, and nothing else", () => {
        const api = integrationApi();
        expect(api.resolve('dep/x.h', release)).toBe('/deps/x.h');
        expect(api.resolve('react', release)).toBeNull();
    });
});

describe('the glue a tool links', () => {
    test('links the sources and the bridges, forcing the wasm when a lib was rebuilt', async () => {
        createLib.mockImplementation((target, kind) => kind === 'Source');
        await integrationApi().link(debug);
        expect(createLib).toHaveBeenCalledWith(debug, 'Source', { force: false, buildSource: true });
        expect(buildWasm).toHaveBeenCalledWith(debug, { force: true });
        expect(buildDependencies).not.toHaveBeenCalled();
    });

    test('builds the dependencies first when asked, for the build type linked', async () => {
        await integrationApi().link(debug, { prepare: true });
        expect(buildDependencies).toHaveBeenCalledWith({ targetParams: expect.objectContaining({ buildType: ['debug'] }) });
    });

    test('takes the bridges in the build directory for a tool that transformed in other processes', async () => {
        await integrationApi().link(release, { allBridges: true });
        expect(createLib).toHaveBeenCalledWith(release, 'Bridge', expect.objectContaining({ nativeGlob: [COMMON_BRIDGES, 'on-disk.i.cpp'] }));
    });

    test('a link asked for while one runs shares it; one asked for after it settles links again', async () => {
        let finish;
        buildWasm.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        const api = integrationApi();
        const first = api.link(debug);
        expect(api.link(debug)).toBe(first);
        finish();
        await first;
        await api.link(debug);
        expect(buildWasm).toHaveBeenCalledTimes(2);
    });

    // Each api has a linker of its own, as each of a tool's processes has: loaders that link, as Next's do under `next
    // dev`, would otherwise write one target's outputs at once.
    test('two processes link a target one after the other', async () => {
        let active = 0;
        let most = 0;
        buildWasm.mockImplementation(async () => {
            active += 1;
            most = Math.max(most, active);
            await new Promise((resolve) => { setTimeout(resolve, 100); });
            active -= 1;
        });
        await Promise.all([integrationApi().link(debug), integrationApi().link(debug)]);
        expect(buildWasm).toHaveBeenCalledTimes(2);
        expect(most).toBe(1);
    });

    test("names a web target's files and an app's", () => {
        expect(integrationApi().outputs(release).map(({ name, path, optional }) => [name, path, optional])).toEqual([
            ['crossbind.js', `${work}/build/release.js`, false],
            ['crossbind.wasm', `${work}/build/release.wasm`, false],
            ['crossbind.data.txt', `${work}/build/release.data.txt`, true],
        ]);
        const app = { platform: 'darwin', runtimeEnv: 'app', appJsName: 'app.js' };
        expect(integrationApi().outputs(app).map(({ name, path }) => [name, path])).toEqual([['crossbind.js', `${work}/build/app.js`]]);
    });

    test('copies the files into a directory it makes, leaving out data the build has none of', () => {
        fs.writeFileSync(`${work}/build/release.js`, 'js');
        fs.writeFileSync(`${work}/build/release.wasm`, 'wasm');
        integrationApi().writeOutputs(release, `${work}/out/page`);
        expect(fs.readdirSync(`${work}/out/page`).sort()).toEqual(['crossbind.js', 'crossbind.wasm']);
    });

    test('names the output directory crossbind.config.js gives, else none', () => {
        expect(integrationApi().dirs.output).toBeNull();
        holder.config.paths.output = `${work}/public`;
        expect(integrationApi().dirs.output).toBe(`${work}/public`);
    });
});

describe('what a dev server answers for the page', () => {
    let server = null;
    const listen = (middleware) => new Promise((resolve) => {
        server = http.createServer((req, res) => middleware(req, res, () => {
            res.statusCode = 418;
            res.end('next');
        }));
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
    });

    afterEach(() => new Promise((resolve) => {
        server.close(resolve);
    }));

    test('serves the files under any base, with their type, isolated when asked', async () => {
        fs.writeFileSync(`${work}/build/debug.wasm`, 'wasm bytes');
        const url = await listen(integrationApi().serve(debug, { isolate: true }));
        const response = await fetch(`${url}/app/crossbind.wasm?v=1`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('wasm bytes');
        expect(response.headers.get('content-type')).toBe('application/wasm');
        expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
        expect((await fetch(`${url}/app/main.js`)).status).toBe(418);
    });

    test('answers 404 for a file the build has not made', async () => {
        const url = await listen(integrationApi().serve(debug));
        const response = await fetch(`${url}/crossbind.data.txt`);
        expect(response.status).toBe(404);
        expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
    });

    test('links the glue a page asks for, and the wasm waits for that link', async () => {
        fs.writeFileSync(`${work}/build/debug.js`, 'glue');
        fs.writeFileSync(`${work}/build/debug.wasm`, 'old');
        let finish;
        const linking = new Promise((started) => {
            buildWasm.mockImplementationOnce(() => new Promise((done) => {
                finish = () => {
                    fs.writeFileSync(`${work}/build/debug.wasm`, 'linked');
                    done();
                };
                started();
            }));
        });
        const url = await listen(integrationApi().serve(debug, { link: { prepare: true } }));
        const glue = fetch(`${url}/crossbind.js`).then((response) => response.text());
        await linking;
        let isAnswered = false;
        const wasm = fetch(`${url}/crossbind.wasm`).then((response) => {
            isAnswered = true;
            return response.text();
        });
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        expect(isAnswered).toBe(false);
        finish();
        expect(await glue).toBe('glue');
        expect(await wasm).toBe('linked');
        expect(buildDependencies).toHaveBeenCalledTimes(1);
    });

    test('answers a link that failed with its message', async () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
        buildWasm.mockRejectedValueOnce(new Error('crossbind: the link failed'));
        const url = await listen(integrationApi().serve(debug, { link: {} }));
        const response = await fetch(`${url}/crossbind.js`);
        expect(response.status).toBe(500);
        expect(await response.text()).toBe('crossbind: the link failed');
        quiet.mockRestore();
    });
});

describe("a dev server's answer to an edit", () => {
    test('a header binds and relinks the debug glue', async () => {
        expect(await integrationApi().changed(`${work}/src/native.h`)).toEqual({});
        expect(createBridgeFile).toHaveBeenCalledWith(`${work}/src/native.h`, release);
        expect(createLib).toHaveBeenCalledWith(debug, 'Bridge', expect.objectContaining({ force: true }));
        expect(buildWasm).toHaveBeenCalledWith(debug, { force: true });
    });

    test('a source rebuilds its lib, and a Rust file its surface', async () => {
        const api = integrationApi();
        expect(await api.changed(`${work}/src/native.cpp`)).toEqual({});
        expect(createLib).toHaveBeenCalledWith(debug, 'Source', { force: true, buildSource: true, bypassCmake: true });
        expect(await api.changed(`${work}/src/lib.rs`)).toEqual({});
        expect(getRustJsScript).toHaveBeenCalledWith(debug, `${work}/src/lib.rs`);
    });

    test('an app source binds the headers it imports again, naming them when a bridge changed', async () => {
        const header = `${work}/src/native.h`;
        fs.mkdirSync(`${work}/src`, { recursive: true });
        fs.writeFileSync(header, 'int one();\n');
        const bridge = `${work}/build/bridge/native.h.i.cpp`;
        fs.writeFileSync(bridge, 'one');
        fs.writeFileSync(`${bridge}.source`, `${header}\n`);
        const api = integrationApi();
        createBridgeFile.mockReturnValueOnce(bridge);
        api.transform(header, release);
        createBridgeFile.mockImplementationOnce(() => fs.writeFileSync(bridge, 'one two'));
        expect(await api.changed(`${work}/src/main.js`)).toEqual({ headers: [header] });
        expect(await api.changed(`${work}/src/main.js`)).toBeNull();
    });

    test('what crossbind writes itself is no edit', async () => {
        expect(await integrationApi().changed(`${work}/build/bridge/x.h`)).toBeNull();
        expect(await integrationApi().changed(`${work}/cache/conan/x.h`)).toBeNull();
        expect(buildWasm).not.toHaveBeenCalled();
    });
});

describe("an app's build", () => {
    const apps = ['x64', 'arm64'].map((arch) => ({
        platform: 'darwin', arch, buildType: 'release', runtimeEnv: 'app',
    }));

    test('is null outside one', () => {
        expect(integrationApi().app).toBeNull();
    });

    test("checks, builds and publishes every arch's app, the installers last", async () => {
        holder.isApp = true;
        holder.app = apps;
        const { app } = integrationApi();
        await app.check();
        await app.build();
        await app.publish('/dist');
        expect(checkInstaller.mock.calls.map(([target]) => target.arch)).toEqual(['x64', 'arm64']);
        expect(buildProjectApp.mock.calls.map(([target]) => target.arch)).toEqual(['x64', 'arm64']);
        expect(publishApp).toHaveBeenCalledWith(apps[1], { to: '/dist/app-arm64', page: '/dist' });
        expect(shipApp.mock.invocationCallOrder[0]).toBeGreaterThan(publishApp.mock.invocationCallOrder[1]);
        expect(app.platform).toBe('macos');
    });

    test('a mobile app publishes its one project', async () => {
        holder.isApp = true;
        holder.app = ['arm64', 'x64'].map((arch) => ({
            platform: 'ios', arch, buildType: 'release', runtimeEnv: 'app',
        }));
        await integrationApi().app.publish('/dist');
        expect(publishApp).toHaveBeenCalledTimes(1);
    });

    test("finds the page's licenses for the app's platform", async () => {
        holder.isApp = true;
        holder.app = apps;
        expect(await integrationApi().licenses({}, { root: '/project' })).toEqual({ fileName: 'licenses.json', source: '[]' });
        expect(pageLicensesAsset).toHaveBeenCalledWith({}, { root: '/project', platform: 'darwin', runtimeEnv: 'app' });
    });
});

describe('a preview', () => {
    test('is null where crossbind app preview started none, and in an app build', () => {
        expect(integrationApi().preview).toBeNull();
        holder.isApp = true;
        holder.preview = { key: 'k' };
        expect(integrationApi().preview).toBeNull();
    });

    test("names where its server listens, and refuses a web build's", () => {
        holder.preview = {
            key: 'k', listen: '0.0.0.0', port: 5173, address: '192.168.1.2',
        };
        expect(integrationApi().preview.server()).toEqual({ listen: '0.0.0.0', port: 5173, address: '192.168.1.2' });
        holder.preview = { build: true };
        expect(() => integrationApi().preview.server()).toThrow("names a preview's web build, which serves nothing");
    });

    test('guards the server and its sockets', () => {
        holder.preview = { key: 'k' };
        const httpServer = { prependListener: vi.fn() };
        integrationApi().preview.guard(httpServer, { logger: {}, configOf: () => ({}) });
        expect(guardServer).toHaveBeenCalledWith(httpServer, 'gate');
        expect(httpServer.prependListener).toHaveBeenCalledWith('upgrade', 'socket gate');
        expect(previewSocketGate).toHaveBeenCalledTimes(1);
    });
});

describe('what a tool watches', () => {
    test('every file under the native directories that exist', () => {
        fs.mkdirSync(`${work}/src/native/inner`, { recursive: true });
        fs.writeFileSync(`${work}/src/native/a.cpp`, '');
        fs.writeFileSync(`${work}/src/native/inner/b.h`, '');
        holder.config.paths.native.push(`${work}/missing`);
        expect(integrationApi().nativeFiles().sort()).toEqual([`${work}/src/native/a.cpp`, `${work}/src/native/inner/b.h`]);
        expect(integrationApi().nativeDirs()).toEqual([`${work}/src/native`, `${work}/missing`]);
    });

    test("a cargo dependency's crate root, for a tool that resolves bare imports as Node does", () => {
        fs.mkdirSync(`${work}/rust/crate/src`, { recursive: true });
        fs.writeFileSync(`${work}/rust/crate/src/lib.rs`, '');
        holder.config.allDependencies = [
            { package: { name: '@demo/rust' }, export: { type: 'cargo' }, paths: { project: `${work}/rust` } },
            { package: { name: '@demo/gone' }, export: { type: 'cargo' }, paths: { project: `${work}/gone` } },
            { package: { name: '@demo/cpp' }, export: { type: 'cmake' }, paths: { project: `${work}/cpp` } },
        ];
        expect(integrationApi().rustPackages()).toEqual([{ name: '@demo/rust', entry: `${work}/rust/crate/src/lib.rs` }]);
    });
});
