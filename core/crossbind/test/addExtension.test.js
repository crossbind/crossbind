import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import addExtension, { importNameOf, packageManagerOf, registryName } from '../src/actions/addExtension.js';

const APP_CONFIG = "export default {\n    target: { runtimeEnv: 'app' },\n};\n";
const EXTENSION = { crossbind: { extension: './crossbind.extension.js' } };

let root;
let project;
beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-add-')));
    project = path.join(root, 'app');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), '{ "name": "app", "dependencies": {} }\n');
    fs.writeFileSync(path.join(project, 'crossbind.config.js'), APP_CONFIG);
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

const configOf = (overrides = {}) => ({ target: { runtimeEnv: 'app' }, paths: { project, base: project, ...overrides } });
const readConfig = () => fs.readFileSync(path.join(project, 'crossbind.config.js'), 'utf8');

function addDependency(name, field = 'dependencies') {
    const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ ...pkg, [field]: { ...pkg[field], [name]: '^1.0.0' } }));
}

// A package's manifest and the module its crossbind.extension names, where that is a path of its own.
function installPackage(name, manifest = EXTENSION, dir = path.join(project, 'node_modules', name)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, ...manifest }));
    const entry = manifest.crossbind?.extension;
    if (typeof entry === 'string' && /^\.\/[\w./-]+$/.test(entry) && !entry.includes('..')) {
        fs.mkdirSync(path.dirname(path.join(dir, entry)), { recursive: true });
        fs.writeFileSync(path.join(dir, entry), 'export default () => ({});\n');
    }
}

// A package manager that installs the named package with the manifest given: into node_modules, and into package.json.
const installing = (name, manifest = EXTENSION, field = 'dependencies') => vi.fn(() => {
    installPackage(name, manifest);
    addDependency(name, field);
    return { status: 0 };
});

describe('crossbind add', () => {
    test("adds none an app has by having the host, which a build would refuse in its list, and installs nothing", () => {
        const spawn = vi.fn();

        for (const spec of ['@crossbind/extension-dialog', '@crossbind/extension-google-play@beta']) {
            expect(() => addExtension(spec, { config: configOf(), spawn, platform: 'darwin' }))
                .toThrow('by having @crossbind/core-app-host, which brings it, so there is nothing to add');
        }
        expect(spawn).not.toHaveBeenCalled();
    });

    test('adds none every project has by having crossbind, as its package source conan, and installs nothing', () => {
        const spawn = vi.fn();

        expect(() => addExtension('@crossbind/extension-conan@beta', { config: configOf(), spawn, platform: 'darwin' }))
            .toThrow('crossbind: every project has @crossbind/extension-conan by having crossbind, which brings it, so there is nothing to add.');
        expect(spawn).not.toHaveBeenCalled();
    });

    test('installs an extension with the manager of the lockfile nearest the project, then lists it', () => {
        fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
        const spawn = installing('@crossbind/extension-clipboard');

        const added = addExtension('@crossbind/extension-clipboard', { config: configOf(), spawn, platform: 'darwin' });

        expect(spawn).toHaveBeenCalledWith('pnpm', ['add', '@crossbind/extension-clipboard'], { cwd: project, stdio: 'inherit' });
        expect(added).toMatchObject({ name: '@crossbind/extension-clipboard', identifier: 'clipboard', isListed: false });
        expect(readConfig()).toBe("import clipboard from '@crossbind/extension-clipboard/crossbind.extension.js';\n\nexport default {\n    extensions: [clipboard()],\n    target: { runtimeEnv: 'app' },\n};\n");
    });

    test('names the package by what the install adds to package.json, whatever the spec looks like', () => {
        const fromPath = installing('crossbind-extension-wi-fi');
        expect(addExtension('../crossbind-extension-wi-fi-0.1.0.tgz', { config: configOf(), spawn: fromPath, platform: 'linux', env: {} }))
            .toMatchObject({ name: 'crossbind-extension-wi-fi', identifier: 'wiFi' });
        expect(fromPath).toHaveBeenCalledWith('npm', ['install', '../crossbind-extension-wi-fi-0.1.0.tgz'], { cwd: project, stdio: 'inherit' });

        // An scp-like repository reads as the package git at version github.com:… to a registry's eye.
        const fromGit = installing('crossbind-extension-share', EXTENSION, 'devDependencies');
        expect(addExtension('git@github.com:me/crossbind-extension-share.git', { config: configOf(), spawn: fromGit, env: {} }))
            .toMatchObject({ name: 'crossbind-extension-share', identifier: 'share' });
    });

    test('lists a package package.json has already without installing it again, and once', () => {
        installing('crossbind-extension-greeter')();
        const spawn = vi.fn();

        const added = addExtension('crossbind-extension-greeter', { config: configOf(), spawn });

        expect(spawn).not.toHaveBeenCalled();
        expect(added).toMatchObject({ identifier: 'greeter', isListed: false });
        expect(addExtension('crossbind-extension-greeter', { config: configOf(), spawn })).toMatchObject({ isListed: true });
    });

    test('runs the package manager through a shell on Windows, where it is a .cmd file, and without one elsewhere', () => {
        const windows = installing('crossbind-extension-greeter');
        addExtension('crossbind-extension-greeter@1.2.0', { config: configOf(), spawn: windows, platform: 'win32', env: {} });
        expect(windows).toHaveBeenCalledWith('npm install crossbind-extension-greeter@1.2.0', { cwd: project, stdio: 'inherit', shell: true });

        const mac = vi.fn(() => ({ status: 0 }));
        addExtension('crossbind-extension-greeter@^1.2.0', { config: configOf(), spawn: mac, platform: 'darwin', env: {} });
        expect(mac).toHaveBeenCalledWith('npm', ['install', 'crossbind-extension-greeter@^1.2.0'], { cwd: project, stdio: 'inherit' });
    });

    test.each(['&', '|', '<', '>', '^', '(', ')', '%', '!', '"', ';', ',', ' '])("stops before installing on Windows on a spec with %s, which its shell reads", (character) => {
        const spawn = vi.fn();

        expect(() => addExtension(`crossbind-extension-greeter${character}x`, { config: configOf(), spawn, platform: 'win32' }))
            .toThrow('on Windows crossbind add takes');
        expect(spawn).not.toHaveBeenCalled();
    });

    test('stops before installing in a project that is no app, or on a spec a package manager reads as an option', () => {
        const spawn = vi.fn();

        expect(() => addExtension('crossbind-extension-greeter', { config: { ...configOf(), target: {} }, spawn }))
            .toThrow("set target: { runtimeEnv: 'app' }");
        expect(() => addExtension('-g', { config: configOf(), spawn, platform: 'darwin' })).toThrow('-g is an option to a package manager');
        expect(() => addExtension('--registry=https://example.com', { config: configOf(), spawn, platform: 'win32' })).toThrow('is an option');
        expect(spawn).not.toHaveBeenCalled();
    });

    test('stops when the install fails or its manager does not start, and lists nothing', () => {
        const options = { config: configOf(), env: {}, platform: 'linux' };

        expect(() => addExtension('crossbind-extension-greeter', { ...options, spawn: () => ({ status: 1 }) }))
            .toThrow('npm install crossbind-extension-greeter failed, so crossbind.config.js lists nothing new: install crossbind-extension-greeter yourself');
        expect(() => addExtension('crossbind-extension-greeter', { ...options, spawn: () => ({ status: null, signal: 'SIGINT' }) })).toThrow('failed');
        expect(() => addExtension('crossbind-extension-greeter', { ...options, spawn: () => ({ error: new Error('spawnSync npm ENOENT') }) }))
            .toThrow('npm did not start (spawnSync npm ENOENT)');
        expect(readConfig()).toBe(APP_CONFIG);
    });

    test('stops where the install added the package to another package.json than the project\'s', () => {
        const spawn = vi.fn(() => ({ status: 0 }));

        expect(() => addExtension('crossbind-extension-greeter', { config: configOf(), spawn, env: {} }))
            .toThrow(`cannot tell which package crossbind-extension-greeter is, as ${path.join(project, 'package.json')} gained none`);
    });

    test('stops on a package that is no extension, naming how to remove it where this install added it', () => {
        expect(() => addExtension('left-pad', { config: configOf(), spawn: installing('left-pad', {}), env: {} }))
            .toThrow('left-pad is installed, but it is no crossbind extension: its package.json has no crossbind.extension. npm uninstall left-pad removes it.');
        addDependency('lodash');
        installPackage('lodash', {});
        expect(() => addExtension('lodash@4', { config: configOf(), spawn: vi.fn(() => ({ status: 0 })), env: {} }))
            .toThrow(/no crossbind\.extension\.$/);
        expect(() => addExtension('crossbind-extension-far', { config: configOf(), spawn: installing('crossbind-extension-far', { crossbind: { extension: '../../far.js' } }), env: {} }))
            .toThrow('is no module of its own');
        expect(readConfig()).toBe(APP_CONFIG);
    });

    test('stops on an extension whose module its package has not, or does not export, which the config could not import', () => {
        const spawn = installing('crossbind-extension-greeter');
        const missing = vi.fn(() => {
            spawn();
            fs.rmSync(path.join(project, 'node_modules', 'crossbind-extension-greeter', 'crossbind.extension.js'));
            return { status: 0 };
        });
        expect(() => addExtension('crossbind-extension-greeter', { config: configOf(), spawn: missing, env: {} })).toThrow(
            "crossbind: crossbind-extension-greeter's crossbind.extension names ./crossbind.extension.js, which its package has not, so crossbind.config.js lists nothing new. npm uninstall crossbind-extension-greeter removes it.",
        );
        const hidden = { ...EXTENSION, exports: { '.': './index.js' } };
        expect(() => addExtension('crossbind-extension-hidden', { config: configOf(), spawn: installing('crossbind-extension-hidden', hidden), env: {} }))
            .toThrow("crossbind: crossbind-extension-hidden's package.json exports no ./crossbind.extension.js, which crossbind.config.js would import");
        expect(readConfig()).toBe(APP_CONFIG);
        // A string or a list exports the package's root alone, as conditions without paths do, and null keeps a path out.
        for (const exports of ['./index.js', ['./index.js'], { import: './index.js', require: './index.cjs' }, { './crossbind.extension.js': null, './*': './*' }]) {
            expect(() => addExtension('crossbind-extension-hidden', { config: configOf(), spawn: installing('crossbind-extension-hidden', { ...EXTENSION, exports }), env: {} }))
                .toThrow("crossbind: crossbind-extension-hidden's package.json exports no ./crossbind.extension.js");
        }
        const patterned = { ...EXTENSION, exports: { '.': './index.js', './*.js': './*.js' } };
        expect(addExtension('crossbind-extension-open', { config: configOf(), spawn: installing('crossbind-extension-open', patterned), env: {} }))
            .toMatchObject({ name: 'crossbind-extension-open', isListed: false });
    });

    test('gives the lines to write where the config cannot take them', () => {
        fs.writeFileSync(path.join(project, 'crossbind.config.js'), 'export default makeConfig({});\n');

        expect(() => addExtension('crossbind-extension-greeter', { config: configOf(), spawn: installing('crossbind-extension-greeter'), env: {} }))
            .toThrow("crossbind.config.js is no config crossbind can list it in safely: write import greeter from 'crossbind-extension-greeter/crossbind.extension.js' and extensions: [greeter()]");
    });

    test('lists nothing where the package lies outside paths.base, and lists it once paths.base takes it', () => {
        // A workspace's package manager links a package in from a store beside the project.
        const store = path.join(root, 'store', 'crossbind-extension-greeter');
        const spawn = vi.fn(() => {
            installPackage('crossbind-extension-greeter', EXTENSION, store);
            fs.mkdirSync(path.join(project, 'node_modules'));
            fs.symlinkSync(store, path.join(project, 'node_modules', 'crossbind-extension-greeter'), 'dir');
            addDependency('crossbind-extension-greeter');
            return { status: 0 };
        });

        expect(() => addExtension('crossbind-extension-greeter', { config: configOf(), spawn, env: {} }))
            .toThrow(`is in ${store}, outside paths.base, ${project}, which is all a build sees, so crossbind.config.js lists nothing new: set paths: { base: '..' } in it`);
        expect(readConfig()).toBe(APP_CONFIG);
        expect(addExtension('crossbind-extension-greeter', { config: configOf({ base: root }), spawn, env: {} })).toMatchObject({ isListed: false });
        expect(spawn).toHaveBeenCalledTimes(1);
    });
});

describe('the package manager crossbind add installs with', () => {
    test('is the one the lockfile nearest the project names', () => {
        const lockfiles = [['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'], ['yarn.lock', 'yarn']];
        for (const [file, manager] of lockfiles) {
            fs.writeFileSync(path.join(project, file), '');
            expect(packageManagerOf(project, 'pnpm/11.23.0 npm/? node/v24.11.0 darwin arm64'), file).toBe(manager);
            fs.rmSync(path.join(project, file));
        }
        fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), '');
        fs.writeFileSync(path.join(project, 'package-lock.json'), '');
        expect(packageManagerOf(project, undefined)).toBe('npm');
    });

    test('is the one that runs crossbind where no lockfile names one, else npm', () => {
        expect(packageManagerOf(project, 'pnpm/11.23.0 npm/? node/v24.11.0 darwin arm64')).toBe('pnpm');
        expect(packageManagerOf(project, 'rm -rf/1.0')).toBe('npm');
        expect(packageManagerOf(project, undefined)).toBe('npm');
    });
});

describe('a package spec', () => {
    test('names its package where it is one of a registry, with or without a version', () => {
        expect(registryName('@crossbind/extension-clipboard')).toBe('@crossbind/extension-clipboard');
        expect(registryName('@crossbind/extension-clipboard@beta')).toBe('@crossbind/extension-clipboard');
        expect(registryName('crossbind-extension-greeter@1.2.0')).toBe('crossbind-extension-greeter');
    });

    test('names none where it is a path, a tarball or a repository', () => {
        expect(registryName('../x.tgz')).toBeNull();
        expect(registryName('x.tgz')).toBeNull();
        expect(registryName('github:me/x')).toBeNull();
        expect(registryName('me/x')).toBeNull();
    });
});

describe("an extension's import", () => {
    test("is named after its package, without the scope and the extension's prefix", () => {
        expect(importNameOf('@crossbind/extension-clipboard')).toBe('clipboard');
        expect(importNameOf('crossbind-extension-wi-fi')).toBe('wiFi');
        expect(importNameOf('@me/share-sheet')).toBe('shareSheet');
    });

    test('takes Extension after a word module code keeps, and extension before a digit', () => {
        expect(importNameOf('crossbind-extension-delete')).toBe('deleteExtension');
        expect(importNameOf('@me/extension-3d')).toBe('extension3d');
    });
});
