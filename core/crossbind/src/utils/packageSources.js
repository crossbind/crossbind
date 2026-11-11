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

// What a project declares under packages, by each source's name as its imports open with it. A name that is no
// source of the project stops the config: a misspelt one would be left unread. So does the key a source once had of
// its own, with where its packages are declared now.
export function checkedPackages(sources, config) {
    const names = sources.map(({ name }) => name);
    const moved = names.find((name) => config[`${name}Dependencies`] !== undefined);
    if (moved) throw new Error(`crossbind: ${moved}Dependencies is now ${declarationOf(moved)}: write packages: { ${moved}: { … } } in crossbind.config.`);
    const { packages = {} } = config;
    if (packages === null || typeof packages !== 'object' || Array.isArray(packages)) {
        throw new Error("crossbind: \"packages\" must be an object of each package source's packages, such as { conan: { zlib: '1.3.2' } }.");
    }
    const unknown = Object.keys(packages).find((name) => !names.includes(name));
    if (unknown !== undefined) {
        const fix = unknown === 'cargo' ? 'Crates are declared in cargoDependencies.' : 'List its extension in extensions, or fix the name.';
        throw new Error(`crossbind: ${declarationOf(unknown)} names no package source of this project, which has ${names.join(', ')}. ${fix}`);
    }
    const written = (name) => (Object.hasOwn(packages, name) ? packages[name] : undefined);
    return Object.fromEntries(sources.map((source) => [source.name, checkedDependencies(source, written(source.name))]));
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
