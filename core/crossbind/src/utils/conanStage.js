import fs from 'node:fs';
import path from 'node:path';
import upath from 'upath';
import loadJson from './loadJson.js';
import writeIfChanged from './writeIfChanged.js';
import makeTreeWritable from './makeTreeWritable.js';
import { CONAN_NAME, conanPackageDir } from './conanImport.js';
import { CONAN_VERSION } from './conanDependencies.js';

const MANIFEST = 'manifest.json';
const LIB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
// What may follow name/version in a reference: a user/channel and a recipe revision.
const REFERENCE_TAIL = /^(@[A-Za-z0-9_][A-Za-z0-9_.+-]*\/[A-Za-z0-9_][A-Za-z0-9_.+-]*)?(#[0-9a-f]+)?$/;
const URL = /^https?:\/\/[^\s"'<>`\\]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_TEXT = 1000;
const TARGET_PATH = /^[A-Za-z0-9_-]+$/;

// The CMake target of a package; Conan names may carry '.', '+' and '-'.
export const conanTargetName = (name) => `conan_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;

const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const isListOf = (pattern, values) => Array.isArray(values) && values.every((value) => matches(pattern, value));
const shown = (value) => `${JSON.stringify(value)}`.slice(0, 200);
// C0 and C1 controls, which carry terminal escape sequences.
export const isControlCharacter = (char) => char < ' ' || (char >= '\u007f' && char <= '\u009f');
// Recipe text ends up in notices and terminals: one line, no control characters.
const textOf = (value) => (typeof value === 'string' && value.length <= MAX_TEXT && ![...value].some(isControlCharacter) ? value : null);
const urlOf = (value) => (matches(URL, value) && value.length <= MAX_TEXT ? value : null);

// A list means every license applies; an item that offers a choice stays one term of it.
function licenseOf(license) {
    const parts = Array.isArray(license) ? license.map(textOf) : [textOf(license)];
    if (parts.length === 0 || !parts.every(Boolean)) return null;
    return parts.length === 1 ? parts[0] : parts.map((part) => (part.includes(' OR ') ? `(${part})` : part)).join(' AND ');
}

// The fields of a package that crossbind keeps. Conan's JSON comes from recipe code and these fields
// end up in paths, CMake files and notices, so they are checked where they come in and again where
// the manifest is read back.
export function conanPackageEntry(entry) {
    const fail = (field) => {
        throw new Error(`crossbind: the Conan package ${shown(entry.ref ?? entry.name)} has an invalid ${field}: ${shown(entry[field])}.`);
    };
    if (!matches(CONAN_NAME, entry.name)) fail('name');
    if (!matches(CONAN_VERSION, entry.version)) fail('version');
    const reference = `${entry.name}/${entry.version}`;
    if (typeof entry.ref !== 'string' || !entry.ref.startsWith(reference) || !REFERENCE_TAIL.test(entry.ref.slice(reference.length))) fail('ref');
    if (!isListOf(LIB_NAME, entry.libs)) fail('libs');
    if (!isListOf(CONAN_NAME, entry.requires)) fail('requires');
    const url = urlOf(entry.source?.url);
    return {
        name: entry.name,
        version: entry.version,
        ref: entry.ref,
        license: licenseOf(entry.license),
        homepage: urlOf(entry.homepage),
        source: url ? { url, sha256: matches(SHA256, entry.source.sha256) ? entry.source.sha256 : null } : null,
        libs: [...entry.libs],
        requires: [...entry.requires],
    };
}

function sourceOf(entry) {
    const source = Array.isArray(entry) ? entry[0] : entry;
    if (!source?.url) return null;
    return { url: Array.isArray(source.url) ? source.url[0] : source.url, sha256: source.sha256 ?? null };
}

function packageOf(node, requires) {
    const components = Object.values(node.cpp_info ?? {});
    const collect = (key) => [...new Set(components.flatMap((component) => component?.[key] ?? []))];
    const folders = (key) => {
        const values = collect(key);
        if (!values.every((value) => typeof value === 'string')) {
            throw new Error(`crossbind: the Conan package ${shown(node.ref)} has invalid ${key}.`);
        }
        return values;
    };
    if (typeof node.package_folder !== 'string') {
        throw new Error(`crossbind: conan reported the package ${shown(node.ref)} without a package folder.`);
    }
    return {
        ...conanPackageEntry({
            name: node.name,
            version: node.version,
            ref: node.ref,
            license: node.license,
            homepage: node.homepage,
            source: sourceOf(node.conandata?.sources?.[node.version]),
            libs: collect('libs'),
            requires,
        }),
        packageFolder: node.package_folder,
        includedirs: folders('includedirs'),
        libdirs: folders('libdirs'),
    };
}

// Host packages of a `conan install --format=json` graph, each before the packages it requires: the
// order a static link takes them in. Left out are the consumer, build tools, test requirements and
// packages conan skipped because the consumer needs nothing of them.
export function conanPackagesOf(graph) {
    const nodes = graph?.nodes;
    if (!nodes || typeof nodes !== 'object' || !graph.root) {
        throw new Error('crossbind: conan install printed a graph without nodes or a root.');
    }
    const [root] = Object.keys(graph.root);
    const isPackage = (id) => id !== root && nodes[id]?.context === 'host' && !nodes[id].test && nodes[id].binary !== 'Skip';
    const ids = Object.keys(nodes).filter(isPackage);
    const requiresOf = (id) => Object.entries(nodes[id].dependencies ?? {})
        .filter(([dependency, edge]) => !edge?.build && !edge?.test && ids.includes(dependency))
        .map(([dependency]) => dependency);
    const order = [];
    const visited = new Set();
    const visit = (id) => {
        if (visited.has(id)) return;
        visited.add(id);
        requiresOf(id).forEach(visit);
        order.push(id);
    };
    ids.forEach(visit);
    return order.reverse().map((id) => packageOf(nodes[id], requiresOf(id).map((dependency) => nodes[dependency].name)));
}

// The real path of a file conan reported, or null when there is none; refused when it resolves
// outside `root`.
function realPathWithin(file, root, pkg) {
    if (!fs.existsSync(file)) return null;
    const real = fs.realpathSync(file);
    const relative = path.relative(root, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`crossbind: the Conan package ${pkg.ref} reports ${file}, which resolves outside ${root}.`);
    }
    return real;
}

// Packages link files to each other (libpng.a -> libpng16.a), so links are followed, but only to
// directories and regular files inside the package, and into each linked directory once: a link out
// of the package could point the copy at any file the host can read, and links back up the tree
// would copy it without end.
function copyTree(from, to, packageRoot, pkg) {
    const linked = new Set([from]);
    fs.cpSync(from, to, {
        recursive: true,
        dereference: true,
        filter: (source) => {
            const entry = fs.lstatSync(source);
            if (!entry.isSymbolicLink()) return entry.isDirectory() || entry.isFile();
            const real = realPathWithin(source, packageRoot, pkg);
            const target = real && fs.statSync(real);
            if (!target?.isDirectory()) return Boolean(target?.isFile());
            if (linked.has(real)) return false;
            linked.add(real);
            return true;
        },
    });
    makeTreeWritable(to);
}

// The package's own folder: no link, and below the store's own layout, so it cannot take in the
// store or another package.
function packageRootOf(pkg, folder, store) {
    const real = realPathWithin(folder, store, pkg);
    if (!real || fs.lstatSync(folder).isSymbolicLink() || path.relative(store, real).split(path.sep).length < 2) {
        throw new Error(`crossbind: the Conan package ${pkg.ref} has no package folder crossbind can use at ${pkg.packageFolder}.`);
    }
    return real;
}

// A package lands where a published port keeps its prebuilt (<dir>/dist/prebuilt/<target>/{include,lib}),
// so the dependency machinery links it and SWIG treats its headers as one across targets. Everything
// is read from inside the package's own folder in the store.
export function stageConanPackage(pkg, {
    stageDir, targetPath, toHost, store, distCmake,
}) {
    const packageRoot = packageRootOf(pkg, toHost(pkg.packageFolder), fs.realpathSync(store));
    const reported = (folder) => realPathWithin(toHost(upath.isAbsolute(folder) ? folder : upath.join(pkg.packageFolder, folder)), packageRoot, pkg);
    const dir = conanPackageDir(stageDir, pkg.name);
    const prebuilt = upath.join(dir, 'dist', 'prebuilt');
    const prefix = upath.join(prebuilt, targetPath);

    fs.rmSync(prefix, { recursive: true, force: true });
    fs.mkdirSync(upath.join(prefix, 'include'), { recursive: true });
    fs.mkdirSync(upath.join(prefix, 'lib'), { recursive: true });
    pkg.includedirs.map(reported).filter(Boolean).forEach((folder) => copyTree(folder, upath.join(prefix, 'include'), packageRoot, pkg));
    const libdirs = pkg.libdirs.map(reported).filter(Boolean);
    pkg.libs.forEach((lib) => {
        const archive = libdirs.map((folder) => realPathWithin(path.join(folder, `lib${lib}.a`), packageRoot, pkg))
            .find((file) => file && fs.statSync(file).isFile());
        if (!archive) {
            throw new Error(`crossbind: the Conan package ${pkg.ref} declares the library ${lib}, but its package has no lib${lib}.a.`);
        }
        fs.copyFileSync(archive, upath.join(prefix, 'lib', `lib${lib}.a`));
    });

    const licenses = upath.join(dir, 'licenses');
    fs.rmSync(licenses, { recursive: true, force: true });
    const shipped = realPathWithin(path.join(packageRoot, 'licenses'), packageRoot, pkg);
    if (shipped && fs.statSync(shipped).isDirectory()) copyTree(shipped, licenses, packageRoot, pkg);
    writeIfChanged(upath.join(dir, 'package.json'), `${JSON.stringify({
        name: `conan:${pkg.name}`, version: pkg.version, nativeVersion: pkg.version, license: pkg.license, private: true,
    }, null, 4)}\n`);

    const hosts = fs.readdirSync(prebuilt, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && TARGET_PATH.test(entry.name)).map((entry) => entry.name).sort();
    writeIfChanged(upath.join(prebuilt, 'CMakeLists.txt'), distCmake
        .replace('___PROJECT_NAME___', () => conanTargetName(pkg.name))
        .replace('___PROJECT_HOST___', () => hosts.join(';'))
        .replace('___PROJECT_LIBS___', () => pkg.libs.join(';'))
        .replace('___PROJECT_WHOLE_ARCHIVE___', () => ''));
}

export function writeConanManifest(stageDir, manifest) {
    writeIfChanged(upath.join(stageDir, MANIFEST), `${JSON.stringify(manifest, null, 4)}\n`);
}

// A manifest staged for other conanDependencies describes packages the config no longer asks for.
export function readConanManifest(stageDir, key) {
    const file = upath.join(stageDir, MANIFEST);
    const manifest = loadJson(file);
    if (manifest?.key !== key) return null;
    try {
        return { key, packages: manifest.packages.map(conanPackageEntry) };
    } catch (e) {
        throw new Error(`crossbind: ${file} cannot be used - delete ${stageDir} and build again. ${e.message}`, { cause: e });
    }
}
