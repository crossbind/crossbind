import fs from 'node:fs';
import path from 'node:path';
import { carriedPath, isOutside } from './appFiles.js';
import { checkedActivityTypes, checkedFileTypes, checkedLinks, checkedShortcutItems } from './appLaunches.js';
import { checkedPrivacy, checkedUrlSchemes } from './appOptions.js';
import { checkedTargetKind, checkedTargetOptions, isHeader } from './appTargets.js';
import { isUnderBase } from './replaceBasePathForDocker.js';

// What an app extension compiles with on every platform, and on each: its sources, the folders of its own their
// includes are found in, and the macros they are compiled with.
const COMPILED = ['sources', 'includes', 'defines'];
// What an app extension may add on each platform, by the names crossbind's app commands give them, beside what it
// compiles with and the files it carries: the frameworks an Apple host links, the libraries another links, an Apple
// app's entitlements and Info.plist keys, an iOS app's reasons for Apple's required reason API and the targets of Apple's
// app extensions it adds, and of an Android app the folder of its Java with the class in it the app calls, the
// permissions it asks for, a manifest of its own and the resources the app takes.
const PLATFORM_PARTS = {
    macos: [...COMPILED, 'files', 'frameworks', 'entitlements', 'plist'],
    ios: [...COMPILED, 'files', 'frameworks', 'entitlements', 'plist', 'privacy', 'targets'],
    linux: [...COMPILED, 'files', 'libraries', 'packages', 'depends'],
    windows: [...COMPILED, 'files', 'libraries'],
    android: [...COMPILED, 'files', 'libraries', 'java', 'class', 'permissions', 'manifest', 'resources', 'maven', 'verification'],
};
// An Android permission, as its manifest names it.
const PERMISSION = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/;
// The part of an extension a build's target takes, whose platform goes by Node's name.
const partOf = (platform) => ({ darwin: 'macos', win32: 'windows' })[platform] ?? platform;
// The host compiles C and C++ on every platform, and Objective-C, Objective-C++ and Swift on Apple's.
const SOURCE = /\.(c|cpp|cc|cxx)$/;
const APPLE_SOURCE = /\.(c|cpp|cc|cxx|m|mm|swift)$/;
// An iOS app extension's sources, which Xcode compiles, with the headers they import from beside them.
const TARGET_SOURCE = /\.(c|cpp|cc|cxx|m|mm|swift|h|hpp)$/;
const isSwift = (file) => file.endsWith('.swift');
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

// The full path of a path of the extension's own, inside its folder.
function insideOwn(where, root, file) {
    const full = path.resolve(root, String(file));
    const relative = path.relative(root, full);
    if (typeof file !== 'string' || path.isAbsolute(file) || isOutside(relative) || relative === '') {
        throw new Error(`crossbind: ${where} names ${JSON.stringify(file)}, which is no path inside the extension's folder.`);
    }
    return full;
}

// A file or folder of the extension's own, inside its folder.
function ownPath(where, root, file, isFolder = false) {
    const full = insideOwn(where, root, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory() !== isFolder) {
        throw new Error(`crossbind: ${where} names ${file}, which is no ${isFolder ? 'folder' : 'file'} of the extension's.`);
    }
    return file;
}

// The files and folders an extension carries, as app.files and a platform's files list them, inside its folder.
function checkedFiles(where, root, files) {
    if (!Array.isArray(files)) throw new Error(`crossbind: ${where} is no list of the files and folders the extension carries.`);
    return files.map((file) => carriedPath(where, root, file, "extension's"));
}

function checkedSources(where, root, sources, pattern) {
    if (!Array.isArray(sources)) throw new Error(`crossbind: ${where} is no list of source files.`);
    return sources.map((file) => {
        const kinds = { [SOURCE]: 'C or C++ source', [APPLE_SOURCE]: 'C, C++, Objective-C, Objective-C++ or Swift source' }[pattern] ?? 'C, C++, Objective-C, Objective-C++ or Swift source, nor a header';
        if (!pattern.test(String(file))) throw new Error(`crossbind: ${where} names ${file}, which is no ${kinds}.`);
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

// An Ubuntu 22.04 package a Linux extension compiles and links against beside crossbind's sysroot, as the sysroot's own
// list names one: its Debian architecture, its file, which Launchpad serves, and the SHA-256 the Packages index gives.
const PACKAGE = /^(amd64|arm64) ([a-z0-9][a-z0-9+.-]*_[A-Za-z0-9.+~-]+_(amd64|arm64|all)\.deb) ([0-9a-f]{64})$/;
// A relation of the app's Debian package, as its Depends takes one: a package, maybe of some versions, or alternatives.
const RELATION = /^[a-z0-9][a-z0-9+.-]+( \((<<|<=|=|>=|>>) [A-Za-z0-9.+~:-]+\))?$/;

function checkedPackages(where, packages) {
    if (!Array.isArray(packages)) throw new Error(`crossbind: ${where} is no list of packages.`);
    return packages.map((line) => {
        const match = typeof line === 'string' ? line.match(PACKAGE) : null;
        if (!match || !['all', match[1]].includes(match[3])) {
            throw new Error(`crossbind: ${where} names ${JSON.stringify(line)}, which is no "<arch> <file> <sha256>" of an Ubuntu 22.04 package of amd64 or arm64, as "amd64 libzstd-dev_1.4.8+dfsg-3build1_amd64.deb 9712…".`);
        }
        return line;
    });
}

// A library of Maven's an Android extension's Java uses, as Gradle names one, of one version: no range, which a later
// release would change under the checksums the extension lists.
const MAVEN = /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9][A-Za-z0-9_.-]*(@[a-z]+)?$/;

function checkedMaven(where, maven) {
    if (!Array.isArray(maven) || !maven.every((coordinate) => typeof coordinate === 'string' && MAVEN.test(coordinate))) {
        throw new Error(`crossbind: ${where} is no list of Maven libraries of one version each, as ['javax.inject:javax.inject:1'].`);
    }
    return maven;
}

function checkedDepends(where, depends) {
    if (!Array.isArray(depends) || !depends.every((relation) => typeof relation === 'string' && relation.split(' | ').every((one) => RELATION.test(one)))) {
        throw new Error(`crossbind: ${where} is no list of the Debian packages the app needs, as ['libzstd1', 'libsecret-1-0 (>= 0.20.5)'].`);
    }
    return depends;
}

function checkedNames(where, names) {
    if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && LINK_NAME.test(name))) {
        throw new Error(`crossbind: ${where} is no list of names.`);
    }
    return names;
}

// The entitlements crossbind joins the app's own with, which are lists.
const LISTED_ENTITLEMENTS = ['com.apple.security.application-groups', 'com.apple.developer.associated-domains'];

function checkedEntitlements(where, entitlements) {
    if (!isObject(entitlements) || !Object.values(entitlements).every(isEntitlement)) {
        throw new Error(`crossbind: ${where} is no object of entitlements, each a boolean, a string or a list of strings.`);
    }
    const single = LISTED_ENTITLEMENTS.find((key) => Object.hasOwn(entitlements, key) && !Array.isArray(entitlements[key]));
    if (single) throw new Error(`crossbind: ${where}.${single} is no list, which crossbind joins with the app's.`);
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

// The app reaches an extension's Java through one class, whose source, in Java or Kotlin, the folder of its Java holds by
// its package.
function checkedJava(where, root, { java, class: name }) {
    if (java === undefined || name === undefined) {
        throw new Error(`crossbind: ${where} takes java and class together: the folder of its Java and the Extension class in it the app calls.`);
    }
    if (typeof name !== 'string' || !JAVA_CLASS.test(name)) throw new Error(`crossbind: ${where}.class names ${name}, which is no Java class in a package.`);
    const source = path.join(java, ...name.split('.'));
    if (!['.java', '.kt'].some((ending) => fs.existsSync(path.join(root, `${source}${ending}`)))) {
        throw new Error(`crossbind: ${where}.class names ${name}, which has no source ${source}.java or ${source}.kt.`);
    }
}

// The targets of Apple's app extensions an extension adds to an iOS app, each compiling its own sources alone, with its
// resources, Info.plist keys and attributes, entitlements, frameworks and reasons for Apple's required reason API.
function checkedTargets(where, root, targets) {
    if (!Array.isArray(targets)) throw new Error(`crossbind: ${where} is no list of targets, as [{ name: 'clock', kind: 'widget', sources: ['ios/Clock.swift'] }] is.`);
    const names = new Set();
    return targets.map((target, index) => {
        const at = `${where}[${index}]`;
        if (!isObject(target)) throw new Error(`crossbind: ${at} is no object of a target.`);
        checkedTargetKind(at, target);
        if (names.has(target.name)) throw new Error(`crossbind: ${where} names two targets ${target.name}.`);
        names.add(target.name);
        const sources = Array.isArray(target.sources) ? checkedSources(`${at}.sources`, root, target.sources, TARGET_SOURCE) : [];
        if (!sources.some((file) => !isHeader(file))) throw new Error(`crossbind: ${at} has no sources, which a target compiles alone.`);
        const given = (key, check) => (target[key] === undefined ? {} : { [key]: check(`${at}.${key}`, target[key]) });
        const checked = {
            ...target,
            sources,
            // With slashes, as the Xcode project takes them, on Windows too.
            ...given('resources', (atKey, value) => checkedFiles(atKey, root, value).map((file) => file.split(path.sep).join('/'))),
            ...given('plist', checkedPlist),
            ...given('attributes', checkedPlist),
            ...given('entitlements', checkedEntitlements),
            ...given('frameworks', checkedNames),
            ...given('privacy', (atKey, value) => checkedPrivacy(value, atKey)),
        };
        checkedTargetOptions(at, checked, sources);
        return checked;
    });
}

function checkedPlatform(where, root, platform, part) {
    if (!isObject(part)) throw new Error(`crossbind: ${where} is no object.`);
    const allowed = PLATFORM_PARTS[platform];
    const checked = Object.fromEntries(Object.entries(part).map(([key, value]) => {
        const at = `${where}.${key}`;
        if (!allowed.includes(key)) throw new Error(`crossbind: ${where} takes ${allowed.join(', ')}; ${key} is none of them.`);
        if (COMPILED.includes(key)) return [key, checkedCompiled(at, root, key, value, ['macos', 'ios'].includes(platform) ? APPLE_SOURCE : SOURCE)];
        if (key === 'files') return [key, checkedFiles(at, root, value)];
        if (key === 'java' || key === 'resources') return [key, ownPath(at, root, value, true)];
        if (key === 'manifest') return [key, ownPath(at, root, value)];
        if (key === 'class') return [key, value];
        if (key === 'entitlements') return [key, checkedEntitlements(at, value)];
        if (key === 'plist') return [key, checkedPlist(at, value)];
        if (key === 'privacy') return [key, checkedPrivacy(value, at)];
        if (key === 'targets') return [key, checkedTargets(at, root, value)];
        if (key === 'permissions') return [key, checkedPermissions(at, value)];
        if (key === 'packages') return [key, checkedPackages(at, value)];
        if (key === 'depends') return [key, checkedDepends(at, value)];
        if (key === 'maven') return [key, checkedMaven(at, value)];
        if (key === 'verification') return [key, ownPath(at, root, value)];
        return [key, checkedNames(at, value)];
    }));
    if ('java' in checked || 'class' in checked) checkedJava(where, root, checked);
    if (('maven' in checked) !== ('verification' in checked)) {
        throw new Error(`crossbind: ${where} takes maven and verification together: the libraries Gradle resolves for it, and the checksums of each file of theirs, as Gradle's verification metadata lists them.`);
    }
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
        if (key === 'files') return [key, checkedFiles(at, root, value)];
        if (key === 'urlSchemes') return [key, checkedUrlSchemes(value, at)];
        if (key === 'fileTypes') return [key, checkedFileTypes(value, at)];
        if (key === 'links') return [key, checkedLinks(value, at)];
        if (key === 'activityTypes') return [key, checkedActivityTypes(value, at)];
        if (key === 'shortcutItems') return [key, checkedShortcutItems(value, at)];
        if (key === 'licenses') return [key, checkedLicenses(at, root, value)];
        if (!Object.hasOwn(PLATFORM_PARTS, key)) {
            throw new Error(`crossbind: ${where}'s app takes ${COMPILED.join(', ')}, files, urlSchemes, fileTypes, links, activityTypes, shortcutItems, licenses and ${Object.keys(PLATFORM_PARTS).join(', ')}; ${key} is none of them.`);
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

// The versions of the contract between crossbind and its extensions this crossbind takes, the oldest to the newest: an
// extension written for any of them builds. A minor version that adds to the contract raises the newest, and a major
// version that breaks it the oldest.
export const OLDEST_EXTENSION_CONTRACT = 1;
export const EXTENSION_CONTRACT = 1;

// The contract an extension is written for, or the several it is written for alike, is one this crossbind takes: one
// written for others alone stops the build, naming what to update.
function checkedContract({ contract }, where, update) {
    if (contract === undefined) {
        throw new Error(`crossbind: ${where} names no contract, the version of crossbind's extension contract it is written for, as contract: ${EXTENSION_CONTRACT} is for this crossbind: ${update}.`);
    }
    const versions = Array.isArray(contract) ? contract : [contract];
    if (versions.length === 0 || versions.some((version) => !Number.isInteger(version) || version < 1) || new Set(versions).size !== versions.length) {
        throw new Error(`crossbind: ${where}'s contract ${JSON.stringify(contract)} is no version of crossbind's extension contract, as 1 or [1, 2] is.`);
    }
    if (versions.some((version) => version >= OLDEST_EXTENSION_CONTRACT && version <= EXTENSION_CONTRACT)) return;
    const named = versions.join(' and ');
    if (versions.every((version) => version > EXTENSION_CONTRACT)) {
        throw new Error(`crossbind: ${where} is written for crossbind's extension contract ${named}, newer than this crossbind's ${EXTENSION_CONTRACT}: update crossbind.`);
    }
    const taken = OLDEST_EXTENSION_CONTRACT === EXTENSION_CONTRACT ? `${EXTENSION_CONTRACT}` : `${OLDEST_EXTENSION_CONTRACT} to ${EXTENSION_CONTRACT}`;
    throw new Error(`crossbind: ${where} is written for crossbind's extension contract ${named}, older than this crossbind's ${taken}: ${update}.`);
}

// The roles an app's extension may take in place of the host's own, each with the host's extension that holds it: the
// host's menu holds the menus, the tray and the notifications, its page-navigation the page's navigations and their
// authentications, and each other extension its own role.
export const HOST_ROLES = {
    activities: 'activities',
    dialog: 'dialog',
    files: 'files',
    instance: 'instance',
    links: 'links',
    menu: 'menu',
    notification: 'menu',
    'page-authentication': 'page-navigation',
    'page-dialogs': 'page-dialogs',
    'page-downloads': 'page-downloads',
    'page-drops': 'page-drops',
    'page-files': 'page-files',
    'page-location': 'page-location',
    'page-navigation': 'page-navigation',
    'page-permissions': 'page-permissions',
    power: 'power',
    shell: 'shell',
    shortcuts: 'shortcuts',
    tray: 'menu',
    updater: 'updater',
};
// The names crossbind keeps for itself, which no extension crossbind.config.js lists takes: its roles, the names of the
// host's own of this contract, those of the app's own functions and events, and every name of a page's request.
const KEPT_NAMES = new Set([...Object.keys(HOST_ROLES), ...Object.values(HOST_ROLES), 'app', 'events', 'windows', 'crossbind']);
const isKeptName = (name) => KEPT_NAMES.has(name) || name.startsWith('page-');

// The roles of the host's a listed extension takes, each once: one, or a list of them.
function checkedReplaces(replaces, where) {
    const roles = Array.isArray(replaces) ? replaces : [replaces];
    if (roles.length === 0 || roles.some((role) => typeof role !== 'string') || new Set(roles).size !== roles.length) {
        throw new Error(`crossbind: ${where}'s replaces is no role of the host's, or list of them, as 'tray' or ['page-navigation', 'page-downloads'] is.`);
    }
    const unknown = roles.find((role) => !Object.hasOwn(HOST_ROLES, role));
    if (unknown) throw new Error(`crossbind: ${where}'s replaces names ${unknown}, which is no role of the host's: it takes ${Object.keys(HOST_ROLES).join(', ')}.`);
    return roles;
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
const LISTED_KEYS = ['name', 'contract', 'root', 'app', 'options', 'publisher', 'installer', 'replaces'];

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
    const checked = checkedExtension(extension, root, where);
    if (Object.hasOwn(HOST_ROLES, checked.name)) {
        throw new Error(`crossbind: ${where} is named ${checked.name}, which crossbind keeps for the host's own: name it as its package, as acme-${checked.name}, and give replaces: '${checked.name}' to take the host's place.`);
    }
    if (isKeptName(checked.name)) throw new Error(`crossbind: ${where} is named ${checked.name}, which crossbind keeps for itself: name it as its package, as acme-${checked.name}.`);
    return extension.replaces === undefined ? checked : { ...checked, replaces: checkedReplaces(extension.replaces, where) };
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

// The host's own extensions an app has, with the options the app's give them: every one, but the activities, the files,
// the instance, the links, the page's location, the shortcuts and the updater only where they give them options, as an
// Apple app's do that lists app.activityTypes, an app's that opens files, a desktop app's that keeps one instance or has
// app.updater, an app's that lists app.urlSchemes or a phone's app.links or app.shortcutItems, and a macOS app's whose
// app.permissions lists the location. The host refuses the activities' and the updater's functions to any other app.
export const appHostExtensions = (appHostRoot, options) => withOptions(hostExtensions(appHostRoot), options)
    .filter((extension) => !['activities', 'files', 'instance', 'links', 'page-location', 'shortcuts', 'updater'].includes(extension.name)
        || Object.hasOwn(options, extension.name));

// The extensions crossbind.config.js lists that add to an app: all but those that give a publisher or an installer
// alone, which leave the host's own of their name as it is.
export const appExtensionsOf = (listed) => listed
    .filter((extension) => (!extension.publisher && !extension.installer) || Object.keys(extension.app).length > 0);

// The host's own extensions an app has, then those crossbind.config.js lists, each with the roles it holds: a role a
// listed one replaces leaves the host's that held it, which the app leaves out once it holds none, and two that replace
// one stop the build. A listed one of the name of a host's own that a later crossbind adds takes its place, saying so,
// as no listed one of this contract has such a name.
export function withRoles(own, listed, warn = () => {}) {
    const taken = new Map();
    for (const extension of listed) {
        for (const role of extension.replaces ?? []) {
            if (taken.has(role)) throw new Error(`crossbind: the extensions ${taken.get(role)} and ${extension.name} both replace the host's ${role}, which one alone takes.`);
            taken.set(role, extension.name);
        }
    }
    const kept = own.flatMap((extension) => {
        if (listed.some(({ name }) => name === extension.name)) {
            warn(`the extension ${extension.name} that crossbind.config.js lists takes the place of the host's own ${extension.name}, which this crossbind adds: name it as its package, as acme-${extension.name}, to keep both`);
            return [];
        }
        const held = Object.values(HOST_ROLES).includes(extension.name)
            ? Object.entries(HOST_ROLES).filter(([, holder]) => holder === extension.name).map(([role]) => role)
            : [extension.name];
        const roles = held.filter((role) => !taken.has(role));
        return roles.length > 0 ? [{ ...extension, roles, given: held.filter((role) => taken.has(role)) }] : [];
    });
    return [...kept, ...listed.map((extension) => ({ ...extension, roles: extension.replaces ?? [], given: [] }))];
}

// crossbind's own publishers or installers, then those crossbind.config.js lists: one listed under the name of one of
// crossbind's takes its place.
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

// The Debian packages a Linux app needs beside WebKitGTK and GTK, as its extensions' Linux parts list them, each once.
export const linuxDepends = (extensions) => unique(extensions.flatMap((extension) => extension.app?.linux?.depends ?? []));

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
    // The targets of Apple's app extensions an iOS app's extensions add, by their owners, no two of one name.
    const owners = new Map();
    const targets = extensions.flatMap((extension) => (own(extension).targets ?? []).map((target) => {
        if (owners.has(target.name)) throw new Error(`crossbind: the extensions ${owners.get(target.name)} and ${extension.name} both name an iOS target ${target.name}.`);
        owners.set(target.name, extension.name);
        return { ...target, owner: extension.name, root: extension.root };
    }));
    return {
        native: native.map(({ name, options, roles, given }) => ({ name, options: options ?? null, roles: roles ?? [], given: given ?? [] })),
        roots: native.map(({ root }) => root),
        sources: extensions.flatMap(sourcesOf),
        // An Apple app's Swift compiles apart, before the host, whose own sources hold the extension's entry.
        compiled: native.map((extension) => {
            const sources = sourcesOf(extension).filter((file) => !isSwift(file));
            if (sources.length === 0) {
                throw new Error(`crossbind: the extension ${extension.name} has Swift alone on ${partOf(platform)}, whose entry, crossbind_extension_${extension.name.replace(/-/g, '_')}, a C++ or Objective-C++ source of its own defines.`);
            }
            return {
                name: extension.name,
                sources,
                swift: sourcesOf(extension).filter(isSwift),
                // A Linux part's packages, which a sysroot of the extension's own holds for its sources.
                packages: own(extension).packages ?? [],
                includes: both(extension, 'includes').map((folder) => path.join(extension.root, folder)),
                defines: both(extension, 'defines'),
            };
        }),
        frameworks: unique(extensions.flatMap((extension) => own(extension).frameworks ?? [])),
        libraries: unique(extensions.flatMap((extension) => own(extension).libraries ?? [])),
        java: extensions.filter((extension) => own(extension).java).map((extension) => ({
            name: extension.name, dir: path.join(extension.root, own(extension).java), className: own(extension).class, roles: extension.roles ?? [],
        })),
        // An Android app's libraries of Maven's, by the extension that uses them, with its verification metadata.
        maven: extensions.filter((extension) => own(extension).maven).map((extension) => ({
            name: extension.name, coordinates: own(extension).maven, verification: path.join(extension.root, own(extension).verification),
        })),
        entitlements: owned('entitlements'),
        plist: owned('plist'),
        privacy: owned('privacy'),
        permissions: unique(extensions.flatMap((extension) => own(extension).permissions ?? [])),
        manifests: extensions.filter((extension) => own(extension).manifest)
            .map((extension) => ({ name: extension.name, file: path.join(extension.root, own(extension).manifest) })),
        resources: extensions.filter((extension) => own(extension).resources)
            .map((extension) => ({ name: extension.name, dir: path.join(extension.root, own(extension).resources) })),
        // The files each carries, which the app keeps in ext/<name>/.
        files: extensions.filter((extension) => both(extension, 'files').length > 0)
            .map((extension) => ({ name: extension.name, root: extension.root, paths: both(extension, 'files') })),
        targets,
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
// options and the roles of the host's it holds, and that names the owner of each of the app's URL schemes, of the
// extensions of the files it opens, of its sites' links, of the types of the user activities it continues and of its
// icon's quick actions: the extension that declared it, or for the app's own the holder of the links', files',
// activities' or shortcuts' role, which hands them to the page. An owner has native code to get what it owns.
export function registrationSource(native, urlSchemes, fileTypes = [], links = [], activityTypes = [], shortcutItems = []) {
    const holderOf = (role) => native.find(({ roles = [] }) => roles.includes(role))?.name ?? role;
    const schemes = urlSchemes.map(({ scheme, extension }) => ({ key: scheme, owner: extension ?? holderOf('links'), what: `the links of ${scheme}` }));
    const files = fileTypes.flatMap(({ extensions, extension }) => extensions.map((ending) => ({ key: ending, owner: extension ?? holderOf('files'), what: `the files .${ending}` })));
    // The MIME type an Android file comes with names its owner before its name does, where one owner's types alone list it.
    const typed = fileTypes.flatMap(({ mimeTypes = [], extension }) => mimeTypes.map((mime) => ({ key: mime, owner: extension ?? holderOf('files') })));
    const mimes = typed.filter(({ key, owner }, index) => typed.findIndex((other) => other.key === key) === index
        && typed.every((other) => other.key !== key || other.owner === owner));
    const sites = links.map(({ link, extension }) => ({ key: link, owner: extension ?? holderOf('links'), what: `the links of ${link}` }));
    const activities = activityTypes.map(({ type, extension }) => ({ key: type, owner: extension ?? holderOf('activities'), what: `the user activities ${type}` }));
    const shortcuts = shortcutItems.map(({ type, extension }) => ({ key: type, owner: extension ?? holderOf('shortcuts'), what: `the quick action ${type}` }));
    const unheard = [...schemes, ...files, ...sites, ...activities, ...shortcuts].find(({ owner }) => !native.some(({ name }) => name === owner));
    if (unheard) throw new Error(`crossbind: the extension ${unheard.owner} gets ${unheard.what}, but has no native code on this platform.`);
    const list = (roles = []) => `{${roles.map((role) => `"${role}"`).join(', ')}}`;
    const start = ({ name, options, roles, given }) => `    startExtension("${name}", ${options === null ? 'nullptr' : optionsText(name, options)}, ${entryOf(name)}, ${list(roles)}, ${list(given)});`;
    const owners = (fn, owned) => [
        '',
        `std::vector<std::pair<std::string, std::string>> ${fn}() {`,
        `    return {${owned.map(({ key, owner }) => `{"${key}", "${owner}"}`).join(', ')}};`,
        '}',
    ];
    return [
        "// crossbind writes this file from the app's extensions: the entry of each one with native code, which starts it with",
        "// its options, the roles of the host's it holds and those it gave an app's extension, and the owner of each of the",
        "// app's URL schemes, file types, their MIME types, links, user activity types and quick actions, the extension that",
        '// gets them.',
        '#include "crossbind/extension.h"',
        '',
        ...native.map(({ name }) => `void ${entryOf(name)}(crossbind::Registry &registry);`),
        ...(native.length > 0 ? [''] : []),
        'namespace crossbind::app {',
        '',
        'void startExtension(const char *name, const char *options, void (*entry)(Registry &), std::vector<std::string> roles,',
        '    std::vector<std::string> given);',
        '',
        'void extensionEntries() {',
        ...native.map(start),
        '}',
        ...owners('urlSchemes', schemes),
        ...owners('fileTypes', files),
        ...owners('fileMimeTypes', mimes),
        ...owners('appLinks', sites),
        ...owners('userActivityTypes', activities),
        ...owners('shortcutItemTypes', shortcuts),
        '',
        '}  // namespace crossbind::app',
        '',
    ].join('\n');
}
