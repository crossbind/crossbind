import path from 'node:path';
import { createRequire } from 'node:module';
import {
    broughtExtension, isJsonValue, ownPackages, stepFailure, withListed,
} from './appExtensions.js';
import { getContentHash } from './hash.js';
import { PACKAGE_NAME, declarationOf, dependenciesOf } from './packageSourceImport.js';

// crossbind's own folder, whose dependencies name the extensions it brings.
const CORE_ROOT = path.join(import.meta.dirname, '..', '..');

// The extension packages crossbind itself brings, which a project neither installs nor lists.
export const packagesOfCrossbind = () => ownPackages(CORE_ROOT);

let own = null;

// crossbind's own package sources: those the extension packages among its dependencies give, which every project
// has by having crossbind. Loaded once, as a source may keep what it asked its tool.
function ownSources() {
    if (!own) {
        const load = createRequire(path.join(CORE_ROOT, 'package.json'));
        own = packagesOfCrossbind()
            .map((name) => broughtExtension(load, name, `update ${name} to match crossbind`))
            .filter((extension) => extension.packageSource);
    }
    return own;
}

// A project's package sources: crossbind's own, then those crossbind.config.js lists. One listed under the name of
// one of crossbind's takes its place.
export const packageSourcesOf = (listed) => withListed(ownSources(), listed.filter((extension) => extension.packageSource));

export { declarationOf, dependenciesOf };

// The sources a project declares packages of.
export const declaredSources = (config) => (config.packageSources ?? []).filter(({ name }) => Object.keys(dependenciesOf(config, name)).length > 0);

export const sourceNamesOf = (config) => (config.packageSources ?? []).map(({ name }) => name);

// What an import names a store by, as the node: and npm: schemes do: cargo's crates, and each source's packages.
export const importSchemesOf = (config) => ['cargo', ...sourceNamesOf(config)];

// What a project declares for a source, as the source's check takes it: a map of package names to what each asks
// for, in plain JSON, as it is hashed, kept in manifests and handed back to the source.
export function checkedDependencies({ name, packageSource }, raw) {
    let dependencies;
    try {
        dependencies = packageSource.check(raw);
    } catch (error) {
        throw stepFailure(name, 'check', error);
    }
    const isMap = dependencies !== null && typeof dependencies === 'object' && !Array.isArray(dependencies) && isJsonValue(dependencies);
    if (!isMap || !Object.keys(dependencies).every((pkg) => PACKAGE_NAME.test(pkg))) {
        throw new Error(`crossbind: ${name}'s check gives no ${declarationOf(name)} crossbind can use: a JSON map of package names, of lower-case letters, digits and _ + . -, to what each asks for.`);
    }
    return dependencies;
}

// cargo's crates, each as Cargo.toml takes it: a version, or the table that would follow `<crate> =`. Text, where a
// source's package may be an object: a number would lose a trailing zero, 0.10 becoming 0.1.
function checkedCrates(crates = {}) {
    if (crates === null || typeof crates !== 'object' || Array.isArray(crates)) {
        throw new Error(`crossbind: ${declarationOf('cargo')} must be an object of crates, such as { uuid: '1' }.`);
    }
    const [crate] = Object.entries(crates).find(([, spec]) => typeof spec !== 'string') ?? [];
    if (crate !== undefined) {
        throw new Error(`crossbind: ${declarationOf('cargo')}.${crate} must be text as Cargo.toml takes it: a version such as '1', or a table such as '{ version = "1", features = ["v4"] }'.`);
    }
    return { ...crates };
}

// What a project declares under packages, by the name its imports open with: cargo's crates, which are the core's
// own, and each source's packages. Another name stops the config: a misspelt one would be left unread. So does the
// key cargo or a source once had of its own, with where its packages are declared now and the config that holds it:
// a package crossbind builds from source loads as a project too, and its key is not the app's developer's to find.
export function checkedPackages(sources, config, file = 'crossbind.config') {
    const names = sources.map(({ name }) => name);
    const moved = ['cargo', ...names].find((name) => config[`${name}Dependencies`] !== undefined);
    if (moved) throw new Error(`crossbind: ${moved}Dependencies is now ${declarationOf(moved)}: write packages: { ${moved}: { … } } in ${file}.`);
    const { packages = {} } = config;
    if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
        throw new Error("crossbind: \"packages\" must be an object of each package source's packages, such as { conan: { zlib: '1.3.2' } }.");
    }
    const unknown = Object.keys(packages).find((name) => name !== 'cargo' && !names.includes(name));
    if (unknown !== undefined) {
        throw new Error(`crossbind: ${declarationOf(unknown)} names neither cargo nor a package source of this project, which has ${names.join(', ')}. List its extension in extensions, or fix the name.`);
    }
    const written = (name) => (Object.hasOwn(packages, name) ? packages[name] : undefined);
    return {
        cargo: checkedCrates(written('cargo')),
        ...Object.fromEntries(sources.map((source) => [source.name, checkedDependencies(source, written(source.name))])),
    };
}

// What staged packages were installed for; a change to the dependencies makes them stale.
export const dependenciesKey = (dependencies) => getContentHash(JSON.stringify(dependencies));

// What an app's headers and sources see of its sources' packages: the packages are staged after a header may
// already be bound, and restaged in place when one moves to another version. Null without any.
export function packageSourceInputsOf(config) {
    const declared = declaredSources(config);
    if (declared.length === 0) return null;
    return declared.map(({ name }) => ({
        source: name,
        dependencies: dependenciesOf(config, name),
        refs: config.allDependencies.filter(({ general }) => general.packageSource?.name === name).map(({ general }) => general.packageSource.package.ref),
    }));
}
