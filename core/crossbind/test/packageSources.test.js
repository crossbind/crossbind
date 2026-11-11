import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { getFilledConfig } from '../src/state/loadConfig.js';
import {
    checkedDependencies, declaredSources, dependenciesKey, dependenciesOf, importSchemesOf, packageSourceInputsOf, packageSourcesOf, sourceNamesOf,
} from '../src/utils/packageSources.js';

let project;
const sourceOf = (name, packageSource = {}) => ({
    name, contract: 2, root: project, packageSource: { check: (declared) => declared ?? {}, install: () => ({ packages: [] }), ...packageSource },
});
const loadConfig = (config = {}) => getFilledConfig({ paths: { project }, ...config });

beforeEach(() => {
    project = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-package-sources-')));
    fs.writeFileSync(upath.join(project, 'package.json'), JSON.stringify({ name: 'package-sources-app', version: '0.0.0' }));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("a project's package sources", () => {
    test('conan comes with crossbind, as the extension package among its dependencies gives it', () => {
        const [conan, ...others] = packageSourcesOf([]);

        expect(others).toEqual([]);
        expect(conan.name).toBe('conan');
        expect(conan.root).toBe(path.resolve(import.meta.dirname, '../../../extensions/conan'));
        expect(conan.packageSource).toMatchObject({ storeUnits: ['p/*/p', 'b/*/p'] });
        // One source for every config of the process: it keeps what it asked its tool.
        expect(packageSourcesOf([])[0]).toBe(conan);
    });

    test('a source crossbind.config.js lists joins conan, and one named conan takes its place', () => {
        const config = loadConfig({ extensions: [sourceOf('vcpkg')] });
        const replaced = loadConfig({ extensions: [sourceOf('conan')] });

        expect(sourceNamesOf(config)).toEqual(['conan', 'vcpkg']);
        expect(importSchemesOf(config)).toEqual(['cargo', 'conan', 'vcpkg']);
        expect(sourceNamesOf(replaced)).toEqual(['conan']);
        expect(replaced.packageSources[0].root).toBe(project);
    });

    test('an extension that gives no package source is none', () => {
        const config = loadConfig({ extensions: [{ name: 'acme-menu', contract: 1, root: project }] });

        expect(sourceNamesOf(config)).toEqual(['conan']);
    });
});

describe("what a project declares of its sources' packages", () => {
    test("is under packages by each source's name, as its imports open with it, read by the source's own check", () => {
        const config = loadConfig({
            extensions: [sourceOf('vcpkg', { check: (declared = {}) => Object.fromEntries(Object.entries(declared).map(([name, version]) => [name, { version }])) })],
            packages: { conan: { zlib: '1.3.2' }, vcpkg: { fmt: '12.2.0' } },
        });

        expect(config.packages).toEqual({ cargo: {}, conan: { zlib: { version: '1.3.2', options: {} } }, vcpkg: { fmt: { version: '12.2.0' } } });
        expect(dependenciesOf(config, 'vcpkg')).toEqual({ fmt: { version: '12.2.0' } });
        expect(declaredSources(config).map(({ name }) => name)).toEqual(['conan', 'vcpkg']);
    });

    test('a source nothing is declared of has none, and a project that names no packages declares none', () => {
        const config = loadConfig({ extensions: [sourceOf('vcpkg')], packages: { conan: { zlib: '1.3.2' } } });

        expect(config.packages.vcpkg).toEqual({});
        expect(declaredSources(config).map(({ name }) => name)).toEqual(['conan']);
        expect(loadConfig().packages).toEqual({ cargo: {}, conan: {} });
        expect(declaredSources(loadConfig())).toEqual([]);
    });

    test("a source's check takes what the project wrote under its name, and undefined where it wrote nothing", () => {
        const taken = [];
        const spying = (name) => sourceOf(name, { check: (declared) => { taken.push(declared); return declared ?? {}; } });

        loadConfig({ extensions: [spying('vcpkg')] });
        loadConfig({ extensions: [spying('vcpkg')], packages: { vcpkg: { fmt: '12.2.0' } } });
        // Every object has a constructor: only what the project wrote counts.
        loadConfig({ extensions: [spying('constructor')] });

        expect(taken).toEqual([undefined, { fmt: '12.2.0' }, undefined]);
    });

    test("an extension listed under conan's name checks packages.conan in its place", () => {
        const taken = [];
        const config = loadConfig({
            extensions: [sourceOf('conan', { check: (declared) => { taken.push(declared); return {}; } })],
            packages: { conan: { zlib: 'a spelling of its own' } },
        });

        expect(taken).toEqual([{ zlib: 'a spelling of its own' }]);
        expect(config.packages).toEqual({ cargo: {}, conan: {} });
    });

    test('a config loads the same twice and keeps what was written in it', () => {
        const written = { paths: { project }, packages: { cargo: { uuid: '1' }, conan: { zlib: '1.3.2' } } };

        expect(getFilledConfig(written).packages).toEqual(getFilledConfig(written).packages);
        expect(getFilledConfig(written).packages.cargo).not.toBe(written.packages.cargo);
        expect(written.packages).toEqual({ cargo: { uuid: '1' }, conan: { zlib: '1.3.2' } });
    });

    test('the key cargo and each source once had of its own is refused, with where its packages are declared now', () => {
        expect(() => loadConfig({ conanDependencies: { zlib: '1.3.2' } }))
            .toThrow('crossbind: conanDependencies is now packages.conan: write packages: { conan: { … } } in crossbind.config.');
        expect(() => loadConfig({ cargoDependencies: { uuid: '1' } }))
            .toThrow('crossbind: cargoDependencies is now packages.cargo: write packages: { cargo: { … } } in crossbind.config.');
        expect(() => loadConfig({ cargoDependencies: {} })).toThrow(/cargoDependencies is now packages\.cargo/);
        expect(() => loadConfig({ extensions: [sourceOf('vcpkg')], vcpkgDependencies: {} })).toThrow(/vcpkgDependencies is now packages\.vcpkg/);
    });

    test('a name under packages that is neither cargo nor a source of the project is refused, so that a misspelt one is not left unread', () => {
        expect(() => loadConfig({ packages: { connan: { zlib: '1.3.2' } } }))
            .toThrow('crossbind: packages.connan names neither cargo nor a package source of this project, which has conan. List its extension in extensions, or fix the name.');
        expect(() => loadConfig({ extensions: [sourceOf('vcpkg')], packages: { acme: {} } }))
            .toThrow(/packages\.acme names neither cargo nor a package source of this project, which has conan, vcpkg\./);
        expect(() => loadConfig({ packages: { crates: { uuid: '1' } } })).toThrow(/packages\.crates names neither cargo nor a package source/);
        expect(() => loadConfig({ packages: { '': { zlib: '1.3.2' } } })).toThrow(/names neither cargo nor a package source of this project/);
    });

    test("crates are declared under cargo, beside the sources' packages, as Cargo.toml takes each", () => {
        const crates = { uuid: '1', geo: '{ version = "0.29", default-features = false }' };
        const config = loadConfig({ packages: { cargo: crates, conan: { zlib: '1.3.2' } } });

        expect(dependenciesOf(config, 'cargo')).toEqual(crates);
        expect(dependenciesOf(loadConfig(), 'cargo')).toEqual({});
        // cargo is the core's own: no source of the project, and nothing a source installs.
        expect(sourceNamesOf(config)).toEqual(['conan']);
        expect(declaredSources(config).map(({ name }) => name)).toEqual(['conan']);
    });

    test('crates that are no object of them are refused', () => {
        for (const cargo of [['uuid'], 'uuid', null, 1]) {
            expect(() => loadConfig({ packages: { cargo } }), JSON.stringify(cargo))
                .toThrow("crossbind: packages.cargo must be an object of crates, such as { uuid: '1' }.");
        }
    });

    // Beside packages.conan, whose packages take { version, options }: a crate takes text, and a number would lose a
    // trailing zero, 0.10 becoming 0.1.
    test('a crate that is no text is refused, with what Cargo.toml takes', () => {
        for (const spec of [{ version: '1' }, 1, 0.10, null, ['1']]) {
            expect(() => loadConfig({ packages: { cargo: { semver: '1', uuid: spec } } }), JSON.stringify(spec))
                .toThrow('crossbind: packages.cargo.uuid must be text as Cargo.toml takes it: a version such as \'1\', or a table such as \'{ version = "1", features = ["v4"] }\'.');
        }
    });

    test('packages that is no object of sources is refused', () => {
        for (const packages of [['conan'], 'conan', null, 3]) {
            expect(() => loadConfig({ packages }), JSON.stringify(packages))
                .toThrow("crossbind: \"packages\" must be an object of each package source's packages, such as { conan: { zlib: '1.3.2' } }.");
        }
    });

    test("a declaration its source refuses stops the config, in the source's own words", () => {
        expect(() => loadConfig({ packages: { conan: { ZLib: '1.3.2' } } })).toThrow("crossbind: packages.conan key 'ZLib' is not a Conan package name (lower-case letters, digits and _ + . -).");
        expect(() => loadConfig({ packages: { conan: ['zlib'] } })).toThrow("crossbind: packages.conan must be an object such as { zlib: '1.3.1' }.");
    });

    // A package installs nothing for the project that depends on it, and one published before the move still loads.
    test("a dependency's own declarations are not read", () => {
        const written = {
            paths: { project }, cargoDependencies: { uuid: '1' }, conanDependencies: { zlib: '1.3.2' }, packages: { acme: {}, cargo: { geo: '0.29' } },
        };
        const dependency = getFilledConfig(written, { isDepend: true });

        expect(dependency.packages).toEqual({ cargo: {}, conan: {} });
    });

    test('a check that fails without saying whose it is, is named', () => {
        const failing = sourceOf('vcpkg', { check: () => { throw new TypeError('declared is not iterable'); } });

        expect(() => checkedDependencies(failing, {})).toThrow("crossbind: vcpkg's check failed: declared is not iterable");
    });

    test.each([
        ['nothing', undefined],
        ['a list', ['fmt']],
        ['text', 'fmt'],
        ['a name that is no package name', { '../fmt': '1.0' }],
        ['an upper-case name', { Fmt: '1.0' }],
        ['what is no JSON', { fmt: () => '1.0' }],
    ])('a check that gives %s is refused, as its result names folders and is kept as JSON', (title, given) => {
        expect(() => checkedDependencies(sourceOf('vcpkg', { check: () => given }), {})).toThrow(/vcpkg's check gives no packages\.vcpkg crossbind can use/);
    });
});

describe('what bound headers and built libraries see of the sources', () => {
    const attached = (source, name, ref) => ({ general: { name: `${source}_${name}`, packageSource: { name: source, package: { name, ref } } } });

    test('is nothing for a project that declares no package', () => {
        expect(packageSourceInputsOf({ packageSources: [{ name: 'conan' }], packages: { conan: {} }, allDependencies: [] })).toBeNull();
        expect(packageSourceInputsOf({ allDependencies: [] })).toBeNull();
    });

    test('is what each source was asked for and the packages staged for it, so a moved version binds again', () => {
        const config = {
            packageSources: [{ name: 'conan' }, { name: 'vcpkg' }],
            packages: { conan: { zlib: { version: '[>=1.3 <2]', options: {} } }, vcpkg: {} },
            allDependencies: [attached('conan', 'zlib', 'zlib/1.3.2#b'), attached('vcpkg', 'fmt', 'fmt/12.2.0'), { general: { name: 'matrix' } }],
        };

        expect(packageSourceInputsOf(config)).toEqual([
            { source: 'conan', dependencies: config.packages.conan, refs: ['zlib/1.3.2#b'] },
        ]);
    });

    test('the key of staged packages follows what was declared', () => {
        expect(dependenciesKey({ zlib: { version: '1.3.2', options: {} } })).toBe(dependenciesKey({ zlib: { version: '1.3.2', options: {} } }));
        expect(dependenciesKey({ zlib: { version: '1.3.2', options: {} } })).not.toBe(dependenciesKey({ zlib: { version: '1.3.1', options: {} } }));
    });
});
