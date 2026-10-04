import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import state from '../state/index.js';
import loadJs from '../utils/loadJs.js';
import { isCopyleft } from '../utils/licenseReport.js';
import familyManifestOf from '../utils/familyManifest.js';
import { wasiToolchainIdentity } from '../utils/provenance.js';
import { resolveWasiSdkPath } from '../utils/wasiToolchain.js';
import resolveEmbindNapiRoot, { resolveEmbindJsiRoot } from '../utils/resolveEmbindNapi.js';
import { shippedBundledLicense } from '../utils/bundledLicenses.js';
import toolchainNoticesDir from '../utils/toolchainNotices.js';

const LEGACY_LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];
const WASI_LIBC_LICENSE = 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT';
const CROSSBIND_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MISSING_TEXT = '(missing: build the package once to extract the upstream source)';

function packageLicenseFile(dir) {
    return LEGACY_LICENSE_FILES.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file));
}

// License texts come from any extracted upstream source tree of the family (variants share the tarball).
function findSourceDir(familyDir) {
    const parent = path.dirname(familyDir);
    for (const entry of fs.readdirSync(parent)) {
        const src = path.join(parent, entry, '.crossbind', 'build', 'source');
        if (fs.existsSync(src)) return src;
    }
    return null;
}

function readLicenseTexts(files, locate) {
    const texts = (files || []).map((file) => {
        const filePath = locate(file);
        const body = filePath && fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf8').trim()
            : MISSING_TEXT;
        return `=== ${file} ===\n\n${body}`;
    });
    return texts.length > 0 ? texts.join('\n\n') : null;
}

// Vendored copies compiled into the artifact (recipe `bundled` map, keyed by platform)
// become first-class notice/SBOM rows with texts from the family source tree, or from the dist
// of whichever package of the family shipped them.
async function bundledRowsOf(node, platform, familyProjects) {
    const recipe = await loadJs(node.paths.project, 'crossbind.build');
    const entries = recipe?.bundled?.[platform];
    if (!entries || entries.length === 0) return [];
    const family = familyManifestOf(node);
    const sourceDir = family ? findSourceDir(family.dir) : null;
    return entries.map((entry) => ({
        name: entry.name,
        npmName: null,
        version: null,
        nativeVersion: entry.version || null,
        license: entry.license,
        licenseDeclared: entry.license,
        licenseSelected: null,
        licenseNotes: `${entry.notes ? `${entry.notes}; ` : ''}vendored inside ${node.general.name} ${node.package?.nativeVersion || ''}`.trim(),
        sha256: null,
        sourceUrl: null,
        licenseText: readLicenseTexts(entry.files, (file) => (sourceDir
            ? path.join(sourceDir, file)
            : shippedBundledLicense(familyProjects, entry.name, file))),
        isCopyleft: isCopyleft(entry.license),
    }));
}

// The wasi toolchain statically links its C/C++ runtime into every artifact; the
// notice rows pin the identities from the actual sdk (or point at the docker digest).
function wasiToolchainRows() {
    const sdkPath = resolveWasiSdkPath(state.config.system);
    const identity = sdkPath && fs.existsSync(`${sdkPath}/bin/clang`) ? wasiToolchainIdentity(sdkPath) : null;
    const sdkLabel = identity?.version
        ? `wasi-sdk ${identity.version}`
        : 'the digest-pinned wasi-sdk docker image (see crossbind.provenance)';
    const libcRef = identity?.['wasi-libc'] || 'main';
    const llvmRef = identity?.llvm || 'main';
    const shared = {
        npmName: null, version: null, sha256: null, licenseSelected: null, licenseText: null, isCopyleft: false,
    };
    return [
        {
            ...shared,
            name: 'wasi-libc',
            nativeVersion: identity?.['wasi-libc'] || null,
            license: WASI_LIBC_LICENSE,
            licenseDeclared: WASI_LIBC_LICENSE,
            sourceUrl: `https://github.com/WebAssembly/wasi-libc/tree/${libcRef}`,
            licenseNotes: `C runtime statically linked by ${sdkLabel}; license texts: https://github.com/WebAssembly/wasi-libc/blob/${libcRef}/LICENSE-APACHE-LLVM , .../LICENSE-APACHE , .../LICENSE-MIT (musl and cloudlibc portions are documented there)`,
        },
        {
            ...shared,
            name: 'llvm-runtimes',
            nativeVersion: identity?.['llvm-version'] || null,
            license: 'Apache-2.0 WITH LLVM-exception',
            licenseDeclared: 'Apache-2.0 WITH LLVM-exception',
            sourceUrl: `https://github.com/llvm/llvm-project/tree/${llvmRef}`,
            licenseNotes: `libc++, libc++abi, compiler-rt and libunwind statically linked by ${sdkLabel}; license text: https://github.com/llvm/llvm-project/blob/${llvmRef}/LICENSE.TXT`,
        },
    ];
}

// The notices a build copied out of its toolchain image (buildNode does it for Windows addons).
function toolchainNoticeTexts(platform) {
    const build = state.config?.paths?.build;
    const dir = build ? path.join(build, toolchainNoticesDir(platform)) : null;
    if (!dir || !fs.existsSync(dir)) return null;
    const texts = fs.readdirSync(dir).sort()
        .map((file) => `=== ${file} ===\n\n${fs.readFileSync(path.join(dir, file), 'utf8').trim()}`);
    return texts.length > 0 ? texts.join('\n\n') : null;
}

// A Linux or Windows addon carries its C++ runtime; a Windows one also carries parts of the
// mingw-w64 runtime and winpthreads, whose licenses ask for their notices in binary distributions.
// A macOS addon uses the system's C++ runtime.
function addonToolchainRows(platform) {
    const shared = {
        npmName: null, version: null, nativeVersion: null, sha256: null, licenseSelected: null, licenseText: null, isCopyleft: false,
    };
    const llvmLicense = 'Apache-2.0 WITH LLVM-exception';
    const llvmRuntimes = {
        ...shared,
        name: 'llvm-runtimes',
        license: llvmLicense,
        licenseDeclared: llvmLicense,
        sourceUrl: 'https://github.com/llvm/llvm-project',
    };
    const llvmText = 'license text: https://github.com/llvm/llvm-project/blob/main/LICENSE.TXT';
    if (platform === 'linux' || platform === 'linuxmusl') {
        return [{ ...llvmRuntimes, licenseNotes: `libc++ and libc++abi of the linux toolchain image, statically linked into the addon; ${llvmText}` }];
    }
    const mingwLicense = 'LicenseRef-MinGW-w64-runtime';
    return [
        { ...llvmRuntimes, licenseNotes: `libc++, libc++abi, libunwind and compiler-rt of the windows toolchain image (llvm-mingw), statically linked into the addon; ${llvmText}` },
        {
            ...shared,
            name: 'mingw-w64-runtime',
            license: mingwLicense,
            licenseDeclared: mingwLicense,
            sourceUrl: 'https://github.com/mingw-w64/mingw-w64',
            licenseNotes: 'the mingw-w64 startup code and winpthreads, statically linked into the addon; a binary distribution includes their notices: https://github.com/mingw-w64/mingw-w64/blob/master/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt and https://github.com/mingw-w64/mingw-w64/blob/master/mingw-w64-libraries/winpthreads/COPYING (the windows image carries both in /opt/licenses/llvm-mingw)',
            licenseText: toolchainNoticeTexts('win32'),
        },
    ];
}

// A Node-API addon compiles in crossbind's runtime: embind-jsi, which adapts Emscripten's embind,
// and node-api-jsi. The loader bundles the JavaScript half of the same runtime.
function nodeRuntimeRows({ isAddon }) {
    const versionOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    const textOf = (file) => fs.readFileSync(file, 'utf8').trim();
    const shared = {
        nativeVersion: null, sha256: null, licenseSelected: null, isCopyleft: false,
    };
    const jsiRoot = resolveEmbindJsiRoot();
    const rows = [
        {
            ...shared,
            name: 'crossbind',
            npmName: 'crossbind',
            version: versionOf(CROSSBIND_ROOT),
            license: 'MIT',
            licenseDeclared: 'MIT',
            sourceUrl: 'https://github.com/crossbind/crossbind',
            licenseNotes: 'the embind-jsi and embind-napi runtime and the bindings crossbind generates',
            licenseText: textOf(path.join(CROSSBIND_ROOT, 'LICENSE')),
        },
        {
            ...shared,
            name: 'emscripten-embind',
            npmName: '@crossbind/core-embind-jsi',
            version: versionOf(jsiRoot),
            license: 'MIT OR NCSA',
            licenseDeclared: 'MIT OR NCSA',
            sourceUrl: 'https://github.com/emscripten-core/emscripten',
            licenseNotes: "Emscripten's embind, adapted by @crossbind/core-embind-jsi",
            licenseText: textOf(path.join(jsiRoot, 'LICENSE')),
        },
    ];
    if (!isAddon) return rows;
    const napiRoot = resolveEmbindNapiRoot();
    return [...rows, {
        ...shared,
        name: 'node-api-jsi',
        npmName: '@crossbind/core-embind-napi',
        version: versionOf(napiRoot),
        license: 'MIT',
        licenseDeclared: 'MIT',
        sourceUrl: 'https://github.com/microsoft/node-api-jsi',
        licenseNotes: 'JSI over Node-API, with the local patches @crossbind/core-embind-napi lists',
        licenseText: textOf(path.join(napiRoot, 'third_party', 'node-api-jsi', 'LICENSE')),
    }];
}

async function buildRow(node) {
    const recipe = await loadJs(node.paths.project, 'crossbind.build');
    const manifest = node.package || null;
    const nativeVersion = manifest?.nativeVersion || null;
    let sourceUrl = null;
    if (recipe?.getURL && nativeVersion) {
        try {
            sourceUrl = recipe.getURL(nativeVersion);
        } catch (e) {
            sourceUrl = null;
        }
    }
    if (!sourceUrl) sourceUrl = manifest?.homepage || null;

    const family = familyManifestOf(node);
    const upstream = family?.manifest?.crossbind?.upstream?.license || null;
    let license;
    let licenseText;
    if (upstream) {
        license = upstream.selected || upstream.declared;
        const sourceDir = findSourceDir(family.dir);
        const fromSource = sourceDir ? readLicenseTexts(upstream.files, (file) => path.join(sourceDir, file)) : null;
        const isComplete = Boolean(fromSource) && !fromSource.includes(MISSING_TEXT);
        // An installed package has no extracted source, and some upstreams name no license file; the package
        // ships the upstream text as its LICENSE either way.
        const shipped = isComplete ? null : packageLicenseFile(node.paths.project);
        if (isComplete) licenseText = fromSource;
        else if (shipped) licenseText = `=== ${path.basename(shipped)} ===\n\n${fs.readFileSync(shipped, 'utf8').trim()}`;
        else licenseText = readLicenseTexts(upstream.files, () => null);
    } else {
        license = manifest?.license || null;
        const legacy = packageLicenseFile(node.paths.project);
        licenseText = legacy ? fs.readFileSync(legacy, 'utf8') : null;
    }

    return {
        name: node.general.name,
        npmName: manifest?.name || null,
        version: manifest?.version || null,
        nativeVersion,
        license,
        licenseDeclared: upstream?.declared || null,
        licenseSelected: upstream?.selected || null,
        licenseNotes: upstream?.notes || null,
        sha256: recipe?.sha256 || null,
        sourceUrl,
        licenseText,
        isCopyleft: isCopyleft(license),
    };
}

// A Conan package's facts come from its recipe, and its texts from the licenses/ its package ships.
function conanRow(node) {
    const { conan } = node.general;
    const licenseDir = `${node.paths.project}/licenses`;
    const files = fs.existsSync(licenseDir)
        ? fs.readdirSync(licenseDir, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
        : [];
    const texts = files.map((entry) => path.join(entry.parentPath, entry.name)).sort()
        .map((file) => `=== ${path.relative(licenseDir, file)} ===\n\n${fs.readFileSync(file, 'utf8').trim()}`);
    return {
        name: conan.name,
        npmName: null,
        version: null,
        nativeVersion: conan.version,
        license: conan.license,
        licenseDeclared: null,
        licenseSelected: null,
        licenseNotes: `built from the ConanCenter recipe ${conan.ref}`,
        sha256: conan.source?.sha256 ?? null,
        sourceUrl: conan.source?.url ?? conan.homepage ?? null,
        licenseText: texts.length > 0 ? texts.join('\n\n') : null,
        isCopyleft: isCopyleft(conan.license),
        purl: `pkg:conan/${conan.name}@${conan.version}`,
    };
}

// Conan packages join the graph from the stage a build makes; without it they would be left out unseen.
function assertConanStaged() {
    const attached = new Set(state.config.allDependencies.filter((d) => d.general.conan).map((d) => d.general.conan.name));
    const missing = Object.keys(state.config.conanDependencies ?? {}).filter((name) => !attached.has(name));
    if (missing.length > 0) {
        throw new Error(`crossbind: the Conan packages ${missing.join(', ')} are not installed for the current conanDependencies, so their rows would be missing. Build the project first.`);
    }
}

// platform (optional, e.g. 'wasi') additionally includes what that platform's
// artifact statically links beyond the package graph: recipe-declared vendored
// copies and the toolchain runtime. runtimeEnv 'node' adds the crossbind runtime an
// addon of that platform compiles in, or without a platform the one its loader bundles.
export default async function collectLicenseRows(platform = null, { runtimeEnv = null } = {}) {
    assertConanStaged();
    // The root package is a component too when it is a port: leaf -wasi packages have no deps but ship
    // their own upstream. A dependency that is no port, such as a library a project publishes, is one by
    // its package name; a private package is the project's own code, like the app.
    const keyOf = (node) => (node.general.conan ? `conan:${node.general.conan.name}` : node.general.alias?.package ?? node.package?.name);
    const nodes = [state.config, ...state.config.allDependencies]
        .filter((node, index) => node?.paths?.project
            && (node.general?.alias?.package || node.general?.conan || (index > 0 && node.package?.name && !node.package.private)));
    const rows = [];
    const seen = new Set();
    for (const node of nodes) {
        const key = keyOf(node);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(node.general.conan ? conanRow(node) : await buildRow(node));
        // A Conan package's folder is written from what its recipe produced: nothing there is run.
        if (platform && !node.general.conan) {
            const familyProjects = nodes.filter((other) => keyOf(other) === key).map((other) => other.paths.project);
            rows.push(...await bundledRowsOf(node, platform, familyProjects));
        }
    }
    if (platform === 'wasi') rows.push(...wasiToolchainRows());
    if (['linux', 'linuxmusl', 'win32'].includes(platform)) rows.push(...addonToolchainRows(platform));
    if (runtimeEnv === 'node') rows.push(...nodeRuntimeRows({ isAddon: platform !== null }));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
}
