import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));

const wasm = { platform: 'wasm', arch: 'wasm32', runtime: 'st' };
const ios = { platform: 'ios', arch: 'iphoneos', runtime: 'mt' };
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const configWith = (RUNNER) => ({ paths: { base: '/repo' }, system: { RUNNER } });

let scratch;
const crossbindDir = () => path.join(scratch, 'home', '.crossbind');

const toolsAt = (conanVersion) => (program, args) => (args[0] === '--version'
    ? { status: 0, stdout: program === 'conan' ? conanVersion : 'emcc (Emscripten) 6.0.9\n', stderr: '' }
    : { status: 0, stdout: '', stderr: '' });

async function importFresh() {
    vi.resetModules();
    const { spawnSync, execFileSync } = await import('node:child_process');
    spawnSync.mockReset();
    execFileSync.mockReset();
    spawnSync.mockImplementation(toolsAt('Conan version 2.33.0\n'));
    const mod = await import('../src/utils/runConan.js');
    return { mod, spawnSync, execFileSync };
}

const installCall = (spawnSync) => spawnSync.mock.calls.find(([, args]) => args.includes('install'));

const inspectReturning = (execFileSync, mounts) => {
    execFileSync.mockImplementation((cmd, args) => (
        args[0] === 'container' && args[1] === 'inspect' ? JSON.stringify([{ State: { Running: true }, Mounts: mounts }]) : ''
    ));
};

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runconan-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(scratch, 'home'));
    // A developer's own image override would otherwise decide which image the tests expect.
    vi.stubEnv('CROSSBIND_IMAGE_WEB', '');
    vi.stubEnv('CROSSBIND_REGISTRY_MIRROR', '');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, 'platform', hostPlatform);
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe('the runner conan runs under', () => {
    test('is DOCKER_RUN unless the system config names another', async () => {
        const { mod } = await importFresh();

        expect(mod.conanRunner({})).toBe('DOCKER_RUN');
        expect(mod.conanRunner(configWith('LOCAL'))).toBe('LOCAL');
    });

    test('refuses a value that is no runner instead of building on the host', async () => {
        const { mod } = await importFresh();

        ['docker_run', 'DOCKER_RUN ', 'podman', ''].forEach((runner) => {
            expect(() => mod.conanRunner(configWith(runner))).toThrow(/the runner .* is invalid/);
        });
    });

    test('is the host for iOS packages, which build with Xcode', async () => {
        const { mod } = await importFresh();

        expect(mod.conanRunner(configWith('DOCKER_RUN'), ios)).toBe('LOCAL');
        expect(mod.conanRunner(configWith('DOCKER_EXEC'), ios)).toBe('LOCAL');
        expect(mod.conanRunner(configWith('DOCKER_RUN'), wasm)).toBe('DOCKER_RUN');
    });
});

describe('a conan work directory', () => {
    test('carries a home of its own, which the .conanrc beside conan picks ahead of anything above it', async () => {
        const { mod } = await importFresh();

        const work = mod.createConanWork('DOCKER_RUN');

        expect(path.dirname(work.dir)).toBe(path.join(crossbindDir(), 'conan', 'work'));
        expect(fs.readFileSync(path.join(work.dir, '.conanrc'), 'utf8')).toBe('conan_home=./home\n');
        expect(fs.readFileSync(path.join(work.dir, 'home', 'global.conf'), 'utf8'))
            .toBe('core.cache:storage_path=/var/cache/crossbind/conan/store\ncore:non_interactive=True\n');
        expect(work.conanPath('host.profile')).toBe(`/var/cache/crossbind/conan/work/${path.basename(work.dir)}/host.profile`);
    });

    test('a second run gets a fresh directory and the same store', async () => {
        const { mod } = await importFresh();

        const first = mod.createConanWork('DOCKER_RUN');
        const second = mod.createConanWork('DOCKER_RUN');

        expect(second.dir).not.toBe(first.dir);
        expect(second.store).toBe(first.store);
    });

    test.skipIf(process.platform === 'win32')('is removed past the read-only directories a recipe left in it', async () => {
        const { mod } = await importFresh();
        const work = mod.createConanWork('DOCKER_RUN');
        fs.mkdirSync(path.join(work.dir, 'output', 'locked'), { recursive: true });
        fs.writeFileSync(path.join(work.dir, 'output', 'locked', 'file'), '');
        fs.chmodSync(path.join(work.dir, 'output', 'locked'), 0o555);

        mod.removeConanWork(work);

        expect(fs.existsSync(work.dir)).toBe(false);
    });

    test('what killed runs left is cleared, and the store kept', async () => {
        const { mod } = await importFresh();
        const leftover = mod.createConanWork('DOCKER_RUN');

        mod.clearConanWork('DOCKER_RUN');

        expect(fs.existsSync(leftover.dir)).toBe(false);
        expect(fs.existsSync(leftover.store)).toBe(true);
    });

    test('on the host it keeps a store apart from the one containers write to', async () => {
        const { mod } = await importFresh();

        const work = mod.createConanWork('LOCAL');

        expect(work.store).toBe(path.join(crossbindDir(), 'conan-local', 'store'));
        expect(work.store).not.toBe(mod.createConanWork('DOCKER_RUN').store);
        expect(fs.readFileSync(path.join(work.dir, 'home', 'global.conf'), 'utf8')).toContain(`core.cache:storage_path=${work.store}\n`);
        expect(work.conanPath('host.profile')).toBe(path.join(work.dir, 'host.profile'));
    });
});

describe('runConan on the host', () => {
    test('drops every variable that picks a profile, a compiler or a remote login', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        vi.stubEnv('CONAN_HOME', '/elsewhere');
        vi.stubEnv('CONAN_DEFAULT_PROFILE', 'other');
        vi.stubEnv('CONAN_LOGIN_USERNAME', 'someone');
        vi.stubEnv('CONAN_PASSWORD', 'secret');
        vi.stubEnv('CC', '/tmp/other-cc');
        vi.stubEnv('CFLAGS', '-O0');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createConanWork('LOCAL');

        mod.default(['install'], { config: configWith('LOCAL'), target: wasm, work });

        const [program, , { env, cwd }] = installCall(spawnSync);
        expect(program).toBe('conan');
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(env.CONAN_DEFAULT_PROFILE).toBeUndefined();
        expect(env.CONAN_LOGIN_USERNAME).toBeUndefined();
        expect(env.CONAN_PASSWORD).toBeUndefined();
        expect(env.CC).toBeUndefined();
        expect(env.CFLAGS).toBeUndefined();
        expect(env.PATH).toBe(process.env.PATH);
        expect(cwd).toBe(work.dir);
    });

    test.skipIf(process.platform === 'win32')("on a Mac, puts Xcode's archive tools ahead of a GNU ar on the PATH, for every package conan builds", async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        const { mod, spawnSync } = await importFresh();
        const work = mod.createConanWork('LOCAL');

        mod.default(['install'], { config: configWith('LOCAL'), target: wasm, work });

        const { env } = installCall(spawnSync)[2];
        const tools = path.join(work.dir, 'apple-tools');
        const bin = '/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin';
        expect(env.PATH).toBe(`${tools}${path.delimiter}${process.env.PATH}`);
        expect(Object.fromEntries(fs.readdirSync(tools).map((name) => [name, fs.readlinkSync(path.join(tools, name))]))).toEqual({
            ar: `${bin}/ar`, as: `${bin}/as`, nm: `${bin}/llvm-nm`, ranlib: `${bin}/ranlib`, strip: `${bin}/strip`,
        });
    });

    test('keeps the proxy, certificate and Emscripten settings a build needs', async () => {
        vi.stubEnv('HTTPS_PROXY', 'http://proxy:3128');
        vi.stubEnv('SSL_CERT_FILE', '/etc/company-ca.pem');
        vi.stubEnv('EMSDK_PYTHON', '/opt/python3.12/bin/python3');
        const { mod, spawnSync } = await importFresh();

        mod.default(['install'], { config: configWith('LOCAL'), target: wasm, work: mod.createConanWork('LOCAL') });

        const { env } = installCall(spawnSync)[2];
        expect(env.HTTPS_PROXY).toBe('http://proxy:3128');
        expect(env.SSL_CERT_FILE).toBe('/etc/company-ca.pem');
        expect(env.EMSDK_PYTHON).toBe('/opt/python3.12/bin/python3');
    });

    test('refuses a Conan older than 2.19, whose graph carries no sources for the license rows', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation(toolsAt('Conan version 2.17.0\n'));

        expect(() => mod.default(['install'], { config: configWith('LOCAL'), target: wasm, work: mod.createConanWork('LOCAL') }))
            .toThrow(/needs Conan 2\.19 or later; found Conan version 2\.17\.0/);
        expect(installCall(spawnSync)).toBeUndefined();
    });

    test('refuses android packages, which need the NDK of the android image', async () => {
        const { mod, spawnSync } = await importFresh();

        expect(() => mod.default(['install'], {
            config: configWith('LOCAL'), target: { platform: 'android', arch: 'arm64-v8a', runtime: 'mt' }, work: mod.createConanWork('LOCAL'),
        })).toThrow(/for android build in the android image, which RUNNER=LOCAL does not use/);
        expect(installCall(spawnSync)).toBeUndefined();
    });

    test('says so when there is no conan on the PATH', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation(toolsAt(''));

        expect(() => mod.default(['install'], { config: configWith('LOCAL'), target: wasm, work: mod.createConanWork('LOCAL') }))
            .toThrow(/needs Conan 2\.19 or later; found none/);
    });

    test('names the emcc and conan it builds with, asking them once', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation((program) => ({ status: 0, stdout: `${program} 1.2.3\nmore\n`, stderr: '' }));

        expect(mod.localToolchainIdentity()).toBe('emcc 1.2.3\nconan 1.2.3');
        mod.localToolchainIdentity();

        expect(spawnSync).toHaveBeenCalledTimes(2);
    });

    test("asks conan its version in a home of crossbind's, since conan migrates the home it starts in", async () => {
        const { mod, spawnSync } = await importFresh();

        mod.localToolchainIdentity();

        const [, , { cwd }] = spawnSync.mock.calls.find(([program]) => program === 'conan');
        expect(cwd).toBe(path.join(crossbindDir(), 'conan-local', 'probe'));
        expect(fs.readFileSync(path.join(cwd, '.conanrc'), 'utf8')).toBe('conan_home=./home\n');
    });

    test('names the Xcode clang and conan an iOS package builds with', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation((program, args, { env }) => ({ status: 0, stdout: `${[program, ...args].join(' ')} ${env.DEVELOPER_DIR ?? ''}\nmore\n`, stderr: '' }));

        expect(mod.localToolchainIdentity(ios)).toBe('xcrun clang --version /Applications/Xcode.app/Contents/Developer\nconan --version');
    });

    test('runs iOS installs with the Xcode every crossbind iOS archive builds with', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        vi.stubEnv('DEVELOPER_DIR', '/Applications/Xcode-beta.app/Contents/Developer');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createConanWork('LOCAL');

        mod.default(['install'], { config: configWith('DOCKER_RUN'), target: ios, work });

        const [program, , { env, cwd }] = installCall(spawnSync);
        expect(program).toBe('conan');
        expect(env.DEVELOPER_DIR).toBe('/Applications/Xcode.app/Contents/Developer');
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(cwd).toBe(work.dir);
    });

    test('says where a Conan new enough comes from when iOS packages find none', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation(toolsAt('Conan version 2.17.0\n'));

        expect(() => mod.default(['install'], { config: configWith('DOCKER_RUN'), target: ios, work: mod.createConanWork('LOCAL') }))
            .toThrow(/Conan packages for iOS build on this Mac[\s\S]*Conan 2\.19 or later; found Conan version 2\.17\.0[\s\S]*brew install conan/);
        expect(installCall(spawnSync)).toBeUndefined();
    });

    test('refuses iOS packages anywhere but a Mac', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        const { mod, spawnSync } = await importFresh();

        expect(() => mod.default(['install'], { config: configWith('DOCKER_RUN'), target: ios, work: mod.createConanWork('LOCAL') }))
            .toThrow(/Conan packages for iOS build with Xcode, on a Mac/);
        expect(installCall(spawnSync)).toBeUndefined();
    });
});

describe('runConan in docker', () => {
    test('mounts the store and its work directory, and nothing of the project', async () => {
        const { mod, spawnSync } = await importFresh();
        const work = mod.createConanWork('DOCKER_RUN');

        mod.default(['install', '-pr:h', work.conanPath('host.profile')], { config: configWith('DOCKER_RUN'), target: wasm, work });

        const [program, argv] = spawnSync.mock.calls[0];
        expect(program).toBe('docker');
        expect(argv.slice(0, 2)).toEqual(['run', '--rm']);
        expect(argv).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--workdir', work.conanDir]));
        const mounts = argv.flatMap((arg, i) => (argv[i - 1] === '-v' ? [arg] : []));
        expect(mounts).toEqual([`${work.store}:/var/cache/crossbind/conan/store`, `${work.dir}:${work.conanDir}`]);
        expect(argv.join(' ')).toContain(`-e CONAN_HOME=${work.conanDir}/home`);
        const conanAt = argv.indexOf('conan');
        expect(argv[conanAt - 1]).toMatch(/^ghcr\.io\/crossbind\/web@sha256:[0-9a-f]{64}$/);
        expect(argv.slice(conanAt)).toEqual(['conan', 'install', '-pr:h', `${work.conanDir}/host.profile`]);
    });

    test('android packages build in the amd64 android image, the only one the NDK ships for', async () => {
        const { mod, spawnSync } = await importFresh();
        const work = mod.createConanWork('DOCKER_RUN');

        mod.default(['install'], { config: configWith('DOCKER_RUN'), target: { platform: 'android', arch: 'arm64-v8a', runtime: 'mt' }, work });

        const argv = installCall(spawnSync)[1];
        expect(argv[argv.indexOf('--platform') + 1]).toBe('linux/amd64');
        expect(argv[argv.indexOf('conan') - 1]).toMatch(/^ghcr\.io\/crossbind\/android@sha256:[0-9a-f]{64}$/);
    });

    test('a wasm install passes no platform', async () => {
        const { mod, spawnSync } = await importFresh();

        mod.default(['install'], { config: configWith('DOCKER_RUN'), target: wasm, work: mod.createConanWork('DOCKER_RUN') });

        expect(installCall(spawnSync)[1]).not.toContain('--platform');
    });

    test('DOCKER_EXEC runs conan in the container that mounts the Conan root', async () => {
        const { mod, spawnSync, execFileSync } = await importFresh();
        const work = mod.createConanWork('DOCKER_EXEC');
        inspectReturning(execFileSync, [
            { Destination: '/tmp/crossbind/live', Source: '/repo' },
            { Destination: '/var/cache/crossbind/conan', Source: work.root },
        ]);

        mod.default(['install'], { config: configWith('DOCKER_EXEC'), target: wasm, work });

        const argv = spawnSync.mock.calls[0][1];
        expect(argv[0]).toBe('exec');
        expect(argv[argv.indexOf('--workdir') + 1]).toBe(work.conanDir);
        expect(argv).toContain('conan');
    });

    test('DOCKER_EXEC names the commands that recreate a container made before the Conan mount', async () => {
        const { mod, execFileSync } = await importFresh();
        inspectReturning(execFileSync, [{ Destination: '/tmp/crossbind/live', Source: '/repo' }]);

        expect(() => mod.default(['install'], { config: configWith('DOCKER_EXEC'), target: wasm, work: mod.createConanWork('DOCKER_EXEC') }))
            .toThrow(/does not mount[\s\S]*var\/cache\/crossbind\/conan[\s\S]*crossbind docker stop web[\s\S]*crossbind docker create web/);
    });
});

describe('mapping the paths conan reports back to the host', () => {
    test('a path under the mounts maps onto the Conan root', async () => {
        const { mod } = await importFresh();
        const work = mod.createConanWork('DOCKER_RUN');

        expect(mod.toHostPath('/var/cache/crossbind/conan/store/b/zlib1/p/include', work))
            .toBe(path.join(work.root, 'store', 'b', 'zlib1', 'p', 'include'));
    });

    test('a path that climbs out of the mounts or was never in them is refused', async () => {
        const { mod } = await importFresh();
        const work = mod.createConanWork('DOCKER_RUN');

        [
            '/var/cache/crossbind/conan/store/b/x/p/../../../../../../.ssh',
            '/var/cache/crossbind/conan/store/p/x\\..\\..\\..\\..\\Windows',
            '/tmp/crossbind/live/app/x.h',
            '/usr/include',
            '/var/cache/crossbind/conan',
        ].forEach((reported) => expect(() => mod.toHostPath(reported, work)).toThrow(/outside the directories crossbind mounts/));
    });

    test('on the host a reported path is only normalised', async () => {
        const { mod } = await importFresh();

        expect(mod.toHostPath('/store/b/x/p/../include', { runner: 'LOCAL' })).toBe(path.resolve('/store/b/x/include'));
    });
});
