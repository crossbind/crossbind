import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { carriedPath, isOutside } from './appFiles.js';
import {
    NAME, checkedCommands, checkedInstaller, checkedPublisher,
} from './extensionSteps.js';
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
const LINK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;
// A class in a package, which the activity's package can name.
const JAVA_CLASS = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/;

export { PUBLISH_PLATFORMS, checkedInstaller, checkedPublisher } from './extensionSteps.js';

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

const LICENSE_KEYS = ['name', 'version', 'license', 'file', 'source', 'sha256', 'notes'];

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
        if (entry.notes !== undefined && typeof entry.notes !== 'string') throw new Error(`crossbind: ${at}.notes is no text.`);
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

// An option's path in the app's config, as a dotted name.
const OPTION_PATH = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

// A list of names, each once, none empty.
function checkedOwnNames(where, names, pattern) {
    if (!Array.isArray(names) || names.length === 0 || !names.every((name) => typeof name === 'string' && pattern.test(name)) || new Set(names).size !== names.length) {
        throw new Error(`crossbind: ${where} ${JSON.stringify(names)} is no list of names, each once.`);
    }
    return names;
}

// What an extension of crossbind's own says of itself beside what it adds: the roles of the host's it holds, where they
// are more than its name, and the app's options it reads, each by its path in app, which app.without would leave to no one.
function checkedOwnKeys({ holds, reads }, where) {
    return {
        ...(holds === undefined ? {} : { holds: checkedOwnNames(`${where}'s holds`, holds, NAME) }),
        ...(reads === undefined ? {} : { reads: checkedOwnNames(`${where}'s reads`, reads, OPTION_PATH) }),
    };
}

// An extension as crossbind takes it, its paths relative to root: its name, in app the sources every platform compiles,
// the schemes whose links its native code gets and what each platform adds, the options its native code reads or the
// fromApp that takes them from the app's config, and its publisher and its installer, where it has them.
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
    if (extension.fromApp !== undefined && typeof extension.fromApp !== 'function') throw new Error(`crossbind: ${where}'s fromApp is no function.`);
    if (extension.fromApp !== undefined && extension.options !== undefined) throw new Error(`crossbind: ${where} gives options and a fromApp, which gives them too: one of them alone.`);
    const installerAt = `${where}'s installer`;
    const roles = {
        ...(extension.publisher === undefined ? {} : { publisher: checkedPublisher(extension.publisher, `${where}'s publisher`) }),
        ...(extension.installer === undefined ? {} : {
            installer: {
                ...checkedInstaller(extension.installer, installerAt),
                ...(extension.installer.licenses === undefined ? {} : { licenses: checkedLicenses(`${installerAt}.licenses`, root, extension.installer.licenses) }),
            },
        }),
        ...(extension.commands === undefined ? {} : { commands: checkedCommands(extension.commands, `${where}'s commands`) }),
        ...(extension.fromApp === undefined ? {} : { fromApp: extension.fromApp.bind(extension) }),
        ...checkedOwnKeys(extension, where),
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

// The names crossbind keeps for itself, which no extension crossbind.config.js lists takes: those of the app's own
// functions and events, and every name of a page's request.
const KEPT_NAMES = new Set(['app', 'events', 'windows', 'crossbind']);
const isKeptName = (name) => KEPT_NAMES.has(name) || name.startsWith('page-');

// The roles of the host's a listed extension takes, each once: one, or a list of them.
function checkedReplaces(replaces, where) {
    const roles = Array.isArray(replaces) ? replaces : [replaces];
    if (roles.length === 0 || roles.some((role) => typeof role !== 'string') || new Set(roles).size !== roles.length) {
        throw new Error(`crossbind: ${where}'s replaces is no role of the host's, or list of them.`);
    }
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
const LISTED_KEYS = ['name', 'contract', 'root', 'app', 'options', 'fromApp', 'publisher', 'installer', 'commands', 'replaces'];

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
    if (isKeptName(checked.name)) throw new Error(`crossbind: ${where} is named ${checked.name}, which crossbind keeps for itself: name it as its package, as acme-${checked.name}.`);
    return extension.replaces === undefined ? checked : { ...checked, replaces: checkedReplaces(extension.replaces, where) };
}

const OWN_PACKAGE = /^@crossbind\/extension-(.+)$/;

// The names of the extension packages among the host's dependencies.
export const ownPackages = (appHostRoot) => Object.keys(JSON.parse(fs.readFileSync(path.join(appHostRoot, 'package.json'), 'utf8')).dependencies ?? {})
    .filter((name) => OWN_PACKAGE.test(name)).sort();

// crossbind's own extensions: the extension packages among the host's dependencies, which an app has by having the host,
// each named as its package. crossbind finds them as it finds the embind runtime, through the host, as pnpm shows them to
// it alone.
export function ownExtensions(appHostRoot) {
    const load = createRequire(path.join(appHostRoot, 'package.json'));
    const packages = ownPackages(appHostRoot);
    if (packages.length === 0) throw new Error(`crossbind: the app host at ${appHostRoot} brings no extensions: update @crossbind/core-app-host to match crossbind.`);
    return packages.map((name) => {
        const where = `${name}'s crossbind.extension.js`;
        let extension;
        try {
            extension = load(`${name}/crossbind.extension.js`).default();
        } catch (error) {
            throw new Error(`crossbind: cannot read ${where}: ${error.message}: install the project's packages, or update @crossbind/core-app-host to match crossbind.`, { cause: error });
        }
        checkedContract(extension ?? {}, where, 'update @crossbind/core-app-host to match crossbind');
        const checked = checkedExtension(extension, extension?.root, where);
        const expected = OWN_PACKAGE.exec(name)[1];
        if (checked.name !== expected) throw new Error(`crossbind: ${where} names the extension ${checked.name}, not ${expected} as its package.`);
        return checked;
    });
}

// Whether an option of the app's config asks for anything, as false, null and an empty list or object do not.
const asksForAnything = (value) => value !== undefined && value !== null && value !== false
    && (typeof value !== 'object' || Object.keys(value).length > 0);

// crossbind's own extensions but those app.without names: its own alone, each once, none whose option in the app's
// config would then reach no one.
export function withoutNamed(own, app = {}) {
    const { without = [] } = app;
    const names = own.map(({ name }) => name);
    if (!Array.isArray(without) || !without.every((name) => typeof name === 'string') || new Set(without).size !== without.length) {
        throw new Error(`crossbind: app.without ${JSON.stringify(without)} is no list of crossbind's own extensions, each once: ${names.join(', ')}.`);
    }
    const unknown = without.find((name) => !names.includes(name));
    if (unknown) throw new Error(`crossbind: app.without names ${unknown}, which is none of crossbind's own extensions: ${names.join(', ')}.`);
    const left = own.filter(({ name }) => without.includes(name));
    for (const { name, reads = [] } of left) {
        const read = reads.find((option) => asksForAnything(option.split('.').reduce((value, key) => value?.[key], app)));
        if (read) throw new Error(`crossbind: app.without leaves out ${name}, which app.${read} in crossbind.config.js needs: remove one of them.`);
    }
    return own.filter((extension) => !left.includes(extension));
}

// A failure of an extension's step: crossbind's own message as it is, else one that names the extension and the step.
const stepFailure = (name, which, error) => (error instanceof Error && error.message.startsWith('crossbind:') ? error
    : new Error(`crossbind: ${name}'s ${which} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error }));

// A step of an extension's publisher or installer, whose failure stops the run.
export async function extensionStep(name, which, run) {
    try {
        return await run();
    } catch (error) {
        throw stepFailure(name, which, error);
    }
}

// What an extension's fromApp gives: the options of its native code, or null, which leaves it out of the app.
function fromAppOf({ name, fromApp }, api) {
    let options;
    try {
        options = fromApp(api);
    } catch (error) {
        throw stepFailure(name, 'fromApp', error);
    }
    if (!isJsonValue(options)) throw new Error(`crossbind: ${name}'s fromApp gives no JSON value the host reads as it is, or null, which leaves it out of the app.`);
    return options;
}

// The extensions of an app, each that gives a fromApp with the options it takes from the app's config, or left out where
// it gives null.
export const withFromApp = (extensions, apiOf) => extensions.flatMap((extension) => {
    if (!extension.fromApp) return [extension];
    const options = fromAppOf(extension, apiOf(extension.name));
    return options === null ? [] : [{ ...extension, options }];
});

// The extensions crossbind.config.js lists that add to an app: all but those that give a publisher or an installer
// alone, which leave the host's own of their name as it is.
export const appExtensionsOf = (listed) => listed
    .filter((extension) => (!extension.publisher && !extension.installer) || Object.keys(extension.app).length > 0);

// The host's own extensions an app has, then those crossbind.config.js lists, each with the roles it holds, its own name
// where it says nothing else: a role a listed one replaces leaves the host's that held it, which the app leaves out once
// it holds none, and two that replace one stop the build, as one no extension of known holds. A listed one of the name of
// a host's own takes its place and its roles, saying so, as a later crossbind may add one of a name an app has already.
export function withRoles(own, listed, warn = () => {}, known = own) {
    const holdersOf = new Map(known.flatMap(({ name, holds }) => (holds ?? [name]).map((role) => [role, name])));
    const taken = new Map();
    for (const extension of listed) {
        const holder = holdersOf.get(extension.name);
        if (holder !== undefined && holder !== extension.name) {
            throw new Error(`crossbind: the extension ${extension.name} is named as the host's role ${extension.name}, which its ${holder} holds: name it as its package, as acme-${extension.name}, and give replaces: '${extension.name}' to take the host's place.`);
        }
        for (const role of extension.replaces ?? []) {
            if (!holdersOf.has(role)) throw new Error(`crossbind: the extension ${extension.name} replaces ${role}, which is no role of the host's: it takes ${[...holdersOf.keys()].sort().join(', ')}.`);
            if (taken.has(role)) throw new Error(`crossbind: the extensions ${taken.get(role)} and ${extension.name} both replace the host's ${role}, which one alone takes.`);
            taken.set(role, extension.name);
        }
    }
    const kept = own.flatMap((extension) => {
        if (listed.some(({ name }) => name === extension.name)) {
            warn(`the extension ${extension.name} that crossbind.config.js lists takes the place of the host's own ${extension.name}: name it as its package, as acme-${extension.name}, to keep both`);
            return [];
        }
        const held = extension.holds ?? [extension.name];
        const roles = held.filter((role) => !taken.has(role));
        return roles.length > 0 ? [{ ...extension, roles, given: held.filter((role) => taken.has(role)) }] : [];
    });
    return [...kept, ...listed.map((extension) => {
        const named = known.find(({ name }) => name === extension.name);
        const held = named ? named.holds ?? [named.name] : [];
        const isAnothers = (role) => taken.has(role) && taken.get(role) !== extension.name;
        return { ...extension, roles: [...new Set([...(extension.replaces ?? []), ...held.filter((role) => !isAnothers(role))])], given: held.filter(isAnothers) };
    })];
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
