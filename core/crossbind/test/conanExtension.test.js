import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import conan from '../../../extensions/conan/crossbind.extension.js';
import { hostProfile, BUILD_PROFILE } from '../../../extensions/conan/src/profile.js';
import { targetToolchain } from '../src/utils/targetToolchain.js';

// Where a container sees the run's work directory and the store.
const WORK = '/var/cache/crossbind/conan/work/run-1';
const STORE = '/var/cache/crossbind/conan/store';
const LOG = '/app/.crossbind/conan/logs/wasm-wasm32-st-release.log';
const toolchainOf = (platform = 'wasm', arch = 'wasm32') => targetToolchain({
    platform, arch, runtime: 'st', buildType: 'release',
});
const GRAPH = {
    graph: {
        root: { 0: 'None' },
        nodes: {
            0: { ref: 'conanfile', recipe: 'Cli', context: 'host', dependencies: { 1: { build: false, test: false } } },
            1: {
                ref: 'zlib/1.3.2#0123',
                name: 'zlib',
                version: '1.3.2',
                context: 'host',
                test: false,
                binary: 'Cache',
                license: 'Zlib',
                homepage: 'https://zlib.example',
                options: { fPIC: 'True', shared: 'False' },
                options_definitions: { shared: ['True', 'False'], fPIC: ['True', 'False'] },
                default_options: { shared: false, fPIC: true },
                package_folder: `${STORE}/p/zlib/p`,
                cpp_info: { root: { includedirs: [`${STORE}/p/zlib/p/include`], libdirs: [`${STORE}/p/zlib/p/lib`], libs: ['z'] } },
                dependencies: {},
            },
        },
    },
};
const LOCK = { version: '0.5', requires: ['zlib/1.3.2#0123%1700000000.0'] };
const ZLIB = { zlib: { version: '1.3.2', options: {} } };

describe('the conan package source', () => {
    let scratch;
    let calls;
    // What a run leaves in the work directory, as conan install would.
    let outputs;
    let version;
    // The .conanrc conan finds beside it when it is asked its version.
    let conanrcWhenAsked;
    let reads;

    // As the api's: a file of the work directory as text, or null without one.
    const readWork = (...segments) => {
        reads.push(segments.join('/'));
        const file = path.join(scratch, ...segments);
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    };
    const apiOf = (overrides = {}) => ({
        name: 'conan',
        isLocal: false,
        logFile: LOG,
        work: { dir: scratch, path: (...segments) => [WORK, ...segments].join('/'), read: readWork },
        store: { dir: path.join(scratch, 'store'), path: (...segments) => [STORE, ...segments].join('/') },
        log: () => {},
        run(command, { env } = {}) {
            calls.push({ command, env });
            if (command[1] === '--version') {
                conanrcWhenAsked = fs.existsSync(path.join(scratch, '.conanrc')) ? fs.readFileSync(path.join(scratch, '.conanrc'), 'utf8') : null;
                if (version === null) throw new Error('crossbind: could not run conan for wasm-wasm32-st-release (spawnSync conan ENOENT).');
                return { stdout: `${version}\n`, stderr: '' };
            }
            Object.entries(outputs).forEach(([file, content]) => fs.writeFileSync(path.join(scratch, file), content));
            return { stdout: '', stderr: '' };
        },
        ...overrides,
    });
    const onThisMachine = () => apiOf({
        isLocal: true,
        work: { dir: scratch, path: (...segments) => path.join(scratch, ...segments), read: readWork },
        store: { dir: path.join(scratch, 'store'), path: (...segments) => path.join(scratch, 'store', ...segments) },
    });
    const read = (file) => fs.readFileSync(path.join(scratch, file), 'utf8');
    const install = (api, options = {}, source = conan().packageSource) => source.install(api, {
        dependencies: ZLIB, toolchain: toolchainOf(), lock: null, ...options,
    });
    const installs = () => calls.filter(({ command }) => command[1] === 'install');
    const probes = () => calls.filter(({ command }) => command[1] === '--version');

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-extension-'));
        calls = [];
        outputs = { 'graph.json': JSON.stringify(GRAPH), 'resolution.lock': JSON.stringify(LOCK) };
        version = 'Conan version 2.21.0';
        conanrcWhenAsked = undefined;
        reads = [];
    });

    afterEach(() => fs.rmSync(scratch, { recursive: true, force: true }));

    // Recipes write to the work directory too: the api's read follows no link one planted there.
    test('reads what conan left through the api, whose refusal of a link it lets through', () => {
        const refusal = new Error('crossbind: conan reads graph.json from its work directory, which is no file of its own there: a link, a folder, or a path that leaves the directory.');
        const api = apiOf();

        install(api);

        expect(reads).toEqual(['graph.json', 'resolution.lock']);
        expect(() => install({ ...api, work: { ...api.work, read: () => { throw refusal; } } })).toThrow(refusal);
    });

    test('is a package source named conan, of the contract that has the role', () => {
        const extension = conan();

        expect(extension).toMatchObject({ name: 'conan', contract: 2, root: path.resolve(import.meta.dirname, '../../../extensions/conan') });
        // Downloaded binaries sit in p/<ref>/p of the store, ones conan built in b/<ref>/p.
        expect(extension.packageSource.storeUnits).toEqual(['p/*/p', 'b/*/p']);
        expect(extension.packageSource.check({ zlib: '1.3.2' })).toEqual(ZLIB);
        expect(() => extension.packageSource.check({ ZLib: '1.3.2' })).toThrow(/Conan package name/);
    });

    test('runs conan install for the declared packages, with profiles and a home of the run', () => {
        const dependencies = { ...ZLIB, sqlite3: { version: '3.53.4', options: { enable_fts5: true } } };

        const result = install(apiOf(), { dependencies });

        expect(calls).toEqual([{
            command: [
                'conan', 'install',
                '--requires', 'zlib/1.3.2',
                '--requires', 'sqlite3/3.53.4',
                '-o:h', 'sqlite3/*:enable_fts5=True',
                '-pr:h', `${WORK}/host.profile`,
                '-pr:b', `${WORK}/build.profile`,
                '--output-folder', `${WORK}/output`,
                '--build=missing',
                '--format=json',
                '--out-file', `${WORK}/graph.json`,
                '--lockfile=',
                '--lockfile-out', `${WORK}/resolution.lock`,
            ],
            env: { CONAN_HOME: `${WORK}/home` },
        }]);
        expect(read('.conanrc')).toBe('conan_home=./home\n');
        expect(read('home/global.conf')).toBe(`core.cache:storage_path=${STORE}\ncore:non_interactive=True\n`);
        expect(read('host.profile')).toBe(hostProfile(toolchainOf()));
        expect(read('build.profile')).toBe(BUILD_PROFILE);
        expect(fs.existsSync(path.join(scratch, 'home', 'settings_user.yml'))).toBe(false);
        expect(fs.existsSync(path.join(scratch, 'input.lock'))).toBe(false);
        expect(result.packages).toEqual([expect.objectContaining({
            name: 'zlib', version: '1.3.2', ref: 'zlib/1.3.2#0123', libs: ['z'], packageFolder: `${STORE}/p/zlib/p`,
        })]);
        expect(result.lock).toBe(`${JSON.stringify(LOCK, null, 4)}\n`);
    });

    test("the project's lock goes in as the versions to keep", () => {
        install(apiOf(), { lock: '{"version":"0.5"}\n' });

        expect(read('input.lock')).toBe('{"version":"0.5"}\n');
        const { command } = installs()[0];
        expect(command.slice(command.indexOf('--out-file') + 2)).toEqual([
            '--lockfile', `${WORK}/input.lock`, '--lockfile-partial', '--lockfile-out', `${WORK}/resolution.lock`,
        ]);
    });

    test('a compiler newer than the conan release lists is let through', () => {
        install(apiOf(), { toolchain: toolchainOf('android', 'arm64-v8a') });

        expect(read('home/settings_user.yml')).toBe('compiler:\n  clang:\n    version: ["ANY"]\n');
    });

    test('an image brings its own conan, so none is asked for its version there', () => {
        install(apiOf());

        expect(probes()).toHaveLength(0);
    });

    test("this machine's conan is asked for its version before it installs", () => {
        install(onThisMachine());

        expect(calls.map(({ command }) => command[1])).toEqual(['--version', 'install']);
        expect(read('home/global.conf')).toContain(`core.cache:storage_path=${path.join(scratch, 'store')}\n`);
        expect(installs()[0].env).toEqual({ CONAN_HOME: path.join(scratch, 'home') });
    });

    test('conan is asked its version with a home of its own already beside it, since it migrates the home it starts in', () => {
        conan().packageSource.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() });

        expect(conanrcWhenAsked).toBe('conan_home=./home\n');
    });

    test("an install asks conan its version only once the run's home is beside it", () => {
        install(onThisMachine());

        expect(conanrcWhenAsked).toBe('conan_home=./home\n');
    });

    test('the version is the first line conan prints for it', () => {
        version = 'Conan version 2.21.0\na notice of another kind';

        expect(conan().packageSource.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() }).conan).toBe('Conan version 2.21.0');
    });

    test('a conan older than the graph needs is refused, with how to upgrade it where crossbind uses no image', () => {
        version = 'Conan version 2.18.1';

        expect(() => install(onThisMachine())).toThrow('crossbind: RUNNER=LOCAL runs conan from the PATH and needs Conan 2.19 or later; found Conan version 2.18.1.');
        expect(() => install(onThisMachine(), { toolchain: toolchainOf('ios', 'iphoneos') })).toThrow(
            'crossbind: Conan packages for iOS build on this Mac, with the conan on the PATH, which must be Conan 2.19 or later; found Conan version 2.18.1. Install or upgrade it with `brew install conan` (`brew upgrade conan`) or `pipx install conan`.',
        );
        expect(installs()).toHaveLength(0);
    });

    test('a machine without conan is told so', () => {
        version = null;

        expect(() => install(onThisMachine(), { toolchain: toolchainOf('darwin', 'arm64') })).toThrow(/Conan packages for macOS build on this Mac.*found none\. Install or upgrade it/);
    });

    test('under RUNNER=LOCAL too, whether conan cannot be run or says nothing of its version', () => {
        const none = 'crossbind: RUNNER=LOCAL runs conan from the PATH and needs Conan 2.19 or later; found none.';

        version = null;
        expect(() => install(onThisMachine())).toThrow(none);
        version = '';
        expect(() => install(onThisMachine())).toThrow(none);

        expect(installs()).toHaveLength(0);
    });

    test('a run that leaves no graph names its log', () => {
        outputs = { 'resolution.lock': JSON.stringify(LOCK) };
        expect(() => install(apiOf())).toThrow(`crossbind: conan install wrote no graph crossbind can read. Its log is in ${LOG}.`);

        outputs = { 'graph.json': '{"graph": ', 'resolution.lock': JSON.stringify(LOCK) };
        expect(() => install(apiOf())).toThrow(/wrote no graph crossbind can read/);
    });

    test('an option the recipe does not have stops the install, once conan has read the recipe', () => {
        const dependencies = { zlib: { version: '1.3.2', options: { fpic: true } } };

        expect(() => install(apiOf(), { dependencies })).toThrow("crossbind: packages.conan.zlib.options - zlib/1.3.2 has no option 'fpic'. It has: fPIC, shared.");
        expect(installs()).toHaveLength(1);
    });

    test('only a lockfile comes back as the lock', () => {
        outputs = { 'graph.json': JSON.stringify(GRAPH), 'resolution.lock': '#!/bin/sh\n' };
        expect(() => install(apiOf())).toThrow('crossbind: conan wrote no lockfile crossbind can read, so conan.lock is left as it was.');

        outputs = { 'graph.json': JSON.stringify(GRAPH) };
        expect(() => install(apiOf())).toThrow(/wrote no lockfile crossbind can read/);
    });

    test('packages restage when the profiles or the way it installs change, and with the conan of this machine', () => {
        const source = conan().packageSource;

        expect(source.inputs(apiOf(), { dependencies: ZLIB, toolchain: toolchainOf() })).toEqual({
            format: 1, host: hostProfile(toolchainOf()), build: BUILD_PROFILE, conan: null,
        });
        expect(calls).toHaveLength(0);
        expect(source.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() }).conan).toBe('Conan version 2.21.0');
        // conan migrates the home it starts in, so it starts in one of the run's.
        expect(read('.conanrc')).toBe('conan_home=./home\n');
    });

    test('the conan of this machine is asked once', () => {
        const source = conan().packageSource;

        source.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() });
        source.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() });
        install(onThisMachine(), {}, source);

        expect(probes()).toHaveLength(1);
        expect(installs()).toHaveLength(1);
    });

    // A build server that started before conan was installed finds it without a restart.
    test('a machine without conan is asked again, until it has one', () => {
        const source = conan().packageSource;
        version = null;
        const before = source.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() }).conan;
        version = 'Conan version 2.21.0';

        const after = source.inputs(onThisMachine(), { dependencies: ZLIB, toolchain: toolchainOf() }).conan;

        expect([before, after]).toEqual(['', 'Conan version 2.21.0']);
        expect(probes()).toHaveLength(2);
    });
});
