import fs from 'node:fs';
import path from 'node:path';
import { checkedUrlSchemes } from './appOptions.js';
import { isUnderBase } from './replaceBasePathForDocker.js';

// What an app extension may add on each platform beside the sources the host compiles with it: the frameworks an Apple
// host links, the libraries another links, the folder of an Android app's Java with the class in it the app calls, and
// an Apple app's entitlements.
const PLATFORM_PARTS = {
    darwin: ['sources', 'frameworks', 'entitlements'],
    ios: ['sources', 'frameworks', 'entitlements'],
    linux: ['sources', 'libraries'],
    win32: ['sources', 'libraries'],
    android: ['sources', 'libraries', 'java', 'class'],
};
// The host compiles C++ on every platform, and Objective-C++ on Apple's.
const SOURCE = /\.(cpp|cc|cxx)$/;
const APPLE_SOURCE = /\.(cpp|cc|cxx|mm)$/;
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
const isJsonValue = (value, depth = 0) => depth <= MAX_JSON_DEPTH && (value === null || typeof value === 'boolean'
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
        if (!pattern.test(String(file))) throw new Error(`crossbind: ${where} names ${file}, which is no ${pattern === SOURCE ? 'C++' : 'C++ or Objective-C++'} source.`);
        return ownPath(where, root, file);
    });
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
        if (key === 'sources') return [key, checkedSources(at, root, value, ['darwin', 'ios'].includes(platform) ? APPLE_SOURCE : SOURCE)];
        if (key === 'java') return [key, ownPath(at, root, value, true)];
        if (key === 'class') return [key, value];
        if (key === 'entitlements') return [key, checkedEntitlements(at, value)];
        return [key, checkedNames(at, value)];
    }));
    if ('java' in checked || 'class' in checked) checkedJava(where, root, checked);
    return checked;
}

// An extension as crossbind takes it, its paths relative to root: its name, in app the sources every platform compiles,
// the schemes whose links its native code gets and what each platform adds, and the options its native code reads,
// where it has them.
export function checkedExtension(extension, root, where) {
    if (!isObject(extension) || typeof extension.name !== 'string' || !NAME.test(extension.name)) {
        throw new Error(`crossbind: ${where} has no name of lowercase letters and digits, which dashes may join.`);
    }
    const app = extension.app ?? {};
    if (!isObject(app)) throw new Error(`crossbind: ${where}'s app is no object.`);
    const checked = Object.fromEntries(Object.entries(app).map(([key, value]) => {
        const at = `${where}'s app.${key}`;
        if (key === 'sources') return [key, checkedSources(at, root, value, SOURCE)];
        if (key === 'urlSchemes') return [key, checkedUrlSchemes(value, at)];
        if (!(key in PLATFORM_PARTS)) throw new Error(`crossbind: ${where}'s app takes sources, urlSchemes and ${Object.keys(PLATFORM_PARTS).join(', ')}; ${key} is none of them.`);
        return [key, checkedPlatform(at, root, key, value)];
    }));
    if (extension.options === undefined) return { name: extension.name, root, app: checked };
    if (!isJsonValue(extension.options)) {
        throw new Error(`crossbind: ${where}'s options are no JSON value the host reads as it is: plain objects, arrays, strings, finite numbers, booleans and null alone, 64 levels deep at most, without a lone surrogate.`);
    }
    return { name: extension.name, root, app: checked, options: extension.options };
}

// What an extension of crossbind's build once hooked into, which no build runs.
const OLD_HOOKS = ['loadConfig', 'buildWasm', 'createLib'];
const LISTED_KEYS = ['name', 'root', 'app', 'options'];

// An extension crossbind.config.js lists, as its package's crossbind.extension.js gives it: its name, the folder its
// files are in, which a build sees under the project's base alone, and what it adds to an app.
export function listedExtension(extension, where, base) {
    if (!isObject(extension)) throw new Error(`crossbind: ${where} is no extension, as an extension package's crossbind.extension.js gives one.`);
    const hooks = Object.keys(extension).filter((key) => OLD_HOOKS.includes(key));
    if (hooks.length > 0) {
        throw new Error(`crossbind: ${where} has the hooks ${hooks.join(', ')}, which crossbind no longer runs: an extension adds native code to an app. Set build flags in targetSpecs or crossbind.build.js.`);
    }
    const unknown = Object.keys(extension).find((key) => !LISTED_KEYS.includes(key));
    if (unknown) throw new Error(`crossbind: ${where} takes ${LISTED_KEYS.join(', ')}; ${unknown} is none of them.`);
    const { root } = extension;
    if (typeof root !== 'string' || !path.isAbsolute(root) || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new Error(`crossbind: ${where} has no root, the absolute path of the folder its files are in.`);
    }
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
        const checked = checkedExtension(extension, path.dirname(file), file);
        if (checked.name !== folder) throw new Error(`crossbind: ${file} names the extension ${checked.name}, not ${folder} as its folder.`);
        return checked;
    });
}

// The host's own extensions with the options the app's give them, each by its own name.
export const withOptions = (extensions, options) => extensions.map((extension) => (Object.hasOwn(options, extension.name)
    ? { ...extension, options: options[extension.name] } : extension));

// The host's own extensions an app has, with the options the app's give them: every one, but the instance, the links and
// the updater only where they give them options, as a desktop app's do that keeps one instance or has app.updater, and
// an app's that lists app.urlSchemes. The host refuses the updater's functions to any other app.
export const appHostExtensions = (appHostRoot, options) => withOptions(hostExtensions(appHostRoot), options)
    .filter((extension) => !['instance', 'links', 'updater'].includes(extension.name) || Object.hasOwn(options, extension.name));

// The host's own extensions an app has, then those crossbind.config.js lists: one listed under the name of one of the
// host's takes its place.
export function withListed(own, listed) {
    const kept = own.map((extension) => listed.find(({ name }) => name === extension.name) ?? extension);
    return [...kept, ...listed.filter((extension) => !kept.includes(extension))];
}

// The entitlements of several owners, as one claims each; two that give one different values stop the build, naming
// both.
export function mergedEntitlements(owned) {
    const merged = new Map();
    for (const [owner, entitlements] of owned) {
        for (const [key, value] of Object.entries(entitlements)) {
            const first = merged.get(key);
            if (first && JSON.stringify(first.value) !== JSON.stringify(value)) {
                throw new Error(`crossbind: ${first.owner} and ${owner} give the entitlement ${key} different values.`);
            }
            if (!first) merged.set(key, { owner, value });
        }
    }
    return Object.fromEntries([...merged].map(([key, { value }]) => [key, value]));
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
    const own = (extension) => extension.app[platform] ?? {};
    const sourcesOf = (extension) => [...(extension.app.sources ?? []), ...(own(extension).sources ?? [])].map((file) => path.join(extension.root, file));
    const native = extensions.filter((extension) => sourcesOf(extension).length > 0);
    return {
        native: native.map(({ name, options }) => ({ name, options: options ?? null })),
        roots: native.map(({ root }) => root),
        sources: extensions.flatMap(sourcesOf),
        frameworks: unique(extensions.flatMap((extension) => own(extension).frameworks ?? [])),
        libraries: unique(extensions.flatMap((extension) => own(extension).libraries ?? [])),
        java: extensions.filter((extension) => own(extension).java).map((extension) => ({
            name: extension.name, dir: path.join(extension.root, own(extension).java), className: own(extension).class,
        })),
        entitlements: extensions.filter((extension) => own(extension).entitlements)
            .map((extension) => [`the extension ${extension.name}`, own(extension).entitlements]),
    };
}

const entryOf = (name) => `crossbind_extension_${name.replace(/-/g, '_')}`;

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
    if (unheard) {
        const hint = unheard.owner === 'links' ? ': an app host older than crossbind has no links, so update @crossbind/core-app-host to match crossbind' : '';
        throw new Error(`crossbind: the extension ${unheard.owner} gets the links of ${unheard.scheme}, but has no native code on this platform${hint}.`);
    }
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
