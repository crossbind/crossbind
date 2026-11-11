import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import { targetToolchain } from '../src/utils/targetToolchain.js';
import { normalizeConanDependencies } from '../../../extensions/conan/src/dependencies.js';
import { hostProfile } from '../../../extensions/conan/src/profile.js';

const h = vi.hoisted(() => ({
    result: null, lock: null, graph: undefined, seen: [], onRun: null, identity: null,
}));
vi.mock('../src/utils/runPackageSource.js', async (importOriginal) => ({
    ...await importOriginal(),
    default: vi.fn(),
    runProbe: vi.fn(),
    localCompilerIdentity: () => h.identity,
    assertRunsOnHost: vi.fn(),
}));

const CLI = upath.normalize(fileURLToPath(new URL('../src', import.meta.url)));
const TARGET = {
    platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasm-wasm32-st-release',
};
const LOCK = { version: '0.5', requires: ['libpng/1.6.58#19cb72905ae54f54948401f753faa2c1%1776606503.628'] };
const LOCK_TEXT = `${JSON.stringify(LOCK, null, 4)}\n`;

let scratch;
let project;
// crossbind's own sources, loaded again for each test: the conan source keeps what it asked its tool.
let sources;
const storeOf = (source) => upath.join(scratch, 'home', '.crossbind', `${source}-local`, 'store');
const stageOf = (source) => upath.join(project, '.crossbind', source);
const stageDir = () => stageOf('conan');
const pathsOf = () => ({
    project, cache: upath.join(project, '.crossbind'), base: project, cli: CLI,
});
const configWith = (conan) => ({
    packageSources: sources,
    packages: { conan: normalizeConanDependencies(conan) },
    system: { RUNNER: 'LOCAL' },
    paths: pathsOf(),
});

function writePackage(name, files, source = 'conan') {
    Object.entries(files).forEach(([file, content]) => {
        const full = upath.join(storeOf(source), 'p', name, 'p', file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    });
}

function graphOf() {
    const folder = (name) => upath.join(storeOf('conan'), 'p', name, 'p');
    const node = (name, version, libs, dependencies = {}) => ({
        ref: `${name}/${version}#0123456789abcdef0123456789abcdef`,
        name,
        version,
        context: 'host',
        test: false,
        binary: 'Cache',
        recipe: 'Downloaded',
        license: 'Zlib',
        package_folder: folder(name),
        cpp_info: { root: { includedirs: [`${folder(name)}/include`], libdirs: [`${folder(name)}/lib`], libs } },
        dependencies,
    });
    return {
        root: { 0: 'None' },
        nodes: {
            0: { ref: 'conanfile', recipe: 'Cli', context: 'host', dependencies: { 1: { build: false }, 2: { build: false } } },
            1: node('libpng', '1.6.58', ['png'], { 2: { build: false } }),
            2: node('zlib', '1.3.2', ['z']),
        },
    };
}

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

// What conan install leaves in its work directory, written where its arguments say.
function conanInstall(command, { work }) {
    h.seen.push({
        work: work.dir,
        hostProfile: fs.readFileSync(argAfter(command, '-pr:h'), 'utf8'),
        inputLock: command.includes('--lockfile') ? fs.readFileSync(argAfter(command, '--lockfile'), 'utf8') : null,
    });
    fs.writeFileSync(argAfter(command, '--lockfile-out'), h.lock ?? LOCK_TEXT);
    const graph = h.graph === undefined ? JSON.stringify({ graph: graphOf() }) : h.graph;
    if (graph !== null) fs.writeFileSync(argAfter(command, '--out-file'), graph);
    h.onRun?.(work);
    return h.result ?? { status: 0, stdout: 'a build tool writing to stdout\n', stderr: 'built libpng\n' };
}

async function importFresh() {
    vi.resetModules();
    const runner = await import('../src/utils/runPackageSource.js');
    const { default: run, runProbe, assertRunsOnHost } = runner;
    [run, runProbe, assertRunsOnHost].forEach((mock) => mock.mockReset());
    run.mockImplementation(conanInstall);
    runProbe.mockImplementation(() => ({ status: 0, stdout: 'Conan version 2.33.0\n', stderr: '' }));
    sources = (await import('../src/utils/packageSources.js')).packageSourcesOf([]);
    const { default: installPackageSources } = await import('../src/utils/packageSourceInstall.js');
    return {
        installPackageSources, run, runProbe, assertRunsOnHost,
    };
}

beforeEach(() => {
    scratch = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-source-install-')));
    project = upath.join(scratch, 'app');
    fs.mkdirSync(project, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(upath.join(scratch, 'home'));
    h.result = null;
    h.lock = null;
    h.graph = undefined;
    h.onRun = null;
    h.seen = [];
    h.identity = 'emcc 4.0.0';
    writePackage('libpng', { 'include/png.h': '/* png */', 'lib/libpng.a': 'png archive', 'licenses/LICENSE': 'libpng license' });
    writePackage('zlib', { 'include/zlib.h': '/* zlib */', 'lib/libz.a': 'z archive' });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(scratch, { recursive: true, force: true });
});

describe('installing the declared Conan packages', () => {
    test('runs conan install in a work directory of its own and stages every package of the graph', async () => {
        const { installPackageSources, run } = await importFresh();

        expect(await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).toBe(true);

        const [command, { target }] = run.mock.calls[0];
        expect(target).toBe(TARGET);
        expect(command).toEqual(expect.arrayContaining(['conan', 'install', '--requires', 'libpng/1.6.58', '--build=missing', '--format=json', '--lockfile=']));
        expect(argAfter(command, '-pr:h')).toBe(path.join(h.seen[0].work, 'host.profile'));
        expect(argAfter(command, '--output-folder')).toBe(path.join(h.seen[0].work, 'output'));
        expect(argAfter(command, '--out-file')).toBe(path.join(h.seen[0].work, 'graph.json'));
        expect(h.seen[0].hostProfile).toBe(hostProfile(targetToolchain(TARGET)));
        expect(fs.existsSync(h.seen[0].work)).toBe(false);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'libpng', 'dist', 'prebuilt', TARGET.path, 'lib', 'libpng.a'))).toBe(true);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'include', 'zlib.h'))).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(upath.join(stageDir(), 'manifests', `${TARGET.path}.json`), 'utf8'));
        expect(manifest.packages.map((p) => p.name)).toEqual(['libpng', 'zlib']);
        expect(manifest.packages[0]).not.toHaveProperty('packageFolder');
        expect(fs.readFileSync(upath.join(stageDir(), 'logs', `${TARGET.path}.log`), 'utf8')).toBe('built libpng\n');
    });

    test.each([
        ['iOS', {
            platform: 'ios', arch: 'iphoneos', runtime: 'mt', buildType: 'release', path: 'ios-iphoneos-mt-release',
        }],
        ['macOS', {
            platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'release', path: 'darwin-arm64-mt-release',
        }],
    ])('%s packages build with the host conan and its store whatever runner the project uses', async (name, target) => {
        const { installPackageSources, run, assertRunsOnHost } = await importFresh();

        let settingsUser;
        h.onRun = (work) => {
            settingsUser = fs.readFileSync(path.join(work.dir, 'home', 'settings_user.yml'), 'utf8');
        };

        await installPackageSources({ ...configWith({ libpng: '1.6.58' }), system: { RUNNER: 'DOCKER_RUN' } }, [target]);

        expect(run.mock.calls[0][1].work.runner).toBe('LOCAL');
        expect(assertRunsOnHost).toHaveBeenCalledWith('conan', target);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt', target.path, 'lib', 'libz.a'))).toBe(true);
        expect(settingsUser).toBe('compiler:\n  apple-clang:\n    version: ["ANY"]\n');
    });

    test('a wasm install keeps the settings its Conan release ships', async () => {
        const { installPackageSources } = await importFresh();
        let hasSettingsUser;
        h.onRun = (work) => {
            hasSettingsUser = fs.existsSync(path.join(work.dir, 'home', 'settings_user.yml'));
        };

        await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET]);

        expect(hasSettingsUser).toBe(false);
    });

    test('writes the resolution to conan.lock beside the config', async () => {
        const { installPackageSources } = await importFresh();

        await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET]);

        expect(fs.readFileSync(upath.join(project, 'conan.lock'), 'utf8')).toBe(LOCK_TEXT);
    });

    test('a resolution that is no lockfile stays out of the project', async () => {
        const { installPackageSources } = await importFresh();
        h.lock = 'not json';

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/no lockfile crossbind can read/);
        expect(fs.existsSync(upath.join(project, 'conan.lock'))).toBe(false);
    });

    test('a staged target with nothing changed runs no conan', async () => {
        const { installPackageSources, run } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });

        await installPackageSources(config, [TARGET]);

        expect(await installPackageSources(config, [TARGET])).toBe(false);
        expect(run).toHaveBeenCalledTimes(1);
    });

    test('an existing conan.lock pins what it resolved and lets a new requirement in', async () => {
        fs.writeFileSync(upath.join(project, 'conan.lock'), LOCK_TEXT);
        const { installPackageSources, run } = await importFresh();

        await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET]);

        const command = run.mock.calls[0][0];
        expect(argAfter(command, '--lockfile')).toBe(path.join(h.seen[0].work, 'input.lock'));
        expect(command).toContain('--lockfile-partial');
        expect(h.seen[0].inputLock).toBe(LOCK_TEXT);
    });

    test('a changed packages.conan stages again', async () => {
        const { installPackageSources, run } = await importFresh();

        await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET]);
        await installPackageSources(configWith({ libpng: '1.6.57' }), [TARGET]);

        expect(run).toHaveBeenCalledTimes(2);
    });

    test('a conan.lock changed since the last install stages again, from the new one', async () => {
        const { installPackageSources, run } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        await installPackageSources(config, [TARGET]);
        const edited = `${JSON.stringify({ ...LOCK, requires: [...LOCK.requires, 'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb%1776606503.628'] }, null, 4)}\n`;
        fs.writeFileSync(upath.join(project, 'conan.lock'), edited);

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(run).toHaveBeenCalledTimes(2);
        expect(h.seen[1].inputLock).toBe(edited);
    });

    test('another compiler on the host stages again', async () => {
        const { installPackageSources, run } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        await installPackageSources(config, [TARGET]);
        h.identity = 'emcc 4.0.1';

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(run).toHaveBeenCalledTimes(2);
    });

    test('a stamped target whose manifest was replaced stages again', async () => {
        const { installPackageSources, run } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        await installPackageSources(config, [TARGET]);
        fs.writeFileSync(upath.join(stageDir(), 'manifests', `${TARGET.path}.json`), JSON.stringify({ key: 'other dependencies', packages: [] }));

        expect(await installPackageSources(config, [TARGET])).toBe(true);
        expect(run).toHaveBeenCalledTimes(2);
    });

    test('a restage that fails leaves the target unstaged', async () => {
        const { installPackageSources, run } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        const stamp = upath.join(stageDir(), 'stamps', `${TARGET.path}.json`);
        await installPackageSources(config, [TARGET]);
        const hadStamp = fs.existsSync(stamp);
        h.result = { status: 1, stdout: '', stderr: 'ERROR: interrupted' };

        await expect(installPackageSources(configWith({ libpng: '1.6.57' }), [TARGET])).rejects.toThrow(/exit code 1/);
        const hasStampAfterFailure = fs.existsSync(stamp);
        h.result = null;
        await installPackageSources(config, [TARGET]);

        expect(hadStamp).toBe(true);
        expect(hasStampAfterFailure).toBe(false);
        expect(run).toHaveBeenCalledTimes(3);
    });

    test('a failed install reports the end of the conan log without its escape sequences, and keeps the whole log', async () => {
        const { installPackageSources } = await importFresh();
        h.result = { status: 1, stdout: '', stderr: 'Computing dependency graph\n\u001b[31mERROR: Package \'libpng/9.9.9\' not resolved\u001b[0m' };

        const error = await installPackageSources(configWith({ libpng: '9.9.9' }), [TARGET]).catch((e) => e);

        expect(error.message).toMatch(/^crossbind: conan install for wasm-wasm32-st-release failed \(exit code 1\)\. Its whole log is in /);
        expect(error.message).toMatch(/libpng\/9\.9\.9' not resolved/);
        expect(error.message).not.toContain('\u001b');
        const log = upath.join(stageDir(), 'logs', `${TARGET.path}.log`);
        expect(error.message).toContain(log);
        expect(fs.readFileSync(log, 'utf8')).toBe(h.result.stderr);
    });

    test('a graph conan did not write stops the install, naming the log', async () => {
        const { installPackageSources } = await importFresh();
        h.graph = null;

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/wrote no graph crossbind can read\. Its log is in .*\.log/);
    });

    test.skipIf(process.platform === 'win32')('a failed run that left a read-only directory is cleaned up and reports its own error', async () => {
        const { installPackageSources } = await importFresh();
        h.result = { status: 1, stdout: '', stderr: 'ERROR: the recipe failed' };
        h.onRun = (work) => {
            fs.mkdirSync(path.join(work.dir, 'output', 'locked'), { recursive: true });
            fs.chmodSync(path.join(work.dir, 'output', 'locked'), 0o555);
        };

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/the recipe failed/);
        expect(fs.existsSync(h.seen[0].work)).toBe(false);
    });

    test('what a killed run left is cleared by the next install', async () => {
        const leftover = upath.join(scratch, 'home', '.crossbind', 'conan-local', 'work', 'run-killed');
        fs.mkdirSync(upath.join(leftover, 'output'), { recursive: true });
        const { installPackageSources } = await importFresh();

        await installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET]);

        expect(fs.existsSync(leftover)).toBe(false);
    });

    test('a conan stopped by a signal says so', async () => {
        const { installPackageSources } = await importFresh();
        h.result = {
            status: null, signal: 'SIGKILL', stdout: '', stderr: '',
        };

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/was stopped by SIGKILL/);
    });

    test('a project that declares no package runs nothing', async () => {
        const { installPackageSources, run, runProbe } = await importFresh();

        expect(await installPackageSources(configWith(undefined), [TARGET])).toBe(false);
        expect(run).not.toHaveBeenCalled();
        expect(runProbe).not.toHaveBeenCalled();
    });

    test('a target crossbind names no toolchain for is refused, with the platforms that have one', async () => {
        const { installPackageSources, run } = await importFresh();
        const wasi = {
            platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasi-wasm32-st-release',
        };

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [wasi])).rejects.toThrow(
            'crossbind: conan: imports build for wasm, android, ios, linux, linuxmusl, darwin and win32 so far; wasi is not supported yet, so its build cannot use packages.conan.',
        );
        expect(run).not.toHaveBeenCalled();
    });

    test('a target the host cannot build is refused before anything of the install runs', async () => {
        const { installPackageSources, run, assertRunsOnHost } = await importFresh();
        assertRunsOnHost.mockImplementation(() => {
            throw new Error('crossbind: conan packages for android build in the android image, which RUNNER=LOCAL does not use.');
        });

        await expect(installPackageSources(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/build in the android image, which RUNNER=LOCAL does not use/);

        expect(assertRunsOnHost).toHaveBeenCalledWith('conan', TARGET);
        expect(run).not.toHaveBeenCalled();
    });
});

describe('installing the packages of any source', () => {
    const stored = () => writePackage('zlib', { 'include/zlib.h': '/* zlib */', 'lib/libz.a': 'z archive' }, 'fake');
    const zlibOf = (api) => ({
        name: 'zlib',
        version: '1.3.2',
        ref: 'zlib/1.3.2',
        license: 'Zlib',
        homepage: null,
        source: null,
        libs: ['z'],
        requires: [],
        systemLibs: [],
        frameworks: [],
        defines: [],
        packageFolder: api.store.path('p', 'zlib', 'p'),
        includedirs: ['include'],
        libdirs: ['lib'],
    });
    const sourceWith = (packageSource) => ({
        name: 'fake',
        packageSource: {
            storeUnits: [], check: (raw) => raw ?? {}, install: (api) => ({ packages: [zlibOf(api)], lock: null }), ...packageSource,
        },
    });
    const configOf = (...packageSources) => ({
        packageSources, packages: { fake: { zlib: '1.3.2' } }, system: { RUNNER: 'LOCAL' }, paths: pathsOf(),
    });
    const stagedArchive = () => upath.join(stageOf('fake'), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'lib', 'libz.a');
    const stamp = () => upath.join(stageOf('fake'), 'stamps', `${TARGET.path}.json`);

    beforeEach(stored);

    test("hands a source its dependencies, the target's toolchain and the text of its lock, each a copy of its own", async () => {
        const { installPackageSources } = await importFresh();
        fs.writeFileSync(upath.join(project, 'fake.lock'), 'zlib 1.3.1\n');
        let given;
        const config = configOf(sourceWith({
            install(api, options) {
                given = {
                    ...JSON.parse(JSON.stringify(options)), name: api.name, isLocal: api.isLocal, logFile: api.logFile,
                };
                options.dependencies.zlib = 'changed';
                options.toolchain.flags.push('-O3');
                return { packages: [zlibOf(api)], lock: 'zlib 1.3.2\n' };
            },
        }));

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(given).toEqual({
            dependencies: { zlib: '1.3.2' },
            toolchain: targetToolchain(TARGET),
            lock: 'zlib 1.3.1\n',
            name: 'fake',
            isLocal: true,
            logFile: upath.join(stageOf('fake'), 'logs', `${TARGET.path}.log`),
        });
        expect(config.packages.fake).toEqual({ zlib: '1.3.2' });
        expect(fs.readFileSync(upath.join(project, 'fake.lock'), 'utf8')).toBe('zlib 1.3.2\n');
        expect(fs.readFileSync(stagedArchive(), 'utf8')).toBe('z archive');
        expect(await installPackageSources(config, [TARGET])).toBe(false);
    });

    test('an install that gives its packages later is waited for', async () => {
        const { installPackageSources } = await importFresh();
        const config = configOf(sourceWith({
            async install(api) {
                await new Promise((resolve) => { setImmediate(resolve); });
                return { packages: [zlibOf(api)], lock: 'zlib 1.3.2\n' };
            },
        }));

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(fs.readFileSync(stagedArchive(), 'utf8')).toBe('z archive');
        expect(fs.readFileSync(upath.join(project, 'fake.lock'), 'utf8')).toBe('zlib 1.3.2\n');
        expect(fs.existsSync(stamp())).toBe(true);
    });

    test('a source that keeps no lock writes none', async () => {
        const { installPackageSources } = await importFresh();

        await installPackageSources(configOf(sourceWith({})), [TARGET]);

        expect(fs.existsSync(upath.join(project, 'fake.lock'))).toBe(false);
        expect(fs.existsSync(stamp())).toBe(true);
    });

    test('what a source says its packages are made from stages them again when it changes', async () => {
        const { installPackageSources } = await importFresh();
        let tool = 'tool 1.0';
        const install = vi.fn((api) => ({ packages: [zlibOf(api)], lock: null }));
        const config = configOf(sourceWith({ inputs: () => ({ tool }), install }));
        await installPackageSources(config, [TARGET]);
        const isCachedWhileTheSame = await installPackageSources(config, [TARGET]) === false;
        tool = 'tool 1.1';

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(isCachedWhileTheSame).toBe(true);
        expect(install).toHaveBeenCalledTimes(2);
    });

    test('inputs that are no JSON value are refused, as their change could not be told', async () => {
        const { installPackageSources } = await importFresh();
        const install = vi.fn();
        const config = configOf(sourceWith({ inputs: () => undefined, install }));

        await expect(installPackageSources(config, [TARGET])).rejects.toThrow("crossbind: fake's inputs gives no JSON value, whose change is what stages its packages again.");
        expect(install).not.toHaveBeenCalled();
    });

    test('an install that gives no list of packages is refused', async () => {
        const { installPackageSources } = await importFresh();
        const config = configOf(sourceWith({ install: () => ({ lock: null }) }));

        await expect(installPackageSources(config, [TARGET])).rejects.toThrow("crossbind: fake's install gives no list of the packages it installed.");
        expect(fs.existsSync(stamp())).toBe(false);
    });

    test('a source without store folders to send back is refused on a remote runner before it installs', async () => {
        const { installPackageSources } = await importFresh();
        const install = vi.fn();
        const config = { ...configOf(sourceWith({ install })), system: { RUNNER: 'REMOTE', REMOTE_URL_WEB: 'https://web.example' } };

        await expect(installPackageSources(config, [TARGET])).rejects.toThrow(/fake names no storeUnits, so a remote runner would send none of its packages back/);
        expect(install).not.toHaveBeenCalled();
    });

    // The lock comes back from where recipes ran, and every later build reads it again.
    test.each([
        ['that is no text', { version: '0.5' }],
        ['with a NUL in it', 'zlib 1.3.2\0'],
        ['larger than a lock gets', 'x'.repeat(8 * 1024 * 1024 + 1)],
    ])('a lock %s stays out of the project, and the target unstaged', async (title, lock) => {
        const { installPackageSources } = await importFresh();
        const config = configOf(sourceWith({ install: (api) => ({ packages: [zlibOf(api)], lock }) }));

        await expect(installPackageSources(config, [TARGET])).rejects.toThrow("crossbind: fake's install gives no lock crossbind can keep, which is text of 8 MiB at most, so fake.lock is left as it was.");
        expect(fs.existsSync(upath.join(project, 'fake.lock'))).toBe(false);
        expect(fs.existsSync(stamp())).toBe(false);
    });

    test("a failure that is not crossbind's own names the source and the step", async () => {
        const { installPackageSources } = await importFresh();
        const config = configOf(sourceWith({
            install() {
                throw new TypeError('boom');
            },
        }));

        await expect(installPackageSources(config, [TARGET])).rejects.toThrow("crossbind: fake's install failed: boom");
    });

    // A parse error quotes the file, which a recipe can write.
    test('a failure that quotes what a recipe wrote reaches the terminal without what it would obey', async () => {
        const { installPackageSources } = await importFresh();
        const config = configOf(sourceWith({ install: () => JSON.parse('\u001b]0;owned\u0007\u009b{') }));

        const failure = await installPackageSources(config, [TARGET]).catch((error) => error);

        expect(failure.message).toMatch(/^crossbind: fake's install failed: Unexpected token/);
        expect([...failure.message].filter((char) => char < ' ' || (char >= '\u007f' && char <= '\u009f'))).toEqual([]);
    });

    test('each source a project declares packages of installs its own, into its own stage', async () => {
        const { installPackageSources, run } = await importFresh();
        const both = configOf(...sources, sourceWith({}));
        const config = { ...both, packages: { ...both.packages, conan: normalizeConanDependencies({ libpng: '1.6.58' }) } };

        expect(await installPackageSources(config, [TARGET])).toBe(true);

        expect(run).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'libpng', 'dist', 'prebuilt', TARGET.path, 'lib', 'libpng.a'))).toBe(true);
        expect(fs.readFileSync(stagedArchive(), 'utf8')).toBe('z archive');
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'lib', 'libz.a'))).toBe(true);
        expect(await installPackageSources(config, [TARGET])).toBe(false);
    });
});
