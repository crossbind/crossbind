// Conan 2 refuses upper-case package names.
const CONAN_NAME = /^[a-z0-9_][a-z0-9_+.-]*$/;
// A plain version or a Conan range; a user, channel or recipe revision belongs in conan.lock instead.
const CONAN_VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const VERSION_RANGE = /^\[[^\]\n]+\]$/;
const OPTION_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OPTION_VALUE_TYPES = ['string', 'number', 'boolean'];

export function normalizeConanDependencies(raw) {
    if (raw === undefined) return {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error("crossbind: packages.conan must be an object such as { zlib: '1.3.1' }.");
    }
    return Object.fromEntries(Object.entries(raw).map(([name, spec]) => [name, normalizeSpec(name, spec)]));
}

function normalizeSpec(name, spec) {
    if (!CONAN_NAME.test(name)) {
        throw new Error(`crossbind: packages.conan key '${name}' is not a Conan package name (lower-case letters, digits and _ + . -).`);
    }
    const { version, options = {}, ...others } = typeof spec === 'string' ? { version: spec } : (spec ?? {});
    const [unknown] = Object.keys(others);
    if (unknown !== undefined) {
        throw new Error(`crossbind: packages.conan.${name} takes version and options, not '${unknown}'.`);
    }
    if (typeof version !== 'string' || !(CONAN_VERSION.test(version) || VERSION_RANGE.test(version))) {
        throw new Error(`crossbind: packages.conan.${name} needs a version such as '1.3.1' or a range such as '[>=1.3 <2]' (got ${JSON.stringify(version)}).`);
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
        throw new Error(`crossbind: packages.conan.${name}.options must be an object such as { enable_fts5: true }.`);
    }
    Object.entries(options).forEach(([key, value]) => {
        if (key === 'shared') {
            throw new Error(`crossbind: packages.conan.${name}.options.shared - crossbind links Conan packages statically into the module and sets shared=False itself.`);
        }
        if (!OPTION_NAME.test(key)) {
            throw new Error(`crossbind: packages.conan.${name}.options - '${key}' is not an option name.`);
        }
        if (!OPTION_VALUE_TYPES.includes(typeof value)) {
            throw new Error(`crossbind: packages.conan.${name}.options.${key} must be a string, number or boolean.`);
        }
    });
    return { version, options: { ...options } };
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

const optionNames = (options) => Object.keys(options ?? {}).filter((key) => OPTION_NAME.test(key));

// conan skips an option given by pattern (`zlib/*:name=value`) when the recipe has none of that name, so a misspelt
// one would build the package without it. A recipe may drop an option for a target, as zlib drops fPIC on Windows:
// its default_options still names it, and there conan's silence is right.
export function assertRecipeOptions(dependencies, nodes) {
    const isDeclared = (node) => node?.context === 'host' && typeof node.name === 'string' && Object.hasOwn(dependencies, node.name);
    Object.values(nodes).filter(isDeclared).forEach((node) => {
        const { version, options } = dependencies[node.name];
        const known = [...new Set([node.options, node.options_definitions, node.default_options].flatMap(optionNames))].sort();
        const unknown = Object.keys(options).find((key) => !known.includes(key));
        if (unknown === undefined) return;
        throw new Error(`crossbind: packages.conan.${node.name}.options - ${node.name}/${version} has no option '${unknown}'. ${known.length ? `It has: ${known.join(', ')}.` : 'It has none.'}`);
    });
}
