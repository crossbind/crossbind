import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn() } }));

const CONAN = { name: 'conan', packageSource: { storeUnits: ['p/*/p', 'b/*/p'] } };
const VCPKG = { name: 'vcpkg', packageSource: { storeUnits: [] } };
const wasm = { platform: 'wasm', arch: 'wasm32', runtime: 'st' };
const ios = { platform: 'ios', arch: 'iphoneos', runtime: 'mt' };
const darwin = { platform: 'darwin', arch: 'arm64', runtime: 'mt' };
const android = { platform: 'android', arch: 'arm64-v8a', runtime: 'mt' };
const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const configWith = (RUNNER) => ({ paths: { base: '/repo' }, system: { RUNNER } });
const remoteConfig = () => ({ paths: { base: '/repo' }, system: { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' } });
const XCODE = '/Applications/Xcode.app/Contents/Developer';

let scratch;
const crossbindDir = () => path.join(scratch, 'home', '.crossbind');

async function importFresh() {
    vi.resetModules();
    const { spawnSync, execFileSync } = await import('node:child_process');
    spawnSync.mockReset();
    execFileSync.mockReset();
    spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    const mod = await import('../src/utils/runPackageSource.js');
    return { mod, spawnSync, execFileSync };
}

// A source runs its tool with what the tool needs of the run: conan, with the home it keeps there.
const install = (mod, work, {
    config, target, source = CONAN, args = [],
}) => mod.default(['conan', 'install', ...args], {
    source, config, target, work, env: { CONAN_HOME: work.toolPath('home') },
});

const installCall = (spawnSync) => spawnSync.mock.calls.find(([, args]) => args.includes('install'));
const mountsOf = (argv) => argv.flatMap((arg, i) => (argv[i - 1] === '-v' ? [arg] : []));
const linksIn = (dir) => Object.fromEntries(fs.readdirSync(dir).map((name) => [name, fs.readlinkSync(path.join(dir, name))]));

const inspectReturning = (execFileSync, mounts) => {
    execFileSync.mockImplementation((cmd, args) => (
        args[0] === 'container' && args[1] === 'inspect' ? JSON.stringify([{ State: { Running: true }, Mounts: mounts }]) : ''
    ));
};

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runsource-'));
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

describe('the runner a package source runs under', () => {
    test('is DOCKER_RUN unless the system config names another', async () => {
        const { mod } = await importFresh();

        expect(mod.sourceRunner({})).toBe('DOCKER_RUN');
        expect(mod.sourceRunner(configWith('LOCAL'))).toBe('LOCAL');
    });

    test('refuses a value that is no runner instead of building on the host', async () => {
        const { mod } = await importFresh();

        ['docker_run', 'DOCKER_RUN ', 'podman', ''].forEach((runner) => {
            expect(() => mod.sourceRunner(configWith(runner))).toThrow(/the runner .* is invalid/);
        });
    });

    test('is the host for iOS and macOS packages, which build with Xcode', async () => {
        const { mod } = await importFresh();

        expect(mod.sourceRunner(configWith('DOCKER_RUN'), ios)).toBe('LOCAL');
        expect(mod.sourceRunner(configWith('DOCKER_EXEC'), ios)).toBe('LOCAL');
        expect(mod.sourceRunner(configWith('DOCKER_RUN'), darwin)).toBe('LOCAL');
        expect(mod.sourceRunner(configWith('DOCKER_RUN'), wasm)).toBe('DOCKER_RUN');
    });

    test('follows RUNNER=REMOTE for every package but the Apple ones, whatever addresses are set', async () => {
        const { mod } = await importFresh();
        const config = remoteConfig();

        expect(mod.sourceRunner(config, wasm)).toBe('REMOTE');
        expect(mod.sourceRunner(config, { platform: 'android', arch: 'x86_64', runtime: 'st' })).toBe('REMOTE');
        expect(mod.sourceRunner(config, ios)).toBe('LOCAL');
    });
});

describe("a package source's work directory", () => {
    test("is a fresh directory under the source's root, which a container sees under a root of its own", async () => {
        const { mod } = await importFresh();

        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        const seen = `/var/cache/crossbind/conan/work/${path.basename(work.dir)}`;
        expect(path.dirname(work.dir)).toBe(path.join(crossbindDir(), 'conan', 'work'));
        expect(work).toMatchObject({
            name: 'conan', runner: 'DOCKER_RUN', root: path.join(crossbindDir(), 'conan'), store: path.join(crossbindDir(), 'conan', 'store'), toolDir: seen,
        });
        expect(work.toolPath()).toBe(seen);
        expect(work.toolPath('host.profile')).toBe(`${seen}/host.profile`);
        expect(work.toolPath('home', 'global.conf')).toBe(`${seen}/home/global.conf`);
        expect(work.storePath()).toBe('/var/cache/crossbind/conan/store');
        expect(work.storePath('p', 'zlib1')).toBe('/var/cache/crossbind/conan/store/p/zlib1');
        expect(fs.statSync(work.store).isDirectory()).toBe(true);
    });

    test("holds nothing of a tool's own: what a tool needs of a run, its source puts there", async () => {
        const { mod } = await importFresh();

        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        expect(fs.readdirSync(work.dir)).toEqual([]);
    });

    test('a second run gets a fresh directory and the same store', async () => {
        const { mod } = await importFresh();

        const first = mod.createSourceWork('conan', 'DOCKER_RUN');
        const second = mod.createSourceWork('conan', 'DOCKER_RUN');

        expect(second.dir).not.toBe(first.dir);
        expect(second.store).toBe(first.store);
    });

    test.skipIf(process.platform === 'win32')('is removed past the read-only directories a recipe left in it', async () => {
        const { mod } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');
        fs.mkdirSync(path.join(work.dir, 'output', 'locked'), { recursive: true });
        fs.writeFileSync(path.join(work.dir, 'output', 'locked', 'file'), '');
        fs.chmodSync(path.join(work.dir, 'output', 'locked'), 0o555);

        mod.removeSourceWork(work);

        expect(fs.existsSync(work.dir)).toBe(false);
    });

    test('what killed runs left is cleared, and the store kept', async () => {
        const { mod } = await importFresh();
        const leftover = mod.createSourceWork('conan', 'DOCKER_RUN');

        mod.clearSourceWork('conan', 'DOCKER_RUN');

        expect(fs.existsSync(leftover.dir)).toBe(false);
        expect(fs.existsSync(leftover.store)).toBe(true);
    });

    test('a remote run shares the store and the paths of the containers, whose image the runner carries', async () => {
        const { mod } = await importFresh();

        const work = mod.createSourceWork('conan', 'REMOTE');

        expect(work.store).toBe(mod.createSourceWork('conan', 'DOCKER_RUN').store);
        expect(work.toolPath('host.profile')).toBe(`/var/cache/crossbind/conan/work/${path.basename(work.dir)}/host.profile`);
    });

    test('on the host it keeps a store apart from the one containers write to, and the tool sees both where they are', async () => {
        const { mod } = await importFresh();

        const work = mod.createSourceWork('conan', 'LOCAL');

        expect(work.store).toBe(path.join(crossbindDir(), 'conan-local', 'store'));
        expect(work.store).not.toBe(mod.createSourceWork('conan', 'DOCKER_RUN').store);
        expect(work.storePath()).toBe(work.store);
        expect(work.storePath('p', 'zlib1')).toBe(path.join(work.store, 'p', 'zlib1'));
        expect(work.toolDir).toBe(work.dir);
        expect(work.toolPath('host.profile')).toBe(path.join(work.dir, 'host.profile'));
    });

    test('a source of another name keeps everything of its own under that name', async () => {
        const { mod } = await importFresh();

        const work = mod.createSourceWork('vcpkg', 'DOCKER_RUN');

        expect(mod.sourceRoot('vcpkg')).toBe(path.join(crossbindDir(), 'vcpkg'));
        expect(mod.sourceRoot('vcpkg', 'LOCAL')).toBe(path.join(crossbindDir(), 'vcpkg-local'));
        expect(mod.containerRootOf('vcpkg')).toBe('/var/cache/crossbind/vcpkg');
        expect(work.root).toBe(path.join(crossbindDir(), 'vcpkg'));
        expect(work.toolDir).toBe(`/var/cache/crossbind/vcpkg/work/${path.basename(work.dir)}`);
        expect(work.storePath()).toBe('/var/cache/crossbind/vcpkg/store');
        expect(fs.existsSync(path.join(crossbindDir(), 'conan'))).toBe(false);
    });
});

describe("a package source's probe directory", () => {
    test("is one directory of the source's root that outlives the runs, where a tool of the host is asked what it is", async () => {
        const { mod } = await importFresh();

        const probe = mod.createSourceProbe('conan', 'LOCAL');
        fs.writeFileSync(path.join(probe.dir, '.conanrc'), 'conan_home=./home\n');
        mod.clearSourceWork('conan', 'LOCAL');

        expect(probe.dir).toBe(path.join(crossbindDir(), 'conan-local', 'probe'));
        expect(probe).toMatchObject({ name: 'conan', runner: 'LOCAL', toolDir: probe.dir });
        expect(probe.toolPath('home')).toBe(path.join(probe.dir, 'home'));
        expect(mod.createSourceProbe('conan', 'LOCAL').dir).toBe(probe.dir);
        expect(fs.readFileSync(path.join(probe.dir, '.conanrc'), 'utf8')).toBe('conan_home=./home\n');
    });

    // A staged project's build asks whether each target is still staged, and touches nothing of the home for it.
    test('is only named where an image says what runs: nothing is asked there, so no folder is made', async () => {
        const { mod } = await importFresh();

        const probe = mod.createSourceProbe('conan', 'DOCKER_RUN');

        expect(probe.dir).toBe(path.join(crossbindDir(), 'conan', 'probe'));
        expect(fs.existsSync(path.join(crossbindDir(), 'conan'))).toBe(false);
    });

    test("a tool asked there gets the host's allowlisted environment and no target's tools on its PATH", async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        vi.stubEnv('CC', '/tmp/other-cc');
        vi.stubEnv('CONAN_DEFAULT_PROFILE', 'other');
        vi.stubEnv('DEVELOPER_DIR', '/Applications/Xcode-beta.app/Contents/Developer');
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => ({ status: 0, stdout: 'Conan version 2.33.0\n', stderr: '' }));
        const work = mod.createSourceProbe('conan', 'LOCAL');

        const result = mod.runProbe(['conan', '--version'], { work, env: { CONAN_HOME: work.toolPath('home') } });

        expect(result.stdout).toBe('Conan version 2.33.0\n');
        expect(spawnSync).toHaveBeenCalledTimes(1);
        const [program, args, { env, cwd }] = spawnSync.mock.calls[0];
        expect([program, ...args]).toEqual(['conan', '--version']);
        expect(cwd).toBe(work.dir);
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(env.CC).toBeUndefined();
        expect(env.CONAN_DEFAULT_PROFILE).toBeUndefined();
        expect(env.DEVELOPER_DIR).toBeUndefined();
        expect(fs.existsSync(path.join(work.dir, 'apple-tools'))).toBe(false);
    });

    test('a tool asked there without an env of its own gets the allowlisted one alone', async () => {
        vi.stubEnv('CONAN_HOME', '/elsewhere');
        const { mod, spawnSync } = await importFresh();

        mod.runProbe(['conan', '--version'], { work: mod.createSourceProbe('conan', 'LOCAL') });

        expect(spawnSync.mock.calls[0][2].env.CONAN_HOME).toBeUndefined();
    });
});

describe("a package source's tool on the host", () => {
    test('drops every variable that picks a profile, a compiler or a remote login, and keeps what its source sets', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        vi.stubEnv('CONAN_HOME', '/elsewhere');
        vi.stubEnv('CONAN_DEFAULT_PROFILE', 'other');
        vi.stubEnv('CONAN_LOGIN_USERNAME', 'someone');
        vi.stubEnv('CONAN_PASSWORD', 'secret');
        vi.stubEnv('CC', '/tmp/other-cc');
        vi.stubEnv('CFLAGS', '-O0');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        mod.default(['conan', 'install', '--build=missing'], {
            source: CONAN, config: configWith('LOCAL'), target: wasm, work, env: { CONAN_HOME: work.toolPath('home'), CONAN_NON_INTERACTIVE: '1' },
        });

        expect(spawnSync).toHaveBeenCalledTimes(1);
        const [program, args, options] = spawnSync.mock.calls[0];
        const { env, cwd } = options;
        expect([program, ...args]).toEqual(['conan', 'install', '--build=missing']);
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(env.CONAN_NON_INTERACTIVE).toBe('1');
        expect(env.CONAN_DEFAULT_PROFILE).toBeUndefined();
        expect(env.CONAN_LOGIN_USERNAME).toBeUndefined();
        expect(env.CONAN_PASSWORD).toBeUndefined();
        expect(env.CC).toBeUndefined();
        expect(env.CFLAGS).toBeUndefined();
        expect(env.PATH).toBe(process.env.PATH);
        expect(cwd).toBe(work.dir);
        // A recipe's build log is the whole compiler output of a library.
        expect(options).toMatchObject({ encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    });

    test('a run whose source sets nothing takes no variable of the tool from the shell', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        vi.stubEnv('CONAN_HOME', '/elsewhere');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        mod.default(['conan', 'install'], {
            source: CONAN, config: configWith('LOCAL'), target: wasm, work,
        });

        expect(installCall(spawnSync)[2].env.CONAN_HOME).toBeUndefined();
    });

    test.skipIf(process.platform === 'win32')("on a Mac, puts Xcode's archive tools ahead of a GNU ar on the PATH, for every package the tool builds", async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        install(mod, work, { config: configWith('LOCAL'), target: wasm });

        const { env } = installCall(spawnSync)[2];
        const tools = path.join(work.dir, 'apple-tools');
        const bin = `${XCODE}/Toolchains/XcodeDefault.xctoolchain/usr/bin`;
        expect(env.PATH).toBe(`${tools}${path.delimiter}${process.env.PATH}`);
        expect(linksIn(tools)).toEqual({
            ar: `${bin}/ar`, as: `${bin}/as`, nm: `${bin}/llvm-nm`, ranlib: `${bin}/ranlib`, strip: `${bin}/strip`,
        });
    });

    test.skipIf(process.platform === 'win32')('a macOS package takes the archive tools xcode-select picks, which the Command Line Tools alone also provide', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        const { mod } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        install(mod, work, { config: configWith('DOCKER_RUN'), target: darwin });

        expect(linksIn(path.join(work.dir, 'apple-tools'))).toEqual({
            ar: '/usr/bin/ar', as: '/usr/bin/as', nm: '/usr/bin/nm', ranlib: '/usr/bin/ranlib', strip: '/usr/bin/strip',
        });
    });

    test.skipIf(process.platform === 'win32')('the links are made once for a run, however many times its tool runs', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        install(mod, work, { config: configWith('LOCAL'), target: wasm });
        install(mod, work, { config: configWith('LOCAL'), target: wasm });

        const tools = path.join(work.dir, 'apple-tools');
        expect(spawnSync.mock.calls.map(([, , { env }]) => env.PATH)).toEqual(Array(2).fill(`${tools}${path.delimiter}${process.env.PATH}`));
    });

    test('keeps the proxy, certificate and Emscripten settings a build needs', async () => {
        vi.stubEnv('HTTPS_PROXY', 'http://proxy:3128');
        vi.stubEnv('SSL_CERT_FILE', '/etc/company-ca.pem');
        vi.stubEnv('EMSDK_PYTHON', '/opt/python3.12/bin/python3');
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'LOCAL'), { config: configWith('LOCAL'), target: wasm });

        const { env } = installCall(spawnSync)[2];
        expect(env.HTTPS_PROXY).toBe('http://proxy:3128');
        expect(env.SSL_CERT_FILE).toBe('/etc/company-ca.pem');
        expect(env.EMSDK_PYTHON).toBe('/opt/python3.12/bin/python3');
    });

    test('runs macOS installs with the Xcode xcode-select picks, as the macOS ports are built', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        vi.stubEnv('DEVELOPER_DIR', '/Applications/Xcode-beta.app/Contents/Developer');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        install(mod, work, { config: configWith('DOCKER_RUN'), target: darwin });

        const [program, , { env, cwd }] = installCall(spawnSync);
        expect(program).toBe('conan');
        expect(env.DEVELOPER_DIR).toBeUndefined();
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(cwd).toBe(work.dir);
    });

    test('runs iOS installs with the Xcode every crossbind iOS archive builds with', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        vi.stubEnv('DEVELOPER_DIR', '/Applications/Xcode-beta.app/Contents/Developer');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'LOCAL');

        install(mod, work, { config: configWith('DOCKER_RUN'), target: ios });

        const [program, , { env, cwd }] = installCall(spawnSync);
        expect(program).toBe('conan');
        expect(env.DEVELOPER_DIR).toBe(XCODE);
        expect(env.CONAN_HOME).toBe(path.join(work.dir, 'home'));
        expect(cwd).toBe(work.dir);
    });
});

describe('what a tool on the host cannot build', () => {
    test('android, Linux and Windows packages are refused, which need the toolchain of their image', async () => {
        const { mod, spawnSync } = await importFresh();

        expect(() => mod.assertRunsOnHost('conan', android))
            .toThrow('crossbind: conan packages for android build in the android image, which RUNNER=LOCAL does not use.');
        expect(() => mod.assertRunsOnHost('conan', { platform: 'linuxmusl', arch: 'x64', runtime: 'mt' }))
            .toThrow('crossbind: conan packages for linuxmusl build in the linux image, which RUNNER=LOCAL does not use.');
        expect(() => mod.assertRunsOnHost('vcpkg', { platform: 'win32', arch: 'arm64', runtime: 'mt' }))
            .toThrow('crossbind: vcpkg packages for win32 build in the windows image, which RUNNER=LOCAL does not use.');
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('iOS and macOS packages are refused anywhere but a Mac', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        const { mod, spawnSync } = await importFresh();

        expect(() => mod.assertRunsOnHost('conan', ios)).toThrow('crossbind: conan packages for iOS build with Xcode, on a Mac.');
        expect(() => mod.assertRunsOnHost('conan', darwin)).toThrow('crossbind: conan packages for macOS build with Xcode, on a Mac.');
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('wasm packages build anywhere with a host Emscripten, and the Apple ones on a Mac', async () => {
        const { mod } = await importFresh();

        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });
        expect(() => mod.assertRunsOnHost('conan', wasm)).not.toThrow();
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        expect(() => mod.assertRunsOnHost('conan', ios)).not.toThrow();
        expect(() => mod.assertRunsOnHost('conan', darwin)).not.toThrow();
    });
});

describe('what a remote runner sends back of a store', () => {
    test('a source that names no folder of its store is refused there, as none of its packages would come back', async () => {
        const { mod, spawnSync } = await importFresh();

        expect(() => mod.assertRunsRemotely(VCPKG))
            .toThrow("crossbind: vcpkg names no storeUnits, so a remote runner would send none of its packages back: name the folders of its store that never change once written, as 'p/*/p', or build with another RUNNER.");
        expect(() => mod.assertRunsRemotely(CONAN)).not.toThrow();
        expect(spawnSync).not.toHaveBeenCalled();
    });
});

describe('the compiler a tool on the host builds with', () => {
    const answering = (spawnSync) => spawnSync.mockImplementation((program, args, { env }) => ({
        status: 0, stdout: `${[program, ...args].join(' ')} ${env.DEVELOPER_DIR ?? ''}\nmore\n`, stderr: '',
    }));

    test('is the emcc of the PATH for a wasm package, asked once', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation((program) => ({ status: 0, stdout: `${program} 1.2.3\nmore\n`, stderr: '' }));

        expect(mod.localCompilerIdentity()).toBe('emcc 1.2.3');
        expect(mod.localCompilerIdentity(wasm)).toBe('emcc 1.2.3');

        expect(spawnSync).toHaveBeenCalledTimes(1);
        expect(spawnSync.mock.calls[0].slice(0, 2)).toEqual(['emcc', ['--version']]);
    });

    test('is the Xcode clang for an iOS package', async () => {
        const { mod, spawnSync } = await importFresh();
        answering(spawnSync);

        expect(mod.localCompilerIdentity(ios)).toBe(`xcrun clang --version ${XCODE}`);
    });

    test('is the clang xcode-select picks for a macOS package', async () => {
        vi.stubEnv('DEVELOPER_DIR', '/Applications/Xcode-beta.app/Contents/Developer');
        const { mod, spawnSync } = await importFresh();
        answering(spawnSync);

        expect(mod.localCompilerIdentity(darwin)).toBe('/usr/bin/clang --version');
    });

    test('is asked once for each platform', async () => {
        const { mod, spawnSync } = await importFresh();
        answering(spawnSync);

        [wasm, ios, darwin, wasm, ios, darwin].forEach((target) => mod.localCompilerIdentity(target));

        expect(spawnSync.mock.calls.map(([program]) => program)).toEqual(['emcc', 'xcrun', '/usr/bin/clang']);
    });

    test('is nothing where the compiler is missing', async () => {
        const { mod, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => ({ status: null, error: new Error('spawnSync emcc ENOENT') }));

        expect(mod.localCompilerIdentity(wasm)).toBe('');
    });
});

describe("a package source's tool in docker", () => {
    test('mounts the store and its work directory, and nothing of the project', async () => {
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        install(mod, work, { config: configWith('DOCKER_RUN'), target: wasm, args: ['-pr:h', work.toolPath('host.profile')] });

        const [program, argv] = spawnSync.mock.calls[0];
        expect(program).toBe('docker');
        expect(argv.slice(0, 2)).toEqual(['run', '--rm']);
        expect(argv).toEqual(expect.arrayContaining(['--cap-drop', 'ALL', '--security-opt', 'no-new-privileges=true', '--workdir', work.toolDir]));
        expect(mountsOf(argv)).toEqual([`${work.store}:/var/cache/crossbind/conan/store`, `${work.dir}:${work.toolDir}`]);
        expect(argv.join(' ')).toContain(`-e CONAN_HOME=${work.toolDir}/home`);
        expect(argv.join(' ')).not.toContain('/repo');
        const conanAt = argv.indexOf('conan');
        expect(argv[conanAt - 1]).toMatch(/^ghcr\.io\/crossbind\/web@sha256:[0-9a-f]{64}$/);
        expect(argv.slice(conanAt)).toEqual(['conan', 'install', '-pr:h', `${work.toolDir}/host.profile`]);
    });

    test('hands the tool every variable its source sets, and none of the shell', async () => {
        vi.stubEnv('CONAN_DEFAULT_PROFILE', 'other');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        mod.default(['conan', 'install'], {
            source: CONAN, config: configWith('DOCKER_RUN'), target: wasm, work, env: { CONAN_HOME: work.toolPath('home'), CONAN_NON_INTERACTIVE: '1' },
        });

        const argv = spawnSync.mock.calls[0][1];
        expect(argv.flatMap((arg, i) => (argv[i - 1] === '-e' ? [arg] : []))).toEqual([`CONAN_HOME=${work.toolDir}/home`, 'CONAN_NON_INTERACTIVE=1']);
    });

    test('android packages build in the amd64 android image, the only one the NDK ships for', async () => {
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        install(mod, work, { config: configWith('DOCKER_RUN'), target: android });

        const argv = installCall(spawnSync)[1];
        expect(argv[argv.indexOf('--platform') + 1]).toBe('linux/amd64');
        expect(argv[argv.indexOf('conan') - 1]).toMatch(/^ghcr\.io\/crossbind\/android@sha256:[0-9a-f]{64}$/);
    });

    test('glibc and musl packages build in the linux image of the machine', async () => {
        vi.stubEnv('CROSSBIND_IMAGE_LINUX', '');
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'DOCKER_RUN'), { config: configWith('DOCKER_RUN'), target: { platform: 'linuxmusl', arch: 'x64', runtime: 'mt' } });

        const argv = installCall(spawnSync)[1];
        expect(argv).not.toContain('--platform');
        expect(argv[argv.indexOf('conan') - 1]).toMatch(/^ghcr\.io\/crossbind\/linux@sha256:[0-9a-f]{64}$/);
    });

    test('Windows packages build in the windows image of the machine', async () => {
        vi.stubEnv('CROSSBIND_IMAGE_WINDOWS', '');
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'DOCKER_RUN'), { config: configWith('DOCKER_RUN'), target: { platform: 'win32', arch: 'arm64', runtime: 'mt' } });

        const argv = installCall(spawnSync)[1];
        expect(argv).not.toContain('--platform');
        expect(argv[argv.indexOf('conan') - 1]).toMatch(/^ghcr\.io\/crossbind\/windows@sha256:[0-9a-f]{64}$/);
    });

    test('a wasm install passes no platform', async () => {
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'DOCKER_RUN'), { config: configWith('DOCKER_RUN'), target: wasm });

        expect(installCall(spawnSync)[1]).not.toContain('--platform');
    });

    test('a source of another name mounts the store and work directory of its own', async () => {
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('vcpkg', 'DOCKER_RUN');

        mod.default(['vcpkg', 'install'], {
            source: VCPKG, config: configWith('DOCKER_RUN'), target: wasm, work,
        });

        const argv = spawnSync.mock.calls[0][1];
        expect(mountsOf(argv)).toEqual([`${work.store}:/var/cache/crossbind/vcpkg/store`, `${work.dir}:/var/cache/crossbind/vcpkg/work/${path.basename(work.dir)}`]);
        expect(argv).not.toContain('-e');
        expect(argv.slice(-2)).toEqual(['vcpkg', 'install']);
    });

    test("DOCKER_EXEC runs the tool in the container that mounts the source's root", async () => {
        const { mod, spawnSync, execFileSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_EXEC');
        inspectReturning(execFileSync, [
            { Destination: '/tmp/crossbind/live', Source: '/repo' },
            { Destination: '/var/cache/crossbind/conan', Source: work.root },
        ]);

        install(mod, work, { config: configWith('DOCKER_EXEC'), target: wasm });

        const argv = spawnSync.mock.calls[0][1];
        expect(argv[0]).toBe('exec');
        expect(argv[argv.indexOf('--workdir') + 1]).toBe(work.toolDir);
        expect(argv[argv.indexOf('-e') + 1]).toBe(`CONAN_HOME=${work.toolDir}/home`);
        expect(argv).not.toContain('-v');
        expect(argv.slice(-2)).toEqual(['conan', 'install']);
        expect(argv.at(-3)).toMatch(/^crossbind-.*-web-/);
    });

    test("DOCKER_EXEC names the commands that recreate a container made before the source's mount", async () => {
        const { mod, spawnSync, execFileSync } = await importFresh();
        inspectReturning(execFileSync, [{ Destination: '/tmp/crossbind/live', Source: '/repo' }]);
        const work = mod.createSourceWork('conan', 'DOCKER_EXEC');

        expect(() => install(mod, work, { config: configWith('DOCKER_EXEC'), target: wasm }))
            .toThrow(/does not mount[\s\S]*var\/cache\/crossbind\/conan\. It predates the conan mount\.[\s\S]*crossbind docker stop web[\s\S]*crossbind docker create web/);
        expect(() => install(mod, work, { config: configWith('DOCKER_EXEC'), target: wasm }))
            .toThrow(`which mount ${work.root} at /var/cache/crossbind/conan.`);
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test("DOCKER_EXEC asks the container for the root of the source it runs, by that source's name", async () => {
        const { mod, execFileSync } = await importFresh();
        inspectReturning(execFileSync, [{ Destination: '/var/cache/crossbind/conan', Source: path.join(crossbindDir(), 'conan') }]);
        const work = mod.createSourceWork('vcpkg', 'DOCKER_EXEC');

        expect(() => mod.default(['vcpkg', 'install'], {
            source: VCPKG, config: configWith('DOCKER_EXEC'), target: wasm, work,
        })).toThrow(/does not mount .*vcpkg at \/var\/cache\/crossbind\/vcpkg\. It predates the vcpkg mount\./);
    });
});

describe("a package source's tool on a remote runner", () => {
    test("sends the run to the runner of the package's image with the store and its work directory, and nothing of the project", async () => {
        vi.stubEnv('CROSSBIND_TOKEN_WEB', 'web-token');
        const { mod, spawnSync } = await importFresh();
        const work = mod.createSourceWork('conan', 'REMOTE');

        install(mod, work, { config: remoteConfig(), target: wasm });

        const [program, [client, payloadText], options] = spawnSync.mock.calls[0];
        const payload = JSON.parse(payloadText);
        expect(program).toBe(process.execPath);
        expect(client).toMatch(/remoteClient\.js$/);
        expect(payload.url).toBe('https://web.example');
        expect(options.env.CROSSBIND_TOKEN).toBe('web-token');
        expect(payload.role).toBe('web');
        expect(payload.image).toMatch(/^ghcr\.io\/crossbind\/web@sha256:[0-9a-f]{64}$/);
        expect(payload.mounts.map(({ host, container }) => [host, container]))
            .toEqual([[work.store, '/var/cache/crossbind/conan/store'], [work.dir, work.toolDir]]);
        expect(payload.cwd).toBe(work.toolDir);
        expect(payload.argv).toEqual(['conan', 'install']);
        expect(payload.env).toEqual({ CONAN_HOME: `${work.toolDir}/home` });
        expect(payloadText).not.toContain('/repo');
    });

    test('the work directory travels both ways, and of the store only the folders the source names come back', async () => {
        vi.stubEnv('CROSSBIND_TOKEN_WEB', 'web-token');
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'REMOTE'), { config: remoteConfig(), target: wasm });
        mod.default(['vcpkg', 'install'], {
            source: VCPKG, config: remoteConfig(), target: wasm, work: mod.createSourceWork('vcpkg', 'REMOTE'),
        });

        const [conan, vcpkg] = spawnSync.mock.calls.map(([, [, payloadText]]) => JSON.parse(payloadText));
        expect(conan.mounts.map(({ inputRoots, outputRoots }) => ({ inputRoots, outputRoots }))).toEqual([
            { inputRoots: [], outputRoots: ['p/*/p', 'b/*/p'] },
            { inputRoots: ['.'], outputRoots: ['.'] },
        ]);
        expect(vcpkg.mounts[0]).toMatchObject({ container: '/var/cache/crossbind/vcpkg/store', inputRoots: [], outputRoots: [] });
        expect(vcpkg.env).toEqual({});
    });

    test("stops the run before it starts when the package's image has no runner address", async () => {
        const { mod, spawnSync } = await importFresh();

        expect(() => install(mod, mod.createSourceWork('conan', 'REMOTE'), { config: remoteConfig(), target: { platform: 'android', arch: 'x86_64', runtime: 'st' } }))
            .toThrow(/the android image has no runner address - set REMOTE_URL_ANDROID/);
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('a runner address alone keeps the tool in the local Docker', async () => {
        vi.stubEnv('CROSSBIND_REMOTE_URL_WEB', 'https://web.example');
        vi.stubEnv('CROSSBIND_TOKEN_WEB', 'web-token');
        const { mod, spawnSync } = await importFresh();

        install(mod, mod.createSourceWork('conan', 'DOCKER_RUN'), { config: configWith('DOCKER_RUN'), target: wasm });

        expect(spawnSync.mock.calls[0][0]).toBe('docker');
    });
});

describe('mapping the paths a tool reports back to the host', () => {
    test("a path under the mounts maps onto the source's root", async () => {
        const { mod } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        expect(mod.toHostPath('/var/cache/crossbind/conan/store/b/zlib1/p/include', work))
            .toBe(path.join(work.root, 'store', 'b', 'zlib1', 'p', 'include'));
        expect(mod.toHostPath(work.toolPath('output', 'x.json'), work)).toBe(path.join(work.dir, 'output', 'x.json'));
    });

    test('a path that climbs out of the mounts or was never in them is refused', async () => {
        const { mod } = await importFresh();
        const work = mod.createSourceWork('conan', 'DOCKER_RUN');

        [
            '/var/cache/crossbind/conan/store/b/x/p/../../../../../../.ssh',
            '/var/cache/crossbind/conan/store/p/x\\..\\..\\..\\..\\Windows',
            '/tmp/crossbind/live/app/x.h',
            '/usr/include',
            '/var/cache/crossbind/conan',
            '/var/cache/crossbind/conan-local/store/p/x',
        ].forEach((reported) => expect(() => mod.toHostPath(reported, work), reported).toThrow(/outside the directories crossbind mounts/));
        expect(() => mod.toHostPath('/usr/include', work))
            .toThrow('crossbind: conan reported "/usr/include", outside the directories crossbind mounts for it.');
        expect(() => mod.toHostPath('/var/cache/crossbind/conan/store/p/x\\..\\y', work))
            .toThrow('crossbind: conan reported "/var/cache/crossbind/conan/store/p/x\\\\..\\\\y", outside the directories crossbind mounts for it.');
    });

    test("a path under another source's mounts is none of this one's", async () => {
        const { mod } = await importFresh();
        const work = mod.createSourceWork('vcpkg', 'DOCKER_RUN');

        expect(mod.toHostPath('/var/cache/crossbind/vcpkg/store/x/include', work)).toBe(path.join(work.root, 'store', 'x', 'include'));
        expect(() => mod.toHostPath('/var/cache/crossbind/conan/store/p/x', work))
            .toThrow('crossbind: vcpkg reported "/var/cache/crossbind/conan/store/p/x", outside the directories crossbind mounts for it.');
    });

    test('on the host a reported path is only normalised', async () => {
        const { mod } = await importFresh();

        expect(mod.toHostPath('/store/b/x/p/../include', { runner: 'LOCAL' })).toBe(path.resolve('/store/b/x/include'));
    });
});
