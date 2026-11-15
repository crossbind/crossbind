import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { run, state, getData } = vi.hoisted(() => ({
    run: vi.fn(),
    state: { config: {}, targets: [] },
    getData: vi.fn(),
}));

vi.mock('../src/actions/run.js', () => ({ default: run }));
vi.mock('../src/actions/getDependLibs.js', () => ({ default: () => ['/deps/libz.a'] }));
vi.mock('../src/actions/getData.js', () => ({ default: getData }));
vi.mock('../src/utils/appRustCrates.js', () => ({ default: () => [] }));
vi.mock('../src/utils/logger.js', () => ({
    default: { info() {}, error() {}, startStep() {}, doneStep() {}, cachedStep() {} },
}));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: buildNativeCommand } = await import('../src/actions/buildNativeCommand.js');

const targetOf = (platform, arch = 'x64') => ({
    platform,
    arch,
    runtime: 'mt',
    buildType: 'release',
    runtimeEnv: 'native',
    path: `${platform}-${arch}-mt-release`,
    commandName: `demo.${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`,
});

const configureOf = () => run.mock.calls.map(([, args]) => args).find((args) => args[1] !== '--build');
const defineOf = (args, key) => args.find((arg) => String(arg).startsWith(`-D${key}=`))?.slice(key.length + 3);

describe('buildNativeCommand', () => {
    const hostPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    let work;

    beforeEach(() => {
        // A macOS executable links on a macOS host only; these tests describe that link on any host.
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'darwin' });
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-native-command-'));
        state.config = {
            export: {},
            general: { name: 'demo' },
            paths: { build: work, output: `${work}/out` },
            dependencyParameters: { getCmakeDepends: () => [] },
        };
        getData.mockReset();
        getData.mockReturnValue({});
        run.mockReset();
        run.mockImplementation((program, args, prefix, calledTarget) => {
            if (args[1] === '--build') {
                const dir = `${work}/${prefix}/${calledTarget.path}`;
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(`${dir}/${calledTarget.commandName}`, 'executable');
            }
        });
    });

    afterEach(() => {
        Object.defineProperty(process, 'platform', hostPlatform);
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('links main() from the project archive, kept whole, and no bridge', async () => {
        expect(await buildNativeCommand(targetOf('linux'), { force: true })).toBe(true);

        const configure = configureOf();
        expect(defineOf(configure, 'CMAKE_BUILD_TYPE')).toBe('Release');
        expect(defineOf(configure, 'CROSSBIND_COMMAND_FILE')).toBe('demo.linux-x64');
        expect(defineOf(configure, 'CROSSBIND_LINK_ARGS')).toBe([
            '/deps/libz.a',
            '-Wl,--whole-archive',
            `${work}/Source-Release/linux-x64-mt-release/libdemo.a`,
            '-Wl,--no-whole-archive',
        ].join(';'));
        expect(defineOf(configure, 'CROSSBIND_STATIC')).toBe('OFF');
        const cmakeCalls = run.mock.calls.filter(([, args]) => args[0] === 'cmake');
        expect(cmakeCalls).toHaveLength(2);
        expect(cmakeCalls.every(([program, , prefix]) => program === null && prefix === 'Native-Release')).toBe(true);
        expect(fs.readFileSync(`${work}/demo.linux-x64`, 'utf8')).toBe('executable');
    });

    test('compiles the command in turn with other builds, configuring it freely', async () => {
        await buildNativeCommand(targetOf('linux'), { force: true });

        const optionsOf = (isStep) => run.mock.calls.find(([, args]) => isStep(args))?.[4];
        expect(optionsOf((args) => args[1] === '--build')).toEqual({ exclusive: true });
        expect(optionsOf((args) => args[1] !== '--build')).toBeUndefined();
    });

    test('links a musl executable statically, so one binary runs on every Linux', async () => {
        await buildNativeCommand(targetOf('linuxmusl'), { force: true });

        expect(defineOf(configureOf(), 'CROSSBIND_STATIC')).toBe('ON');
    });

    test('keeps the runtime notices a Windows executable takes from its toolchain image', async () => {
        const win32 = targetOf('win32');

        await buildNativeCommand(win32, { force: true });

        const copy = run.mock.calls.find(([, args]) => args.join(' ').includes('/opt/licenses/llvm-mingw'));
        expect(copy[1].join(' ')).toContain('toolchain-licenses/win32');
        expect(copy[2]).toBeNull();
        expect(copy[3]).toBe(win32);
    });

    test("keeps, for a static musl executable, musl's notice beside the C++ runtime's", async () => {
        const musl = targetOf('linuxmusl');

        await buildNativeCommand(musl, { force: true });

        const copy = run.mock.calls.find(([program]) => program === 'sh');
        expect(copy[1].join(' ')).toContain('toolchain-licenses/linuxmusl/libcxx-version.txt');
        expect(copy[1].join(' ')).toContain('toolchain-licenses/linuxmusl/musl-COPYRIGHT');
        expect(copy[3]).toBe(musl);
    });

    test('force-loads the project archive on macOS and adds the system libraries packages declare', async () => {
        getData.mockImplementation((key) => (key === 'binary' ? { addonFlags: ['-lxml2'] } : {}));

        await buildNativeCommand(targetOf('darwin', 'arm64'), { force: true });

        expect(defineOf(configureOf(), 'CROSSBIND_LINK_ARGS')).toBe([
            '/deps/libz.a',
            `-Wl,-force_load,${work}/Source-Release/darwin-arm64-mt-release/libdemo.a`,
            '-lxml2',
        ].join(';'));
    });

    test('leaves a macOS executable to a macOS host', async () => {
        Object.defineProperty(process, 'platform', { ...hostPlatform, value: 'linux' });

        expect(await buildNativeCommand(targetOf('darwin', 'arm64'), { force: true })).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test('skips cargo packages, which ship only their staticlib', async () => {
        state.config.export = { type: 'cargo' };

        expect(await buildNativeCommand(targetOf('linux'), { force: true })).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    test('relinks only when an input changes', async () => {
        const target = targetOf('linux');
        await buildNativeCommand(target, { force: true });
        run.mockClear();

        expect(await buildNativeCommand(target)).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });

    // A project copied or moved after a build keeps a build tree that names its old place, which CMake refuses.
    test('configures afresh a build tree another project directory configured', async () => {
        const target = targetOf('darwin', 'arm64');
        const tree = `${work}/Native-Release/${target.path}`;
        fs.mkdirSync(`${tree}/CMakeFiles`, { recursive: true });
        fs.writeFileSync(`${tree}/CMakeCache.txt`, 'CMAKE_HOME_DIRECTORY:INTERNAL=/old/place/.crossbind/build/crossbind-command\n');

        await buildNativeCommand(target, { force: true });

        expect(fs.existsSync(`${tree}/CMakeCache.txt`)).toBe(false);
        expect(fs.existsSync(`${tree}/CMakeFiles`)).toBe(false);
    });

    test('keeps a build tree this project directory configured', async () => {
        const target = targetOf('darwin', 'arm64');
        const tree = `${work}/Native-Release/${target.path}`;
        fs.mkdirSync(tree, { recursive: true });
        fs.writeFileSync(`${tree}/CMakeCache.txt`, `CMAKE_HOME_DIRECTORY:INTERNAL=${work}/crossbind-command\n`);

        await buildNativeCommand(target, { force: true });

        expect(fs.existsSync(`${tree}/CMakeCache.txt`)).toBe(true);
    });

    test('stages the command project inside the build directory, which a docker build can read', async () => {
        await buildNativeCommand(targetOf('linux'), { force: true });

        const [, projectDir] = configureOf();
        expect(projectDir.startsWith(work)).toBe(true);
        expect(fs.existsSync(`${projectDir}/CMakeLists.txt`)).toBe(true);
    });
});
