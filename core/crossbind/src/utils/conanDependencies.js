import { CONAN_NAME } from './conanImport.js';
import { getContentHash } from './hash.js';

// A plain version or a Conan range; a user, channel or recipe revision belongs in conan.lock instead.
export const CONAN_VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const VERSION_RANGE = /^\[[^\]\n]+\]$/;
const OPTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPTION_VALUE_TYPES = ['string', 'number', 'boolean'];

export function normalizeConanDependencies(raw) {
    if (raw === undefined) return {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('crossbind: "conanDependencies" must be an object such as { zlib: \'1.3.1\' }.');
    }
    return Object.fromEntries(Object.entries(raw).map(([name, spec]) => [name, normalizeSpec(name, spec)]));
}

function normalizeSpec(name, spec) {
    if (!CONAN_NAME.test(name)) {
        throw new Error(`crossbind: conanDependencies key '${name}' is not a Conan package name (lower-case letters, digits and _ + . -).`);
    }
    const { version, options = {} } = typeof spec === 'string' ? { version: spec } : (spec ?? {});
    if (typeof version !== 'string' || !(CONAN_VERSION.test(version) || VERSION_RANGE.test(version))) {
        throw new Error(`crossbind: conanDependencies.${name} needs a version such as '1.3.1' or a range such as '[>=1.3 <2]' (got ${JSON.stringify(version)}).`);
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error(`crossbind: conanDependencies.${name}.options must be an object such as { enable_fts5: true }.`);
    }
    Object.entries(options).forEach(([key, value]) => {
        if (key === 'shared') {
            throw new Error(`crossbind: conanDependencies.${name}.options.shared - crossbind links Conan packages statically into the module and sets shared=False itself.`);
        }
        if (!OPTION_NAME.test(key)) {
            throw new Error(`crossbind: conanDependencies.${name}.options - '${key}' is not an option name.`);
        }
        if (!OPTION_VALUE_TYPES.includes(typeof value)) {
            throw new Error(`crossbind: conanDependencies.${name}.options.${key} must be a string, number or boolean.`);
        }
    });
    return { version, options: { ...options } };
}

// What staged packages were installed for; a change to conanDependencies makes them stale.
export const conanDependenciesKey = (dependencies) => getContentHash(JSON.stringify(dependencies));

// What an app's headers and sources see of its Conan packages: the packages are staged after a header
// may already be bound, and restaged in place when one moves to another version. Null without any.
export function conanInputsOf(config) {
    if (Object.keys(config.conanDependencies ?? {}).length === 0) return null;
    return {
        dependencies: config.conanDependencies,
        refs: config.allDependencies.filter((d) => d.general.conan).map((d) => d.general.conan.ref),
    };
}

export const conanRequires = (dependencies) => Object.entries(dependencies).map(([name, { version }]) => `${name}/${version}`);

function optionValue(value) {
    if (value === true) return 'True';
    if (value === false) return 'False';
    return String(value);
}

export const conanOptionArgs = (dependencies) => Object.entries(dependencies).flatMap(([name, { options }]) => (
    Object.entries(options).flatMap(([key, value]) => ['-o:h', `${name}/*:${key}=${optionValue(value)}`])
));
