import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import { normalizeConanDependencies } from '../src/utils/conanDependencies.js';
import { hostProfile } from '../src/utils/conanProfile.js';

const h = vi.hoisted(() => ({
    result: null, lock: null, graph: undefined, seen: [], onRun: null,
}));
vi.mock('../src/utils/runConan.js', async (importOriginal) => ({
    ...await importOriginal(),
    default: vi.fn(),
    localToolchainIdentity: () => 'emcc 4.0.0\nConan version 2.33.0',
}));

const CLI = upath.normalize(fileURLToPath(new URL('../src', import.meta.url)));
const TARGET = {
    platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasm-wasm32-st-release',
};
const LOCK = { version: '0.5', requires: ['libpng/1.6.58#19cb72905ae54f54948401f753faa2c1%1776606503.628'] };
const LOCK_TEXT = `${JSON.stringify(LOCK, null, 4)}\n`;

let scratch;
let project;
const store = () => upath.join(scratch, 'home', '.crossbind', 'conan-local', 'store');
const stageDir = () => upath.join(project, '.crossbind', 'conan');
const configWith = (conanDependencies) => ({
    conanDependencies: normalizeConanDependencies(conanDependencies),
    system: { RUNNER: 'LOCAL' },
    paths: {
        project, cache: upath.join(project, '.crossbind'), base: project, cli: CLI,
    },
});

function writePackage(name, files) {
    Object.entries(files).forEach(([file, content]) => {
        const full = upath.join(store(), 'p', name, 'p', file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    });
}

function graphOf() {
    const folder = (name) => upath.join(store(), 'p', name, 'p');
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

async function importFresh() {
    vi.resetModules();
    const { default: runConan } = await import('../src/utils/runConan.js');
    runConan.mockReset();
    runConan.mockImplementation((args, { work }) => {
        h.seen.push({
            work: work.dir,
            hostProfile: fs.readFileSync(argAfter(args, '-pr:h'), 'utf8'),
            inputLock: args.includes('--lockfile') ? fs.readFileSync(argAfter(args, '--lockfile'), 'utf8') : null,
        });
        fs.writeFileSync(argAfter(args, '--lockfile-out'), h.lock ?? LOCK_TEXT);
        const graph = h.graph === undefined ? JSON.stringify({ graph: graphOf() }) : h.graph;
        if (graph !== null) fs.writeFileSync(argAfter(args, '--out-file'), graph);
        h.onRun?.(work);
        return h.result ?? { status: 0, stdout: 'a build tool writing to stdout\n', stderr: 'built libpng\n' };
    });
    const { default: installConanPackages } = await import('../src/utils/conanInstall.js');
    return { installConanPackages, runConan };
}

beforeEach(() => {
    scratch = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-install-')));
    project = upath.join(scratch, 'app');
    fs.mkdirSync(project, { recursive: true });
    vi.spyOn(os, 'homedir').mockReturnValue(upath.join(scratch, 'home'));
    h.result = null;
    h.lock = null;
    h.graph = undefined;
    h.onRun = null;
    h.seen = [];
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
        const { installConanPackages, runConan } = await importFresh();

        expect(await installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET])).toBe(true);

        const [args, { target }] = runConan.mock.calls[0];
        expect(target).toBe(TARGET);
        expect(args).toEqual(expect.arrayContaining(['install', '--requires', 'libpng/1.6.58', '--build=missing', '--format=json', '--lockfile=']));
        expect(argAfter(args, '-pr:h')).toBe(path.join(h.seen[0].work, 'host.profile'));
        expect(argAfter(args, '--output-folder')).toBe(path.join(h.seen[0].work, 'output'));
        expect(argAfter(args, '--out-file')).toBe(path.join(h.seen[0].work, 'graph.json'));
        expect(h.seen[0].hostProfile).toBe(hostProfile(TARGET));
        expect(fs.existsSync(h.seen[0].work)).toBe(false);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'libpng', 'dist', 'prebuilt', TARGET.path, 'lib', 'libpng.a'))).toBe(true);
        expect(fs.existsSync(upath.join(stageDir(), 'packages', 'zlib', 'dist', 'prebuilt', TARGET.path, 'include', 'zlib.h'))).toBe(true);
        const manifest = JSON.parse(fs.readFileSync(upath.join(stageDir(), 'manifest.json'), 'utf8'));
        expect(manifest.packages.map((p) => p.name)).toEqual(['libpng', 'zlib']);
        expect(manifest.packages[0]).not.toHaveProperty('packageFolder');
        expect(fs.readFileSync(upath.join(stageDir(), 'logs', `${TARGET.path}.log`), 'utf8')).toBe('built libpng\n');
    });

    test('writes the resolution to conan.lock beside the config', async () => {
        const { installConanPackages } = await importFresh();

        await installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET]);

        expect(fs.readFileSync(upath.join(project, 'conan.lock'), 'utf8')).toBe(LOCK_TEXT);
    });

    test('a resolution that is no lockfile stays out of the project', async () => {
        const { installConanPackages } = await importFresh();
        h.lock = 'not json';

        await expect(installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/no lockfile crossbind can read/);
        expect(fs.existsSync(upath.join(project, 'conan.lock'))).toBe(false);
    });

    test('a staged target with nothing changed runs no conan', async () => {
        const { installConanPackages, runConan } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });

        await installConanPackages(config, [TARGET]);

        expect(await installConanPackages(config, [TARGET])).toBe(false);
        expect(runConan).toHaveBeenCalledTimes(1);
    });

    test('an existing conan.lock pins what it resolved and lets a new requirement in', async () => {
        fs.writeFileSync(upath.join(project, 'conan.lock'), LOCK_TEXT);
        const { installConanPackages, runConan } = await importFresh();

        await installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET]);

        const args = runConan.mock.calls[0][0];
        expect(argAfter(args, '--lockfile')).toBe(path.join(h.seen[0].work, 'input.lock'));
        expect(args).toContain('--lockfile-partial');
        expect(h.seen[0].inputLock).toBe(LOCK_TEXT);
    });

    test('a changed conanDependencies stages again', async () => {
        const { installConanPackages, runConan } = await importFresh();

        await installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET]);
        await installConanPackages(configWith({ libpng: '1.6.57' }), [TARGET]);

        expect(runConan).toHaveBeenCalledTimes(2);
    });

    test('a stamped target whose manifest was replaced stages again', async () => {
        const { installConanPackages, runConan } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        await installConanPackages(config, [TARGET]);
        fs.writeFileSync(upath.join(stageDir(), 'manifest.json'), JSON.stringify({ key: 'other dependencies', packages: [] }));

        expect(await installConanPackages(config, [TARGET])).toBe(true);
        expect(runConan).toHaveBeenCalledTimes(2);
    });

    test('a restage that fails leaves the target unstaged', async () => {
        const { installConanPackages, runConan } = await importFresh();
        const config = configWith({ libpng: '1.6.58' });
        await installConanPackages(config, [TARGET]);
        h.result = { status: 1, stdout: '', stderr: 'ERROR: interrupted' };

        await expect(installConanPackages(configWith({ libpng: '1.6.57' }), [TARGET])).rejects.toThrow(/exit code 1/);
        h.result = null;
        await installConanPackages(config, [TARGET]);

        expect(runConan).toHaveBeenCalledTimes(3);
    });

    test('a failed install reports the end of the conan log without its escape sequences, and keeps the whole log', async () => {
        const { installConanPackages } = await importFresh();
        h.result = { status: 1, stdout: '', stderr: 'Computing dependency graph\n\u001b[31mERROR: Package \'libpng/9.9.9\' not resolved\u001b[0m' };

        const error = await installConanPackages(configWith({ libpng: '9.9.9' }), [TARGET]).catch((e) => e);

        expect(error.message).toMatch(/libpng\/9\.9\.9' not resolved/);
        expect(error.message).not.toContain('\u001b');
        const log = upath.join(stageDir(), 'logs', `${TARGET.path}.log`);
        expect(error.message).toContain(log);
        expect(fs.readFileSync(log, 'utf8')).toBe(h.result.stderr);
    });

    test('a graph conan did not write stops the install, naming the log', async () => {
        const { installConanPackages } = await importFresh();
        h.graph = null;

        await expect(installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/wrote no graph crossbind can read\. Its log is in .*\.log/);
    });

    test.skipIf(process.platform === 'win32')('a failed run that left a read-only directory is cleaned up and reports its own error', async () => {
        const { installConanPackages } = await importFresh();
        h.result = { status: 1, stdout: '', stderr: 'ERROR: the recipe failed' };
        h.onRun = (work) => {
            fs.mkdirSync(path.join(work.dir, 'output', 'locked'), { recursive: true });
            fs.chmodSync(path.join(work.dir, 'output', 'locked'), 0o555);
        };

        await expect(installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/the recipe failed/);
        expect(fs.existsSync(h.seen[0].work)).toBe(false);
    });

    test('what a killed run left is cleared by the next install', async () => {
        const leftover = upath.join(scratch, 'home', '.crossbind', 'conan-local', 'work', 'run-killed');
        fs.mkdirSync(upath.join(leftover, 'output'), { recursive: true });
        const { installConanPackages } = await importFresh();

        await installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET]);

        expect(fs.existsSync(leftover)).toBe(false);
    });

    test('a conan stopped by a signal says so', async () => {
        const { installConanPackages } = await importFresh();
        h.result = {
            status: null, signal: 'SIGKILL', stdout: '', stderr: '',
        };

        await expect(installConanPackages(configWith({ libpng: '1.6.58' }), [TARGET])).rejects.toThrow(/was stopped by SIGKILL/);
    });

    test('a project without conanDependencies runs nothing', async () => {
        const { installConanPackages, runConan } = await importFresh();

        expect(await installConanPackages(configWith(undefined), [TARGET])).toBe(false);
        expect(runConan).not.toHaveBeenCalled();
    });
});
