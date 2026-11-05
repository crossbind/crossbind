import fs from 'node:fs';
import path from 'node:path';
import { checkedPrivacy, checkedUrlSchemes } from './appOptions.js';
import { isUnderBase } from './replaceBasePathForDocker.js';

// What an app extension compiles with on every platform, and on each: its sources, the folders of its own their
// includes are found in, and the macros they are compiled with.
const COMPILED = ['sources', 'includes', 'defines'];
// What an app extension may add on each platform, by the names crossbind's app commands give them, beside what it
// compiles with: the frameworks an Apple host links, the libraries another links, an Apple app's entitlements and
// Info.plist keys, an iOS app's reasons for Apple's required reason API, and of an Android app the folder of its Java
// with the class in it the app calls, the permissions it asks for, a manifest of its own and the resources the app takes.
const PLATFORM_PARTS = {
    macos: [...COMPILED, 'frameworks', 'entitlements', 'plist'],
    ios: [...COMPILED, 'frameworks', 'entitlements', 'plist', 'privacy'],
    linux: [...COMPILED, 'libraries'],
    windows: [...COMPILED, 'libraries'],
    android: [...COMPILED, 'libraries', 'java', 'class', 'permissions', 'manifest', 'resources'],
};
// An Android permission, as its manifest names it.
const PERMISSION = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/;
// The part of an extension a build's target takes, whose platform goes by Node's name.
const partOf = (platform) => ({ darwin: 'macos', win32: 'windows' })[platform] ?? platform;
// The host compiles C and C++ on every platform, and Objective-C and Objective-C++ on Apple's.
const SOURCE = /\.(c|cpp|cc|cxx)$/;
const APPLE_SOURCE = /\.(c|cpp|cc|cxx|m|mm)$/;
// A macro, NAME or NAME=value, of a value a compiler's command line takes as it is.
const DEFINE = /^[A-Za-z_][A-Za-z0-9_]*(=[A-Za-z0-9_.+-]*)?$/;
// A name prefixes the extension's functions and names its C++ entry, crossbind_extension_<name>.
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const LINK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;
// A class in a package, which the activity's package can name.
const JAVA_CLASS = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isEntitlement = (value) => typeof value === 'boolean' || typeof value === 'string'
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
// The deepest the host reads a JSON value nested, MAX_DEPTH in its extension.cpp.
const MAX_JSON_DEPTH = 64;
// A value JSON writes as it is, which the extension's native code reads back the same: no deeper than the host reads,
// its strings and keys without a lone surrogate, which the host would read as U+FFFD.
export const isJsonValue = (value, depth = 0) => depth <= MAX_JSON_DEPTH && (value === null || typeof value === 'boolean'
    || (typeof value === 'string' && value.isWellFormed())
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every((item) => isJsonValue(item, depth + 1)))
    || (isObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
        && Object.entries(value).every(([key, item]) => key.isWellFormed() && isJsonValue(item, depth + 1))));

// A file or folder of the extension's own, inside its folder.
function ownPath(where, root, file, isFolder = false) {
    const full = path.resolve(root, String(file));
    const relative = path.relative(root, full);
    if (typeof file !== 'string' || path.isAbsolute(file) || relative.startsWith('..') || relative === '') {
        throw new Error(`crossbind: ${where} names ${JSON.stringify(file)}, which is no path inside the extension's folder.`);
    }
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory() !== isFolder) {
        throw new Error(`crossbind: ${where} names ${file}, which is no ${isFolder ? 'folder' : 'file'} of the extension's.`);
    }
    return file;
}

function checkedSources(where, root, sources, pattern) {
    if (!Array.isArray(sources)) throw new Error(`crossbind: ${where} is no list of source files.`);
    return sources.map((file) => {
        if (!pattern.test(String(file))) throw new Error(`crossbind: ${where} names ${file}, which is no ${pattern === SOURCE ? 'C or C++' : 'C, C++, Objective-C or Objective-C++'} source.`);
        return ownPath(where, root, file);
    });
}

// The extension's folders, its own folder as '.' among them.
function checkedIncludes(where, root, includes) {
    if (!Array.isArray(includes)) throw new Error(`crossbind: ${where} is no list of the extension's folders.`);
    return includes.map((folder) => (folder === '.' ? folder : ownPath(where, root, folder, true)));
}

function checkedDefines(where, defines) {
    if (!Array.isArray(defines) || !defines.every((define) => typeof define === 'string' && DEFINE.test(define))) {
        throw new Error(`crossbind: ${where} is no list of macros, each NAME or NAME=value, a value of letters, digits and _.+- alone.`);
    }
    return defines;
}

// What an extension compiles with, on every platform or on one.
function checkedCompiled(at, root, key, value, pattern) {
    if (key === 'sources') return checkedSources(at, root, value, pattern);
    if (key === 'includes') return checkedIncludes(at, root, value);
    return checkedDefines(at, value);
}

function checkedNames(where, names) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && LINK_NAME.test(name))) {
        throw new Error(`crossbind: ${where} is no list of names.`);
    }
    return names;
}

function checkedEntitlements(where, entitlements) {
    if (!isObject(entitlements) || !Object.values(entitlements).every(isEntitlement)) {
        throw new Error(`crossbind: ${where} is no object of entitlements, each a boolean, a string or a list of strings.`);
    }
    return entitlements;
}

// Text an XML property list holds: well formed, without the control characters XML takes none of.
// eslint-disable-next-line no-control-regex
const isPlistText = (text) => text.isWellFormed() && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
// A value an Info.plist holds: text, a number, a boolean, and lists and dictionaries of them.
const isPlistValue = (value, depth = 0) => depth <= MAX_JSON_DEPTH && (typeof value === 'boolean'
    || (typeof value === 'string' && isPlistText(value))
    || (typeof value === 'number' && Number.isFinite(value))
    || (Array.isArray(value) && value.every((item) => isPlistValue(item, depth + 1)))
    || (isObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
        && Object.entries(value).every(([key, item]) => key !== '' && isPlistText(key) && isPlistValue(item, depth + 1))));

function checkedPlist(where, plist) {
    if (!isObject(plist) || !isPlistValue(plist)) {
        throw new Error(`crossbind: ${where} is no object of Info.plist keys, each with text, a number, a boolean, or a list or an object of them.`);
    }
    return plist;
}

function checkedPermissions(where, permissions) {
    if (!Array.isArray(permissions) || !permissions.every((permission) => typeof permission === 'string' && PERMISSION.test(permission))) {
        throw new Error(`crossbind: ${where} is no list of Android permissions, each by its full name, as android.permission.READ_CONTACTS.`);
    }
    return permissions;
}

const LICENSE_KEYS = ['name', 'version', 'license', 'file', 'source', 'sha256'];

// The code of others an extension carries, which the app's license report lists: its name and version, its license as
// an SPDX expression, the file of its license's text in the extension's folder, and where its source comes from.
function checkedLicenses(where, root, licenses) {
    if (!Array.isArray(licenses)) throw new Error(`crossbind: ${where} is no list of the code of others the extension carries.`);
    return licenses.map((entry, index) => {
        const at = `${where}[${index}]`;
        if (!isObject(entry) || !['name', 'version', 'license'].every((key) => typeof entry[key] === 'string' && entry[key] !== '')) {
            throw new Error(`crossbind: ${at} is no code the extension carries: { name, version, license, file }, with its license as an SPDX expression and its source and sha256 where it has them.`);
        }
        const unknown = Object.keys(entry).find((key) => !LICENSE_KEYS.includes(key));
        if (unknown) throw new Error(`crossbind: ${at} takes ${LICENSE_KEYS.join(', ')}; ${unknown} is none of them.`);
        if (entry.source !== undefined && typeof entry.source !== 'string') throw new Error(`crossbind: ${at}.source is no address of its source.`);
        if (entry.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error(`crossbind: ${at}.sha256 is no SHA-256, in 64 lowercase hex digits.`);
        return { ...entry, file: ownPath(`${at}.file`, root, entry.file) };
    });
}

// The app reaches an extension's Java through one class, whose source the folder of its Java holds by its package.
function checkedJava(where, root, { java, class: name }) {
    if (java === undefined || name === undefined) {
        throw new Error(`crossbind: ${where} takes java and class together: the folder of its Java and the Extension class in it the app calls.`);
    }
    if (typeof name !== 'string' || !JAVA_CLASS.test(name)) throw new Error(`crossbind: ${where}.class names ${name}, which is no Java class in a package.`);
    const source = `${path.join(java, ...name.split('.'))}.java`;
    if (!fs.existsSync(path.join(root, source))) throw new Error(`crossbind: ${where}.class names ${name}, which has no source ${source}.`);
}

function checkedPlatform(where, root, platform, part) {
    if (!isObject(part)) throw new Error(`crossbind: ${where} is no object.`);
    const allowed = PLATFORM_PARTS[platform];
    const checked = Object.fromEntries(Object.entries(part).map(([key, value]) => {
        const at = `${where}.${key}`;
        if (!allowed.includes(key)) throw new Error(`crossbind: ${where} takes ${allowed.join(', ')}; ${key} is none of them.`);
        if (COMPILED.includes(key)) return [key, checkedCompiled(at, root, key, value, ['macos', 'ios'].includes(platform) ? APPLE_SOURCE : SOURCE)];
        if (key === 'java' || key === 'resources') return [key, ownPath(at, root, value, true)];
        if (key === 'manifest') return [key, ownPath(at, root, value)];
        if (key === 'class') return [key, value];
        if (key === 'entitlements') return [key, checkedEntitlements(at, value)];
        if (key === 'plist') return [key, checkedPlist(at, value)];
        if (key === 'privacy') return [key, checkedPrivacy(value, at)];
        if (key === 'permissions') return [key, checkedPermissions(at, value)];
        return [key, checkedNames(at, value)];
    }));
    if ('java' in checked || 'class' in checked) checkedJava(where, root, checked);
    return checked;
}

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

// The steps an object gives are functions.
function assertSteps(where, object, steps) {
    const notSteps = steps.filter((step) => object[step] !== undefined && typeof object[step] !== 'function');
    if (notSteps.length > 0) throw new Error(`crossbind: ${where}'s ${notSteps.join(' and ')} ${notSteps.length > 1 ? 'are' : 'is'} no function.`);
}
const PUBLISHER_KEYS = ['platform', 'store', 'options', 'after', 'build', 'check', 'buildNumber', 'buildEnv', 'upload'];
const PUBLISHER_STEPS = ['build', 'check', 'buildNumber', 'buildEnv', 'upload'];
// The steps of a publisher that builds, which one after another publisher leaves to that one.
const BUILD_STEPS = ['build', 'buildNumber', 'buildEnv'];
// The options `crossbind app publish` has of its own, with crossbind's, and those `vite build` takes, which the command
// line hands Vite: no publisher's takes the name of one.
const COMMAND_OPTIONS = ['platform', 'help', 'version'];
const VITE_OPTIONS = [
    'app', 'assetsDir', 'assetsInlineLimit', 'base', 'clearScreen', 'config', 'configLoader', 'debug', 'emptyOutDir', 'filter',
    'logLevel', 'manifest', 'minify', 'mode', 'outDir', 'profile', 'sourcemap', 'ssr', 'ssrManifest', 'target', 'watch',
];
// An option's name, as JavaScript writes it, whose --kebab-case the command line takes.
const OPTION_NAME = /^[a-z][a-zA-Z0-9]*$/;
const OPTION_KEYS = ['help', 'value', 'default'];

function checkedPublishOption(where, name, option) {
    const at = `${where}.options.${name}`;
    if (!OPTION_NAME.test(name) || COMMAND_OPTIONS.includes(name)) {
        throw new Error(`crossbind: ${where}.options names ${name}, which is no option of its own: one of letters and digits, starting with a lowercase letter, but ${COMMAND_OPTIONS.slice(0, -1).join(', ')} and ${COMMAND_OPTIONS.at(-1)}.`);
    }
    if (VITE_OPTIONS.includes(name)) {
        throw new Error(`crossbind: ${where}.options names ${name}, which is an option of the Vite build the publish runs, the command line's --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: name it otherwise.`);
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

// A publisher as crossbind runs it: the platforms it takes apps of, the name its store goes by, the options it takes on
// the command line, the publisher it comes after, where it does, and its steps, which keep the object as their this.
export function checkedPublisher(publisher, where) {
    if (!isObject(publisher)) throw new Error(`crossbind: ${where} is no object.`);
    const unknown = Object.keys(publisher).find((key) => !PUBLISHER_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${PUBLISHER_KEYS.join(', ')}; ${unknown} is none of them.`);
    const platforms = checkedPlatforms(where, publisher.platform, PUBLISH_PLATFORMS);
    if (publisher.store !== undefined && typeof publisher.store !== 'string') throw new Error(`crossbind: ${where}.store is no name.`);
    if (publisher.after !== undefined && (typeof publisher.after !== 'string' || !NAME.test(publisher.after))) {
        throw new Error(`crossbind: ${where}.after is no name of a publisher.`);
    }
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
        store: publisher.store ?? null,
        options: Object.fromEntries(Object.entries(options).map(([name, option]) => [name, checkedPublishOption(where, name, option)])),
        after: publisher.after ?? null,
        ...Object.fromEntries(steps),
    };
}

const INSTALLER_STEPS = ['check', 'make'];
const INSTALLER_KEYS = ['platform', ...INSTALLER_STEPS];

// An installer as crossbind runs it: the desktop platforms whose apps it makes what installs, and its steps, which keep
// the object as their this.
export function checkedInstaller(installer, where) {
    if (!isObject(installer)) throw new Error(`crossbind: ${where} is no object.`);
    const unknown = Object.keys(installer).find((key) => !INSTALLER_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${INSTALLER_KEYS.join(', ')}; ${unknown} is none of them.`);
    const platforms = checkedPlatforms(where, installer.platform, DESKTOP_PLATFORMS);
    assertSteps(where, installer, INSTALLER_STEPS);
    if (!installer.make) throw new Error(`crossbind: ${where} has no make, the step that makes what installs the app.`);
    const steps = INSTALLER_STEPS.filter((step) => installer[step]).map((step) => [step, installer[step].bind(installer)]);
    return { platforms, ...Object.fromEntries(steps) };
}

// An extension as crossbind takes it, its paths relative to root: its name, in app the sources every platform compiles,
// the schemes whose links its native code gets and what each platform adds, the options its native code reads, and its
// publisher and its installer, where it has them.
export function checkedExtension(extension, root, where) {
    if (!isObject(extension) || typeof extension.name !== 'string' || !NAME.test(extension.name)) {
        throw new Error(`crossbind: ${where} has no name of lowercase letters and digits, which dashes may join.`);
    }
    const app = extension.app ?? {};
    if (!isObject(app)) throw new Error(`crossbind: ${where}'s app is no object.`);
    const checked = Object.fromEntries(Object.entries(app).map(([key, value]) => {
        const at = `${where}'s app.${key}`;
        if (COMPILED.includes(key)) return [key, checkedCompiled(at, root, key, value, SOURCE)];
        if (key === 'urlSchemes') return [key, checkedUrlSchemes(value, at)];
        if (key === 'licenses') return [key, checkedLicenses(at, root, value)];
        if (!Object.hasOwn(PLATFORM_PARTS, key)) {
            throw new Error(`crossbind: ${where}'s app takes ${COMPILED.join(', ')}, urlSchemes, licenses and ${Object.keys(PLATFORM_PARTS).join(', ')}; ${key} is none of them.`);
        }
        return [key, checkedPlatform(at, root, key, value)];
    }));
    const roles = {
        ...(extension.publisher === undefined ? {} : { publisher: checkedPublisher(extension.publisher, `${where}'s publisher`) }),
        ...(extension.installer === undefined ? {} : { installer: checkedInstaller(extension.installer, `${where}'s installer`) }),
    };
    if (extension.options === undefined) return { name: extension.name, root, app: checked, ...roles };
    if (!isJsonValue(extension.options)) {
        throw new Error(`crossbind: ${where}'s options are no JSON value the host reads as it is: plain objects, arrays, strings, finite numbers, booleans and null alone, 64 levels deep at most, without a lone surrogate.`);
    }
    return { name: extension.name, root, app: checked, options: extension.options, ...roles };
}

// The version of the contract between crossbind and its extensions, which a change that breaks an extension raises.
export const EXTENSION_CONTRACT = 1;

// The contract an extension is written for is this crossbind's: one written for another stops the build, naming what to
// update.
function checkedContract({ contract }, where, update) {
    if (contract === EXTENSION_CONTRACT) return;
    if (contract === undefined) {
        throw new Error(`crossbind: ${where} names no contract, the version of crossbind's extension contract it is written for, as contract: ${EXTENSION_CONTRACT} is for this crossbind: ${update}.`);
    }
    if (!Number.isInteger(contract) || contract < 1) throw new Error(`crossbind: ${where}'s contract ${JSON.stringify(contract)} is no version of crossbind's extension contract, as ${EXTENSION_CONTRACT} is.`);
    if (contract > EXTENSION_CONTRACT) {
        throw new Error(`crossbind: ${where} is written for crossbind's extension contract ${contract}, newer than this crossbind's ${EXTENSION_CONTRACT}: update crossbind.`);
    }
    throw new Error(`crossbind: ${where} is written for crossbind's extension contract ${contract}, older than this crossbind's ${EXTENSION_CONTRACT}: ${update}.`);
}

// The extension package a listed extension's folder is in, under the project's base, which its package.json names as
// one: its folder and its manifest.
export function extensionPackage(root, base) {
    for (let dir = root; isUnderBase(dir, base); dir = path.dirname(dir)) {
        const file = path.join(dir, 'package.json');
        if (fs.existsSync(file)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
                return typeof manifest.crossbind?.extension === 'string' ? { dir, manifest } : null;
            } catch {
                return null;
            }
        }
        if (path.dirname(dir) === dir) return null;
    }
    return null;
}

// What an extension of crossbind's build once hooked into, which no build runs.
const OLD_HOOKS = ['loadConfig', 'buildWasm', 'createLib'];
const LISTED_KEYS = ['name', 'contract', 'root', 'app', 'options', 'publisher', 'installer'];

// An extension crossbind.config.js lists, as its package's crossbind.extension.js gives it: its name, the folder its
// files are in, which a build sees under the project's base alone, and what it adds to an app.
export function listedExtension(extension, where, base) {
    if (!isObject(extension)) throw new Error(`crossbind: ${where} is no extension, as an extension package's crossbind.extension.js gives one.`);
    const hooks = Object.keys(extension).filter((key) => OLD_HOOKS.includes(key));
    if (hooks.length > 0) {
        throw new Error(`crossbind: ${where} has the hooks ${hooks.join(', ')}, which crossbind no longer runs: an extension adds native code to an app. Set build flags in targetSpecs or crossbind.build.js.`);
    }
    const { root } = extension;
    const isFolder = typeof root === 'string' && path.isAbsolute(root) && fs.existsSync(root) && fs.statSync(root).isDirectory();
    // An extension of another contract may hold what this crossbind knows nothing of, so the contract comes first.
    const owner = isFolder && isUnderBase(root, base) ? extensionPackage(root, base)?.manifest.name : null;
    checkedContract(extension, where, `update ${owner ?? 'it'} to a version written for this crossbind`);
    const unknown = Object.keys(extension).find((key) => !LISTED_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${LISTED_KEYS.join(', ')}; ${unknown} is none of them.`);
    if (!isFolder) throw new Error(`crossbind: ${where} has no root, the absolute path of the folder its files are in.`);
    if (!isUnderBase(root, base)) throw new Error(`crossbind: ${where}'s root ${root} is outside ${base}, the project's base and all a build sees.`);
    return checkedExtension(extension, root, where);
}

// The host's own extensions: one folder of the host's extensions/ each, named as its extension.json names it.
export function hostExtensions(appHostRoot) {
    const dir = path.join(appHostRoot, 'extensions');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort().filter((folder) => fs.existsSync(path.join(dir, folder, 'extension.json'))).map((folder) => {
        const file = path.join(dir, folder, 'extension.json');
        let extension;
        try {
            extension = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (error) {
            throw new Error(`crossbind: cannot read the extension ${file}: ${error.message}`, { cause: error });
        }
        checkedContract(extension ?? {}, file, 'update @crossbind/core-app-host to match crossbind');
        const checked = checkedExtension(extension, path.dirname(file), file);
        if (checked.name !== folder) throw new Error(`crossbind: ${file} names the extension ${checked.name}, not ${folder} as its folder.`);
        return checked;
    });
}

// A step of an extension's publisher or installer: a failure whose message is not crossbind's own stops the run with one
// that names the extension and the step.
export async function extensionStep(name, which, run) {
    try {
        return await run();
    } catch (error) {
        if (error instanceof Error && error.message.startsWith('crossbind:')) throw error;
        throw new Error(`crossbind: ${name}'s ${which} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
}

// The host's own extensions with the options the app's give them, each by its own name.
export const withOptions = (extensions, options) => extensions.map((extension) => (Object.hasOwn(options, extension.name)
    ? { ...extension, options: options[extension.name] } : extension));

// The host's own extensions an app has, with the options the app's give them: every one, but the instance, the links,
// the page's location and the updater only where they give them options, as a desktop app's do that keeps one instance
// or has app.updater, an app's that lists app.urlSchemes, and a macOS app's whose app.permissions lists the location.
// The host refuses the updater's functions to any other app.
export const appHostExtensions = (appHostRoot, options) => withOptions(hostExtensions(appHostRoot), options)
    .filter((extension) => !['instance', 'links', 'page-location', 'updater'].includes(extension.name) || Object.hasOwn(options, extension.name));

// The extensions crossbind.config.js lists that add to an app: all but those that give a publisher or an installer
// alone, which leave the host's own of their name as it is.
export const appExtensionsOf = (listed) => listed
    .filter((extension) => (!extension.publisher && !extension.installer) || Object.keys(extension.app).length > 0);

// The host's own extensions an app has, then those crossbind.config.js lists: one listed under the name of one of the
// host's takes its place.
export function withListed(own, listed) {
    const kept = own.map((extension) => listed.find(({ name }) => name === extension.name) ?? extension);
    return [...kept, ...listed.filter((extension) => !kept.includes(extension))];
}

// What two owners give one key: one value alike, or lists, which join; two that give it different values stop the
// build, naming both.
function joined(what, key, first, owner, value) {
    if (Array.isArray(first.value) && Array.isArray(value)) {
        return [...first.value, ...value.filter((item) => !first.value.some((had) => JSON.stringify(had) === JSON.stringify(item)))];
    }
    if (JSON.stringify(first.value) !== JSON.stringify(value)) throw new Error(`crossbind: ${first.owner} and ${owner} give the ${what} ${key} different values.`);
    return first.value;
}

// The keys of several owners, in the order they are claimed.
function mergedKeys(what, owned) {
    const merged = new Map();
    for (const [owner, keys] of owned) {
        for (const [key, value] of Object.entries(keys)) {
            const first = merged.get(key);
            merged.set(key, first ? { owner: first.owner, value: joined(what, key, first, owner, value) } : { owner, value });
        }
    }
    return Object.fromEntries([...merged].map(([key, { value }]) => [key, value]));
}

// The entitlements of several owners, as one claims each.
export const mergedEntitlements = (owned) => mergedKeys('entitlement', owned);

// An Apple app's Info.plist, crossbind's, with the keys its extensions give: one crossbind writes from the app's config
// an extension gives with the same value alone.
export function mergedPlist(base, owned) {
    for (const [owner, plist] of owned) {
        const written = Object.keys(plist).find((key) => Object.hasOwn(base, key) && JSON.stringify(base[key]) !== JSON.stringify(plist[key]));
        if (written) throw new Error(`crossbind: ${owner} gives the Info.plist key ${written}, which crossbind writes from the app's config.`);
    }
    const added = owned.map(([owner, plist]) => [owner, Object.fromEntries(Object.entries(plist).filter(([key]) => !Object.hasOwn(base, key)))]);
    return { ...base, ...mergedKeys('Info.plist key', added) };
}

// An iOS app's reasons for Apple's required reason API: app.privacy's, with those its extensions give.
export function mergedPrivacy(base, owned) {
    const merged = Object.fromEntries(Object.entries(base).map(([category, reasons]) => [category, [...reasons]]));
    owned.forEach(([, privacy]) => Object.entries(privacy).forEach(([category, reasons]) => {
        merged[category] = [...new Set([...(merged[category] ?? []), ...reasons])];
    }));
    return merged;
}

const unique = (items) => [...new Set(items)];

// What the extensions add on one platform: the names and folders of those with native code, the sources the host
// compiles, by their full paths, the frameworks and the libraries it links, each once, the Java folders of an Android
// app with the class of each, and the entitlements of an Apple one by their owners, for mergedEntitlements().
export function extensionPart(extensions, platform) {
    const names = new Set();
    for (const { name } of extensions) {
        if (names.has(name)) throw new Error(`crossbind: the app has two extensions named ${name}.`);
        names.add(name);
    }
    const own = (extension) => extension.app[partOf(platform)] ?? {};
    // What every platform's and this one's part give of a kind, every platform's first.
    const both = (extension, key) => [...(extension.app[key] ?? []), ...(own(extension)[key] ?? [])];
    const sourcesOf = (extension) => both(extension, 'sources').map((file) => path.join(extension.root, file));
    // What each extension that gives it gives of a kind, by its owner, for the merges.
    const owned = (key) => extensions.filter((extension) => own(extension)[key]).map((extension) => [`the extension ${extension.name}`, own(extension)[key]]);
    const native = extensions.filter((extension) => sourcesOf(extension).length > 0);
    return {
        native: native.map(({ name, options }) => ({ name, options: options ?? null })),
        roots: native.map(({ root }) => root),
        sources: extensions.flatMap(sourcesOf),
        compiled: native.map((extension) => ({
            name: extension.name,
            sources: sourcesOf(extension),
            includes: both(extension, 'includes').map((folder) => path.join(extension.root, folder)),
            defines: both(extension, 'defines'),
        })),
        frameworks: unique(extensions.flatMap((extension) => own(extension).frameworks ?? [])),
        libraries: unique(extensions.flatMap((extension) => own(extension).libraries ?? [])),
        java: extensions.filter((extension) => own(extension).java).map((extension) => ({
            name: extension.name, dir: path.join(extension.root, own(extension).java), className: own(extension).class,
        })),
        entitlements: owned('entitlements'),
        plist: owned('plist'),
        privacy: owned('privacy'),
        permissions: unique(extensions.flatMap((extension) => own(extension).permissions ?? [])),
        manifests: extensions.filter((extension) => own(extension).manifest)
            .map((extension) => ({ name: extension.name, file: path.join(extension.root, own(extension).manifest) })),
        resources: extensions.filter((extension) => own(extension).resources)
            .map((extension) => ({ name: extension.name, dir: path.join(extension.root, own(extension).resources) })),
    };
}

const entryOf = (name) => `crossbind_extension_${name.replace(/-/g, '_')}`;

// What the host's CMake project gets of the extensions it compiles, each on its own: their names, and each one's
// sources, folders of includes and macros, as the cache's lists.
export function extensionCmakeArgs(compiled) {
    const variable = (name) => `CROSSBIND_EXTENSION_${name.replace(/-/g, '_')}`;
    return [
        `-DCROSSBIND_EXTENSIONS=${compiled.map(({ name }) => name.replace(/-/g, '_')).join(';')}`,
        ...compiled.flatMap(({ name, sources, includes, defines }) => [
            `-D${variable(name)}_SOURCES=${sources.join(';')}`,
            `-D${variable(name)}_INCLUDES=${includes.join(';')}`,
            `-D${variable(name)}_DEFINES=${defines.join(';')}`,
        ]),
    ];
}

// The C++ text of an extension's options, a raw string of their JSON, which the host reads back. A raw string's
// delimiter takes 16 characters at most.
function optionsText(name, options) {
    const json = JSON.stringify(options);
    if (json.includes(')crossbind_json"')) {
        throw new Error(`crossbind: the extension ${name}'s options hold )crossbind_json", which ends the text the host reads them from.`);
    }
    return `R"crossbind_json(${json})crossbind_json"`;
}

// The C++ that starts the extensions with native code, each through its entry, which its sources define, with its
// options, and that names the owner of each of the app's URL schemes: the extension that declared it, or for those of
// app.urlSchemes the host's links, which hands them to the page. The owner of a scheme has native code to get its
// links.
export function registrationSource(native, urlSchemes) {
    const owned = urlSchemes.map(({ scheme, extension }) => ({ scheme, owner: extension ?? 'links' }));
    const unheard = owned.find(({ owner }) => !native.some(({ name }) => name === owner));
    if (unheard) throw new Error(`crossbind: the extension ${unheard.owner} gets the links of ${unheard.scheme}, but has no native code on this platform.`);
    const start = ({ name, options }) => `    startExtension("${name}", ${options === null ? 'nullptr' : optionsText(name, options)}, ${entryOf(name)});`;
    return [
        "// crossbind writes this file from the app's extensions: the entry of each one with native code, which starts it with",
        "// its options, and the owner of each of the app's URL schemes, the extension that gets its links.",
        '#include "crossbind/extension.h"',
        '',
        ...native.map(({ name }) => `void ${entryOf(name)}(crossbind::Registry &registry);`),
        ...(native.length > 0 ? [''] : []),
        'namespace crossbind::app {',
        '',
        'void startExtension(const char *name, const char *options, void (*entry)(Registry &));',
        '',
        'void extensionEntries() {',
        ...native.map(start),
        '}',
        '',
        'std::vector<std::pair<std::string, std::string>> urlSchemes() {',
        `    return {${owned.map(({ scheme, owner }) => `{"${scheme}", "${owner}"}`).join(', ')}};`,
        '}',
        '',
        '}  // namespace crossbind::app',
        '',
    ].join('\n');
}
