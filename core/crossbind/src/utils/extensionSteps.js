// What a publisher, an installer, a package source and a command of an extension's give, as crossbind takes them.

// A name prefixes the extension's functions and names its C++ entry, crossbind_extension_<name>.
export const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The platforms a publisher takes apps of, by the command line's names, and desktop for the three of them.
export const PUBLISH_PLATFORMS = ['android', 'ios', 'macos', 'linux', 'windows'];
const DESKTOP_PLATFORMS = ['macos', 'linux', 'windows'];

// The platforms a publisher or an installer names, one or a list of those it may, desktop for the three of them.
function checkedPlatforms(where, platform, allowed) {
    const named = [platform].flat();
    if (named.length === 0 || !named.every((one) => [...allowed, 'desktop'].includes(one))) {
        throw new Error(`crossbind: ${where}.platform is no platform or list of them, of ${[...allowed, 'desktop'].join(', ')}.`);
    }
    return [...new Set(named.flatMap((one) => (one === 'desktop' ? DESKTOP_PLATFORMS : [one])))];
}

// The platforms a publisher goes first for: all of its own for true, else those it lists of them.
function defaultPlatforms(where, isDefault, platforms) {
    if (isDefault === undefined || isDefault === false) return [];
    if (isDefault === true) return platforms;
    if (!Array.isArray(isDefault) || isDefault.length === 0 || !isDefault.every((one) => platforms.includes(one))) {
        throw new Error(`crossbind: ${where}.isDefault is neither true nor a list of its platforms, of ${platforms.join(', ')}.`);
    }
    return [...new Set(isDefault)];
}

// The steps an object gives are functions.
function assertSteps(where, object, steps) {
    const notSteps = steps.filter((step) => object[step] !== undefined && typeof object[step] !== 'function');
    if (notSteps.length > 0) throw new Error(`crossbind: ${where}'s ${notSteps.join(' and ')} ${notSteps.length > 1 ? 'are' : 'is'} no function.`);
}
// A publisher's steps: those of an upload; release, which crossbind app release runs to put out what testers have;
// send, which crossbind app store --send runs to send the store's page alone; state, which tells what the store has
// now; and guide.
const PUBLISHER_KEYS = ['platform', 'isDefault', 'store', 'options', 'after', 'canStage', 'build', 'check', 'buildNumber', 'buildEnv', 'upload', 'release', 'send', 'state', 'guide'];
const PUBLISHER_STEPS = ['build', 'check', 'buildNumber', 'buildEnv', 'upload', 'release', 'send', 'state', 'guide'];
// The steps of a publisher that builds, which one after another publisher leaves to that one.
const BUILD_STEPS = ['build', 'buildNumber', 'buildEnv'];
// The options `crossbind app upload` has of its own, with crossbind's, and those `vite build` takes, which the command
// line hands Vite: no publisher's takes the name of one.
const COMMAND_OPTIONS = ['platform', 'help', 'version'];
const VITE_OPTIONS = [
    'app', 'assetsDir', 'assetsInlineLimit', 'base', 'clearScreen', 'config', 'configLoader', 'debug', 'emptyOutDir', 'filter',
    'logLevel', 'manifest', 'minify', 'mode', 'outDir', 'profile', 'sourcemap', 'ssr', 'ssrManifest', 'target', 'watch',
];
// An option's name, as JavaScript writes it, whose --kebab-case the command line takes.
const OPTION_NAME = /^[a-z][a-zA-Z0-9]*$/;
const OPTION_KEYS = ['help', 'value', 'default'];

// An option as the command line takes it, which is a flag or takes a value.
function checkedOption(where, name, option) {
    const at = `${where}.options.${name}`;
    if (!OPTION_NAME.test(name) || COMMAND_OPTIONS.includes(name)) {
        throw new Error(`crossbind: ${where}.options names ${name}, which is no option of its own: one of letters and digits, starting with a lowercase letter, but ${COMMAND_OPTIONS.slice(0, -1).join(', ')} and ${COMMAND_OPTIONS.at(-1)}.`);
    }
    if (!isObject(option) || typeof option.help !== 'string') throw new Error(`crossbind: ${at} is no option, which is { help } for a flag and { help, value } for one that takes a value.`);
    const unknown = Object.keys(option).find((key) => !OPTION_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${at} takes ${OPTION_KEYS.join(', ')}; ${unknown} is none of them.`);
    if (option.value !== undefined && typeof option.value !== 'string') throw new Error(`crossbind: ${at}.value is no name of the value it takes, as '<track>'.`);
    if (option.default !== undefined && (option.value === undefined || typeof option.default !== 'string')) {
        throw new Error(`crossbind: ${at}.default is no value of an option that takes one: a string, beside its value.`);
    }
    return { help: option.help, value: option.value ?? null, default: option.default ?? null };
}

// A publisher's option, which takes no name of an option of the Vite build its publish runs.
function checkedPublishOption(where, name, option) {
    if (VITE_OPTIONS.includes(name)) {
        throw new Error(`crossbind: ${where}.options names ${name}, which is an option of the Vite build the upload runs, the command line's --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: name it otherwise.`);
    }
    return checkedOption(where, name, option);
}

// A publisher as crossbind runs it: the platforms it takes apps of, those of them an upload that names no store goes to it
// for, the name its store goes by, the options it takes on the command line, the publisher it comes after, where it does, whether its release reaches a share of the users at first, as --rollout asks, and its steps, which keep the object as their this.
export function checkedPublisher(publisher, where) {
    if (!isObject(publisher)) throw new Error(`crossbind: ${where} is no object.`);
    const unknown = Object.keys(publisher).find((key) => !PUBLISHER_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${PUBLISHER_KEYS.join(', ')}; ${unknown} is none of them.`);
    const platforms = checkedPlatforms(where, publisher.platform, PUBLISH_PLATFORMS);
    const isDefault = defaultPlatforms(where, publisher.isDefault, platforms);
    if (publisher.store !== undefined && typeof publisher.store !== 'string') throw new Error(`crossbind: ${where}.store is no name.`);
    if (publisher.after !== undefined && (typeof publisher.after !== 'string' || !NAME.test(publisher.after))) {
        throw new Error(`crossbind: ${where}.after is no name of a publisher.`);
    }
    if (publisher.canStage !== undefined && typeof publisher.canStage !== 'boolean') throw new Error(`crossbind: ${where}.canStage is neither true nor false.`);
    assertSteps(where, publisher, PUBLISHER_STEPS);
    if (!publisher.upload) throw new Error(`crossbind: ${where} has no upload, the step that sends the app to its store.`);
    const ownBuild = BUILD_STEPS.filter((step) => publisher[step]);
    if (publisher.after !== undefined && ownBuild.length > 0) {
        throw new Error(`crossbind: ${where} comes after ${publisher.after}, whose build it publishes from, so it takes no ${ownBuild.join(' or ')}.`);
    }
    const options = publisher.options ?? {};
    if (!isObject(options)) throw new Error(`crossbind: ${where}.options is no object of options.`);
    const steps = PUBLISHER_STEPS.filter((step) => publisher[step]).map((step) => [step, publisher[step].bind(publisher)]);
    return {
        platforms,
        ...(isDefault.length > 0 ? { isDefault } : {}),
        store: publisher.store ?? null,
        options: Object.fromEntries(Object.entries(options).map(([name, option]) => [name, checkedPublishOption(where, name, option)])),
        after: publisher.after ?? null,
        ...(publisher.canStage ? { canStage: true } : {}),
        ...Object.fromEntries(steps),
    };
}

const INSTALLER_STEPS = ['check', 'make'];
const INSTALLER_KEYS = ['platform', 'isLast', 'licenses', ...INSTALLER_STEPS];

// An installer as crossbind runs it: the desktop platforms whose apps it makes what installs, whether it runs after the
// others, whatever app.installers names, and its steps, which keep the object as their this.
export function checkedInstaller(installer, where) {
    if (!isObject(installer)) throw new Error(`crossbind: ${where} is no object.`);
    const unknown = Object.keys(installer).find((key) => !INSTALLER_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${INSTALLER_KEYS.join(', ')}; ${unknown} is none of them.`);
    const platforms = checkedPlatforms(where, installer.platform, DESKTOP_PLATFORMS);
    if (installer.isLast !== undefined && typeof installer.isLast !== 'boolean') throw new Error(`crossbind: ${where}.isLast is no boolean.`);
    assertSteps(where, installer, INSTALLER_STEPS);
    if (!installer.make) throw new Error(`crossbind: ${where} has no make, the step that makes what installs the app.`);
    const steps = INSTALLER_STEPS.filter((step) => installer[step]).map((step) => [step, installer[step].bind(installer)]);
    return { platforms, ...(installer.isLast ? { isLast: true } : {}), ...Object.fromEntries(steps) };
}

const PACKAGE_SOURCE_STEPS = ['check', 'inputs', 'install'];
const PACKAGE_SOURCE_KEYS = ['storeUnits', ...PACKAGE_SOURCE_STEPS];
// A package source's name starts its imports, its key in crossbind.config.js and its folders beside crossbind's own:
// one word, and none that means something there already: an import scheme of a bundler or a runtime, a folder of
// crossbind's, or a device's name, which Windows gives no folder.
const SOURCE_NAME = /^[a-z][a-z0-9]*$/;
const KEPT_SOURCE_NAMES = [
    'cargo', 'node', 'file', 'data', 'http', 'https', 'npm', 'virtual', 'blob', 'bun', 'deno', 'jsr', 'cloudflare', 'workerd',
    'all', 'android', 'build', 'config', 'deps', 'hermes', 'keys', 'secrets', 'sysroots', 'types',
    'con', 'prn', 'aux', 'nul',
];
const STORE_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
// Folders of a source's store that never change once written, as p/*/p names one in each folder of p.
const isStoreUnit = (unit) => typeof unit === 'string'
    && unit.split('/').every((segment) => segment === '*' || STORE_SEGMENT.test(segment))
    && unit.split('/').includes('*');

// A package source as crossbind runs it, under its extension's name: the folders of its store a remote runner sends
// back, and its steps, which keep the object as their this.
export function checkedPackageSource(packageSource, where, name) {
    if (!isObject(packageSource)) throw new Error(`crossbind: ${where} is no object.`);
    const unknown = Object.keys(packageSource).find((key) => !PACKAGE_SOURCE_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${PACKAGE_SOURCE_KEYS.join(', ')}; ${unknown} is none of them.`);
    if (!SOURCE_NAME.test(name) || KEPT_SOURCE_NAMES.includes(name)) {
        throw new Error(`crossbind: ${where} makes ${name} the name of a package source, which starts its imports, as ${name}:<package>/<header>: one word of lowercase letters and digits, and none of ${KEPT_SOURCE_NAMES.join(', ')}.`);
    }
    const storeUnits = packageSource.storeUnits ?? [];
    if (!Array.isArray(storeUnits) || !storeUnits.every(isStoreUnit)) {
        throw new Error(`crossbind: ${where}.storeUnits is no list of the folders of its store that never change once written, each a path with a * for a folder's name, as 'p/*/p'.`);
    }
    assertSteps(where, packageSource, PACKAGE_SOURCE_STEPS);
    if (!packageSource.check) throw new Error(`crossbind: ${where} has no check, the step that takes the project's packages.${name}.`);
    if (!packageSource.install) throw new Error(`crossbind: ${where} has no install, the step that installs a target's packages.`);
    const steps = PACKAGE_SOURCE_STEPS.filter((step) => packageSource[step]).map((step) => [step, packageSource[step].bind(packageSource)]);
    return { storeUnits: [...storeUnits], ...Object.fromEntries(steps) };
}

// What an extension adds that runs from the command line, commands or keys, by their names: each its line of help, the
// options it takes, as a publisher's, the step that does its work, and the other steps its kind takes, which keep the
// object as their this.
function checkedRunnables(entries, where, {
    noun, example, help, work, steps = [],
}) {
    if (!isObject(entries)) throw new Error(`crossbind: ${where} is no object of ${noun}s, as ${example}.`);
    const fields = ['help', 'options', 'run', ...steps];
    return Object.fromEntries(Object.entries(entries).map(([name, entry]) => {
        const at = `${where}.${name}`;
        if (!NAME.test(name)) throw new Error(`crossbind: ${where} names ${name}, which is no ${noun} of lowercase letters and digits, which dashes may join.`);
        if (!isObject(entry)) throw new Error(`crossbind: ${at} is no ${noun}, which is { help, run }.`);
        const unknown = Object.keys(entry).find((key) => !fields.includes(key));
        if (unknown) throw new Error(`crossbind: ${at} takes ${fields.join(', ')}; ${unknown} is none of them.`);
        if (typeof entry.help !== 'string' || entry.help === '') throw new Error(`crossbind: ${at} has no help, its line in ${help}.`);
        if (typeof entry.run !== 'function') throw new Error(`crossbind: ${at} has no run, the step that ${work}.`);
        assertSteps(at, entry, steps);
        const options = entry.options ?? {};
        if (!isObject(options)) throw new Error(`crossbind: ${at}.options is no object of options.`);
        return [name, {
            help: entry.help,
            options: Object.fromEntries(Object.entries(options).map(([option, value]) => [option, checkedOption(at, option, value)])),
            run: entry.run.bind(entry),
            ...Object.fromEntries(steps.filter((step) => entry[step]).map((step) => [step, entry[step].bind(entry)])),
        }];
    }));
}

// The commands an extension adds under crossbind app.
export const checkedCommands = (commands, where) => checkedRunnables(commands, where, {
    noun: 'command', example: "{ 'my-key': { help, run } }", help: 'crossbind app --help', work: 'does its work',
});

// The keys an extension adds under crossbind app key, each with the step that makes it and maybe state, which says
// where it is kept, as lines crossbind app key writes.
export const checkedKeys = (keys, where) => checkedRunnables(keys, where, {
    noun: 'key', example: '{ updater: { help, run } }', help: 'crossbind app key --help', work: 'makes it', steps: ['state'],
});
