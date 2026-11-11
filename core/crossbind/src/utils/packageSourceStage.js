import fs from 'node:fs';
import path from 'node:path';
import upath from 'upath';
import loadJson from './loadJson.js';
import writeIfChanged from './writeIfChanged.js';
import makeTreeWritable from './makeTreeWritable.js';
import logger from './logger.js';
import { libNameOf } from './linkLayout.js';
import { PACKAGE_NAME, sourcePackageDir } from './packageSourceImport.js';
import { isControlCharacter, printable } from './printableText.js';

const MANIFESTS = 'manifests';
const PACKAGE_VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
const LIB_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/;
// A macro name with a plain value, if any (a path or a list too): one compiler argument, in a list CMake
// splits on ';'.
const DEFINE = /^[A-Za-z_]\w*(=[\w.+/,:-]*)?$/;
// What may follow name/version in a reference: a user/channel and a recipe revision.
const REFERENCE_TAIL = /^(@[A-Za-z0-9_][A-Za-z0-9_.+-]*\/[A-Za-z0-9_][A-Za-z0-9_.+-]*)?(#[0-9a-f]+)?$/;
const URL = /^https?:\/\/[^\s"'<>`\\]+$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_TEXT = 1000;
const TARGET_PATH = /^[A-Za-z0-9_-]+$/;

// The CMake target of a package; package names may carry '.', '+' and '-'.
export const sourceTargetName = (source, name) => `${source}_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
// The prefix of the variables a package's CMakeLists names each target's libraries by.
const hostLibsOf = (source) => `CROSSBIND_${source.toUpperCase()}_LIBS_`;

const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const isListOf = (pattern, values) => Array.isArray(values) && values.every((value) => matches(pattern, value));
// What a recipe wrote, as a message quotes it: JSON escapes the C0 controls, and the others go.
const shown = (value) => printable(`${JSON.stringify(value)}`).slice(0, 200);
// Recipe text ends up in notices and terminals: one line, no control characters.
const textOf = (value) => (typeof value === 'string' && value.length <= MAX_TEXT && ![...value].some(isControlCharacter) ? value : null);
const urlOf = (value) => (matches(URL, value) && value.length <= MAX_TEXT ? value : null);

// A list means every license applies; an item that offers a choice stays one term of it.
function licenseOf(license) {
    const parts = Array.isArray(license) ? license.map(textOf) : [textOf(license)];
    if (parts.length === 0 || !parts.every(Boolean)) return null;
    return parts.length === 1 ? parts[0] : parts.map((part) => (part.includes(' OR ') ? `(${part})` : part)).join(' AND ');
}

// The fields of a package that crossbind keeps. What a source reports comes from recipe code and these
// fields end up in paths, CMake files and notices, so they are checked where they come in and again where
// the manifest is read back.
export function packageEntry(source, entry) {
    const fail = (field) => {
        throw new Error(`crossbind: the ${source} package ${shown(entry.ref ?? entry.name)} has an invalid ${field}: ${shown(entry[field])}.`);
    };
    if (!matches(PACKAGE_NAME, entry.name)) fail('name');
    if (!matches(PACKAGE_VERSION, entry.version)) fail('version');
    const reference = `${entry.name}/${entry.version}`;
    if (typeof entry.ref !== 'string' || !entry.ref.startsWith(reference) || !REFERENCE_TAIL.test(entry.ref.slice(reference.length))) fail('ref');
    if (!isListOf(LIB_NAME, entry.libs)) fail('libs');
    if (!isListOf(PACKAGE_NAME, entry.requires)) fail('requires');
    // They become linker and compiler arguments. A manifest an older crossbind wrote has none of them.
    const systemLibs = entry.systemLibs ?? [];
    const frameworks = entry.frameworks ?? [];
    const defines = entry.defines ?? [];
    if (!isListOf(LIB_NAME, systemLibs)) fail('systemLibs');
    if (!isListOf(LIB_NAME, frameworks)) fail('frameworks');
    if (!isListOf(DEFINE, defines)) fail('defines');
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
        systemLibs: [...systemLibs],
        frameworks: [...frameworks],
        defines: [...defines],
    };
}

// A define crossbind cannot pass as one plain argument was left out before crossbind took defines at all,
// so it stays out, with a notice, instead of stopping the build.
function plainDefinesOf(pkg) {
    if (!Array.isArray(pkg.defines)) return pkg.defines;
    return pkg.defines.filter((define) => {
        if (matches(DEFINE, define)) return true;
        logger.info(`crossbind: ${shown(pkg.ref)} asks the code that uses it to compile with ${shown(define)}, which crossbind leaves out: a define passes as a plain name with a plain value.`);
        return false;
    });
}

function installedPackage(source, pkg) {
    const folders = (key) => {
        if (!Array.isArray(pkg[key]) || !pkg[key].every((value) => typeof value === 'string')) {
            throw new Error(`crossbind: the ${source} package ${shown(pkg.ref)} has invalid ${key}.`);
        }
        return [...pkg[key]];
    };
    if (typeof pkg.packageFolder !== 'string') {
        throw new Error(`crossbind: ${source} reported the package ${shown(pkg.ref)} without a package folder.`);
    }
    return {
        ...packageEntry(source, { ...pkg, defines: plainDefinesOf(pkg) }),
        packageFolder: pkg.packageFolder,
        includedirs: folders('includedirs'),
        libdirs: folders('libdirs'),
    };
}

// One entry per package name, each before the packages it requires: the order a static link takes
// them in.
function linkOrder(packages) {
    const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
    const order = [];
    const visited = new Set();
    const visit = (name) => {
        if (visited.has(name) || !byName.has(name)) return;
        visited.add(name);
        byName.get(name).requires.forEach(visit);
        order.push(byName.get(name));
    };
    byName.forEach((pkg, name) => visit(name));
    return order.reverse();
}

// The packages a source's install reports, checked, in link order, with the folders the source found them in.
export function installedPackages(source, packages) {
    if (!Array.isArray(packages) || !packages.every((pkg) => pkg !== null && typeof pkg === 'object')) {
        throw new Error(`crossbind: ${source}'s install gives no list of the packages it installed.`);
    }
    return linkOrder(packages.map((pkg) => installedPackage(source, pkg)));
}

// The real path of a file a source reported, or null when there is none; refused when it resolves
// outside `root`.
function realPathWithin(source, file, root, pkg) {
    if (!fs.existsSync(file)) return null;
    const real = fs.realpathSync(file);
    const relative = path.relative(root, real);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`crossbind: the ${source} package ${pkg.ref} reports ${printable(file)}, which resolves outside ${root}.`);
    }
    return real;
}

// Packages link files to each other (libpng.a -> libpng16.a), so links are followed, but only to
// directories and regular files inside the package, and into each linked directory once: a link out
// of the package could point the copy at any file the host can read, and links back up the tree
// would copy it without end.
function copyTree(from, to, within) {
    const linked = new Set([from]);
    fs.cpSync(from, to, {
        recursive: true,
        dereference: true,
        filter: (file) => {
            const entry = fs.lstatSync(file);
            if (!entry.isSymbolicLink()) return entry.isDirectory() || entry.isFile();
            const real = within(file);
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
function packageRootOf(source, pkg, folder, store) {
    const real = realPathWithin(source, folder, store, pkg);
    if (!real || fs.lstatSync(folder).isSymbolicLink() || path.relative(store, real).split(path.sep).length < 2) {
        throw new Error(`crossbind: the ${source} package ${pkg.ref} has no package folder crossbind can use at ${printable(pkg.packageFolder)}.`);
    }
    return real;
}

// A package lands where a published port keeps its prebuilt (<dir>/dist/prebuilt/<target>/{include,lib}),
// so the dependency machinery links it and SWIG treats its headers as one across targets. Everything
// is read from inside the package's own folder in the store.
export function stagePackage(source, pkg, {
    stageDir, targetPath, toHost, store, distCmake,
}) {
    const packageRoot = packageRootOf(source, pkg, toHost(pkg.packageFolder), fs.realpathSync(store));
    const within = (file) => realPathWithin(source, file, packageRoot, pkg);
    const reported = (folder) => within(toHost(upath.isAbsolute(folder) ? folder : upath.join(pkg.packageFolder, folder)));
    const dir = sourcePackageDir(stageDir, pkg.name);
    const prebuilt = upath.join(dir, 'dist', 'prebuilt');
    const prefix = upath.join(prebuilt, targetPath);

    fs.rmSync(prefix, { recursive: true, force: true });
    fs.mkdirSync(upath.join(prefix, 'include'), { recursive: true });
    fs.mkdirSync(upath.join(prefix, 'lib'), { recursive: true });
    pkg.includedirs.map(reported).filter(Boolean).forEach((folder) => copyTree(folder, upath.join(prefix, 'include'), within));
    const libdirs = pkg.libdirs.map(reported).filter(Boolean);
    pkg.libs.forEach((lib) => {
        const archive = libdirs.map((folder) => within(path.join(folder, `lib${lib}.a`)))
            .find((file) => file && fs.statSync(file).isFile());
        if (!archive) {
            throw new Error(`crossbind: the ${source} package ${pkg.ref} declares the library ${lib}, but its package has no lib${lib}.a.`);
        }
        fs.copyFileSync(archive, upath.join(prefix, 'lib', `lib${lib}.a`));
    });

    const licenses = upath.join(dir, 'licenses');
    fs.rmSync(licenses, { recursive: true, force: true });
    const shipped = within(path.join(packageRoot, 'licenses'));
    if (shipped && fs.statSync(shipped).isDirectory()) copyTree(shipped, licenses, within);
    writeIfChanged(upath.join(dir, 'package.json'), `${JSON.stringify({
        name: `${source}:${pkg.name}`, version: pkg.version, nativeVersion: pkg.version, license: pkg.license, private: true,
    }, null, 4)}\n`);

    const hosts = fs.readdirSync(prebuilt, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && TARGET_PATH.test(entry.name)).map((entry) => entry.name).sort();
    // A recipe can name its libraries otherwise on another platform (libpng is png16 on Windows), so each
    // target links the archives staged for it.
    const archivesOf = (host) => {
        const libdir = upath.join(prebuilt, host, 'lib');
        if (!fs.existsSync(libdir)) return [];
        return fs.readdirSync(libdir).filter((file) => file.endsWith('.a')).map(libNameOf).filter((name) => matches(LIB_NAME, name)).sort();
    };
    const hostLibs = hostLibsOf(source);
    writeIfChanged(upath.join(prebuilt, 'CMakeLists.txt'), [
        ...hosts.map((host) => `set(${hostLibs}${host} "${archivesOf(host).join(';')}")`),
        distCmake
            .replace('___PROJECT_NAME___', () => sourceTargetName(source, pkg.name))
            .replace('___PROJECT_HOST___', () => hosts.join(';'))
            .replace('___PROJECT_LIBS___', () => `\${${hostLibs}\${PROJECT_TARGET_HOST}}`)
            .replace('___PROJECT_WHOLE_ARCHIVE___', () => ''),
    ].join('\n'));
}

const manifestsOf = (stageDir) => upath.join(stageDir, MANIFESTS);
const manifestFileOf = (stageDir, targetPath) => upath.join(manifestsOf(stageDir), `${targetPath}.json`);

// One manifest per target: a recipe can require other packages on another platform.
export function writeSourceManifest(stageDir, targetPath, manifest) {
    writeIfChanged(manifestFileOf(stageDir, targetPath), `${JSON.stringify(manifest, null, 4)}\n`);
}

// The packages staged for one target, or for every target staged so far, in link order, and each
// target's own list. A manifest staged for other dependencies describes packages the config no longer
// asks for.
export function readSourceManifest(source, stageDir, key, targetPath = null) {
    const dir = manifestsOf(stageDir);
    let files = [];
    if (targetPath) files = [manifestFileOf(stageDir, targetPath)];
    else if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => upath.join(dir, name));
    const manifests = files.map((file) => ({ target: upath.basename(file, '.json'), manifest: loadJson(file) }))
        .filter(({ manifest }) => manifest?.key === key);
    if (manifests.length === 0) return null;
    try {
        const targets = Object.fromEntries(manifests.map(({ target, manifest }) => [target, manifest.packages.map((entry) => packageEntry(source, entry))]));
        return { key, packages: linkOrder(Object.values(targets).flat()), targets };
    } catch (e) {
        throw new Error(`crossbind: ${dir} lists a package crossbind will not use - delete ${stageDir} and build again. ${e.message}`, { cause: e });
    }
}

// Changes whenever a build stages packages, so a process that attached before can tell.
export function sourceManifestsStamp(stageDir) {
    const dir = manifestsOf(stageDir);
    if (!fs.existsSync(dir)) return '';
    return fs.readdirSync(dir).sort().map((name) => `${name}@${fs.statSync(upath.join(dir, name)).mtimeMs}`).join('|');
}
