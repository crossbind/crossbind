import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';

// An app's dev session, which a dev server's plugin runs through crossbind's integration api: the host it builds, the app
// it opens, and the app it opens anew after an edit. The builds and the devices are stood in for.
const holder = { config: {}, target: null, changed: true };
const children = [];
function fakeChild() {
    const child = new EventEmitter();
    Object.assign(child, { exitCode: null, signalCode: null, killed: false });
    child.kill = vi.fn((signal = 'SIGTERM') => {
        child.killed = true;
        child.signalCode = signal;
        setImmediate(() => child.emit('exit', null, signal));
    });
    children.push(child);
    return child;
}
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => fakeChild()) }));
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));
vi.mock('../src/actions/buildDependencies.js', () => ({ default: vi.fn(async () => {}) }));
vi.mock('../src/actions/target.js', () => ({ getFilteredBuildTargets: vi.fn(() => [holder.target]) }));
vi.mock('../src/actions/buildApp.js', () => ({
    appLayout: () => ({ executable: 'Contents/MacOS/demo' }),
    appOutputName: () => 'demo-ios',
    appTargetParams: vi.fn(() => ({ dev: true })),
    buildProjectApp: vi.fn(async () => holder.changed),
    publishApp: vi.fn((target, { to }) => to),
}));
vi.mock('../src/actions/androidGradle.js', () => ({ buildApk: vi.fn() }));
vi.mock('../src/actions/androidDevice.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/iosSimulator.js', () => ({
    default: vi.fn(() => ({ child: fakeChild(), close: vi.fn() })),
    buildForSimulator: vi.fn(() => '/build/demo.app'),
}));
vi.mock('../src/actions/iosDevice.js', () => ({
    default: vi.fn(),
    buildForIosDevice: vi.fn(),
    connectedIosDevice: vi.fn((choice) => ({ name: choice })),
    iosDevServer: vi.fn(() => ({ address: '10.0.0.2', host: '10.0.0.2' })),
    iosDeviceAppEnv: vi.fn((address, port, base) => ({ CROSSBIND_APP_URL: `relay ${address}:${port}${base}` })),
}));
vi.mock('../src/utils/appSources.js', () => ({ isAppSource: (project, file) => file.endsWith('.js') }));

const { default: appDevSession } = await import('../src/integration/appDevSession.js');
const { spawn } = await import('node:child_process');
const { default: buildDependencies } = await import('../src/actions/buildDependencies.js');
const { publishApp } = await import('../src/actions/buildApp.js');
const { buildForSimulator, default: openInSimulator } = await import('../src/actions/iosSimulator.js');
const { connectedIosDevice, iosDevServer } = await import('../src/actions/iosDevice.js');

const kindOf = (file) => ({ cpp: 'source', h: 'header', rs: 'rust' })[file.split('.').pop()] ?? null;
const desktop = {
    platform: 'darwin', arch: 'arm64', buildType: 'debug', runtimeEnv: 'app', appName: 'demo', appJsName: 'demo.js',
};
let work;
let tool;
const opened = () => spawn.mock.calls.length;

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-app-dev-session-'))));
    holder.config = { paths: { project: work, build: `${work}/build`, cache: `${work}/cache` } };
    holder.target = desktop;
    holder.changed = true;
    children.length = 0;
    tool = { invalidate: vi.fn(), end: vi.fn(), error: vi.fn() };
    vi.clearAllMocks();
    vi.stubEnv('CROSSBIND_APP_PLATFORM', '');
    vi.stubEnv('CROSSBIND_APP_DEVICE', '');
});

afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(work, { recursive: true, force: true });
});

async function started() {
    const session = appDevSession(tool, kindOf);
    session.begin();
    await session.open({ port: 5173, base: '/' });
    return session;
}

describe("an app's dev session", () => {
    test('opens the app on the dev server once its host is built', async () => {
        await started();
        expect(buildDependencies).toHaveBeenCalledWith({ targetParams: { dev: true, buildType: ['debug'] } });
        expect(spawn).toHaveBeenCalledWith(`${work}/build/demo/Contents/MacOS/demo`, [], expect.objectContaining({
            env: expect.objectContaining({ CROSSBIND_APP_URL: 'http://localhost:5173/' }),
        }));
    });

    test('an edit to native code that changed the host opens the app anew, the old one first gone', async () => {
        const session = await started();
        expect(await session.changed(`${work}/src/native.cpp`)).toEqual({ reopened: true, native: true });
        expect(children[0].kill).toHaveBeenCalled();
        expect(opened()).toBe(2);
        expect(tool.invalidate).toHaveBeenCalledTimes(2);
    });

    test('an edit that changed nothing leaves the app that runs alone', async () => {
        const session = await started();
        holder.changed = false;
        expect(await session.changed(`${work}/src/native.h`)).toEqual({ reopened: false, native: true });
        expect(await session.changed(`${work}/src/main.js`)).toEqual({ reopened: false, native: false });
        expect(opened()).toBe(1);
    });

    test("other files, and what crossbind writes itself, are no edit of the app's", async () => {
        const session = await started();
        expect(await session.changed(`${work}/README.md`)).toBeNull();
        expect(await session.changed(`${work}/build/bridge/native.h`)).toBeNull();
        expect(await session.changed(`${work}/cache/conan/zlib.h`)).toBeNull();
        expect(buildDependencies).toHaveBeenCalledTimes(1);
    });

    test('a failed build is reported, and the next edit builds again', async () => {
        const session = await started();
        buildDependencies.mockRejectedValueOnce(new Error('crossbind: the host did not build'));
        expect(await session.changed(`${work}/src/native.cpp`)).toEqual({ reopened: false, native: true });
        expect(tool.error).toHaveBeenCalledWith('crossbind: the host did not build');
        expect(await session.changed(`${work}/src/native.cpp`)).toEqual({ reopened: true, native: true });
    });

    test('the app ending ends the session with its status, and one that did not start ends it with 1', async () => {
        await started();
        children[0].emit('exit', 3);
        expect(tool.end).toHaveBeenCalledWith(3);
        await started();
        children[1].emit('error', new Error('spawn EACCES'));
        expect(tool.error).toHaveBeenCalledWith('crossbind: the app did not start: spawn EACCES');
        expect(tool.end).toHaveBeenLastCalledWith(1);
    });

    test("serves the page the runtime the host's build wrote, once the build is done", async () => {
        fs.mkdirSync(`${work}/build`, { recursive: true });
        fs.writeFileSync(`${work}/build/demo.js`, 'runtime');
        const session = await started();
        expect(await session.glue()).toBe('runtime');
    });

    test('stopping ends the app that runs', async () => {
        const session = await started();
        await session.stop();
        expect(children[0].kill).toHaveBeenCalledWith();
    });
});

describe('on iOS', () => {
    test('a dev server for the Simulator listens as it was told', () => {
        expect(appDevSession(tool, kindOf).host('0.0.0.0')).toBeUndefined();
        expect(connectedIosDevice).not.toHaveBeenCalled();
    });

    test('an iPhone or iPad crossbind names reaches the dev server at the address it can reach, through its relay', () => {
        vi.stubEnv('CROSSBIND_APP_PLATFORM', 'ios');
        vi.stubEnv('CROSSBIND_APP_DEVICE', 'My iPhone');
        holder.target = { ...desktop, platform: 'ios' };
        const session = appDevSession(tool, kindOf);
        expect(session.host(undefined)).toBe('10.0.0.2');
        expect(connectedIosDevice).toHaveBeenCalledWith('My iPhone');
        expect(iosDevServer).toHaveBeenCalledWith({ name: 'My iPhone' }, undefined);
    });

    test('an app for the Simulator builds its project, opens there, and closes with the session', async () => {
        holder.target = { ...desktop, platform: 'ios' };
        const session = await started();
        expect(publishApp).toHaveBeenCalledWith(holder.target, { to: `${work}/build/demo-ios.debug` });
        expect(buildForSimulator).toHaveBeenCalledWith(`${work}/build/demo-ios.debug`, 'Debug');
        expect(openInSimulator).toHaveBeenCalledWith('/build/demo.app', expect.objectContaining({ show: true, env: { CROSSBIND_APP_URL: 'http://localhost:5173/' } }));
        const { close } = openInSimulator.mock.results[0].value;
        await session.stop();
        expect(close).toHaveBeenCalled();
    });
});
