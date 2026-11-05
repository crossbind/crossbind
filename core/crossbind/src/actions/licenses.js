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
import resolveAppHostRoot, { resolveAppEmbindJsiRoot } from '../utils/resolveAppHost.js';
import {
    HERMES, HERMES_ANDROID, HERMES_SOURCE, hermesUrl,
} from '../utils/hermes.js';
import { ANDROIDX_WEBKIT } from './gradleProject.js';
import { appExtensionsOf, extensionPackage } from '../utils/appExtensions.js';
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

// The notices a build copied out of its toolchain image (a Windows addon's or app's does).
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
        return [{ ...llvmRuntimes, licenseNotes: `libc++ and libc++abi of the linux toolchain image, statically linked into the binary; ${llvmText}` }];
    }
    const mingwLicense = 'LicenseRef-MinGW-w64-runtime';
    return [
        { ...llvmRuntimes, licenseNotes: `libc++, libc++abi, libunwind and compiler-rt of the windows toolchain image (llvm-mingw), statically linked into the binary; ${llvmText}` },
        {
            ...shared,
            name: 'mingw-w64-runtime',
            license: mingwLicense,
            licenseDeclared: mingwLicense,
            sourceUrl: 'https://github.com/mingw-w64/mingw-w64',
            licenseNotes: 'the mingw-w64 startup code and winpthreads, statically linked into the binary; a binary distribution includes their notices: https://github.com/mingw-w64/mingw-w64/blob/master/COPYING.MinGW-w64-runtime/COPYING.MinGW-w64-runtime.txt and https://github.com/mingw-w64/mingw-w64/blob/master/mingw-w64-libraries/winpthreads/COPYING (the windows image carries both in /opt/licenses/llvm-mingw)',
            licenseText: toolchainNoticeTexts('win32'),
        },
    ];
}

const versionOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const textOf = (file) => fs.readFileSync(file, 'utf8').trim();

// crossbind's runtime, which an addon and an app host compile in: embind-jsi, which adapts Emscripten's embind.
function runtimeRows(jsiRoot, notes) {
    const shared = {
        nativeVersion: null, sha256: null, licenseSelected: null, isCopyleft: false,
    };
    return [
        {
            ...shared,
            name: 'crossbind',
            npmName: 'crossbind',
            version: versionOf(CROSSBIND_ROOT),
            license: 'MIT',
            licenseDeclared: 'MIT',
            sourceUrl: 'https://github.com/crossbind/crossbind',
            licenseNotes: notes,
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
}

// A Node-API addon compiles in crossbind's runtime and node-api-jsi. The loader bundles the JavaScript half of the
// same runtime.
function nodeRuntimeRows({ isAddon }) {
    const rows = runtimeRows(resolveEmbindJsiRoot(), 'the embind-jsi and embind-napi runtime and the bindings crossbind generates');
    if (!isAddon) return rows;
    const napiRoot = resolveEmbindNapiRoot();
    return [...rows, {
        nativeVersion: null,
        sha256: null,
        licenseSelected: null,
        isCopyleft: false,
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

// What an app's host carries beside crossbind's runtime, pinned as the READMEs beside them in @crossbind/core-app-host
// record: React Native's Hermes, JSI's jsi.cpp from the same release, webview/webview, the updater's Monocypher, and on
// Windows the WebView2 SDK's headers.
const WEBVIEW = { version: 'cbbdee44afff22867de9fd88a9fc8350d9bdd399', sha256: '10e972a2327b5681474f4aa4499e505eaa4ff659aa995380386f08fd6fc1b763' };
const WEBVIEW2_SDK = { version: '1.0.4258.31', sha256: '56f7f4b8bf9aee4b8efefbbdd4f67d5f74ebd1b100ed0806da71bf76af481aa9' };
const JSI_SHA256 = 'cb6274a22abc93ecc970066539815e716d3e47716e8f93a9971cf4eb5918ffc1';
const MONOCYPHER = { version: '4.0.3', sha256: '8cc9bc341a66249016db9bd70e9142d8d0aef9945973744b1ac05dbc55d8ee66' };
// The fbjni the Hermes release for Android depends on.
const FBJNI_VERSION = '0.7.0';

const HERMES_BUILDS = {
    linux: {
        sha256: HERMES_SOURCE.sha256,
        sourceUrl: HERMES_SOURCE.url,
        licenseNotes: "Hermes built from its release's source in the linux toolchain image, statically linked into the host",
    },
    win32: {
        sha256: HERMES_SOURCE.sha256,
        sourceUrl: HERMES_SOURCE.url,
        licenseNotes: "Hermes built from its release's source in the windows toolchain image (llvm-mingw), statically linked into the host",
    },
    android: {
        sha256: HERMES_ANDROID.sha256,
        sourceUrl: HERMES_ANDROID.url,
        licenseNotes: "React Native's Hermes for Android, whose libraries the app's Gradle build takes from Maven Central",
    },
};

// What an Android app's Gradle build adds from Maven, and the C++ runtime the app carries beside its host.
function androidAppRows() {
    const shared = {
        npmName: null, sha256: null, licenseSelected: null, licenseText: null, isCopyleft: false,
    };
    const apache = { ...shared, license: 'Apache-2.0', licenseDeclared: 'Apache-2.0' };
    const llvmLicense = 'Apache-2.0 WITH LLVM-exception';
    return [
        {
            ...apache,
            name: 'fbjni',
            version: FBJNI_VERSION,
            nativeVersion: FBJNI_VERSION,
            sourceUrl: 'https://github.com/facebookincubator/fbjni',
            licenseNotes: 'libfbjni.so, which Hermes loads and Gradle takes with it; license text: https://github.com/facebookincubator/fbjni/blob/main/LICENSE',
        },
        {
            ...apache,
            name: 'androidx-webkit',
            version: ANDROIDX_WEBKIT,
            nativeVersion: ANDROIDX_WEBKIT,
            sourceUrl: 'https://developer.android.com/jetpack/androidx/releases/webkit',
            licenseNotes: "androidx.webkit, the WebView's message ports and start scripts, from Google's Maven repository; license text: https://www.apache.org/licenses/LICENSE-2.0.txt",
        },
        {
            ...shared,
            name: 'llvm-runtimes',
            version: null,
            nativeVersion: null,
            license: llvmLicense,
            licenseDeclared: llvmLicense,
            sourceUrl: 'https://github.com/llvm/llvm-project',
            licenseNotes: "libc++ of the android image's NDK, which the app carries as libc++_shared.so; license text: https://github.com/llvm/llvm-project/blob/main/LICENSE.TXT",
        },
    ];
}

// The WebView2 SDK headers a Windows host compiles against, and the NSIS its setup program carries. webview/webview
// loads the WebView2 Runtime itself, without the SDK's loader.
function windowsAppRows(hostRoot) {
    const license = 'BSD-3-Clause';
    return [{
        npmName: '@crossbind/core-app-host',
        name: 'webview2-sdk',
        version: WEBVIEW2_SDK.version,
        nativeVersion: WEBVIEW2_SDK.version,
        sha256: WEBVIEW2_SDK.sha256,
        license,
        licenseDeclared: license,
        licenseSelected: null,
        isCopyleft: false,
        sourceUrl: `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${WEBVIEW2_SDK.version}/microsoft.web.webview2.${WEBVIEW2_SDK.version}.nupkg`,
        licenseNotes: "the WebView2 SDK's headers from the windows toolchain image, whose interface IDs the host compiles in",
        licenseText: textOf(path.join(hostRoot, 'third_party', 'webview2', 'LICENSE')),
    }, {
        npmName: '@crossbind/core-app-host',
        name: 'nsis',
        version: '3.11',
        nativeVersion: '3.11',
        sha256: null,
        license: 'Zlib AND MIT',
        licenseDeclared: 'Zlib AND MIT',
        licenseSelected: null,
        isCopyleft: false,
        sourceUrl: 'https://sources.debian.org/src/nsis/3.11-1/',
        licenseNotes: "the installer stub and plugins the app's setup program carries, from Debian's nsis in the windows toolchain image: zlib/libpng, but for the System plugin's Call.S, MIT",
        licenseText: textOf(path.join(hostRoot, 'third_party', 'nsis', 'LICENSE')),
    }];
}

// What an app's extensions bring into it: each extension package's own code, and the code of others each carries, as its
// app.licenses lists it. An extension in the project's own folders is the project's code, as the app is.
function extensionRows() {
    return appExtensionsOf(state.config.extensions ?? []).flatMap((extension) => {
        const own = extensionPackage(extension.root, state.config.paths.base);
        const owner = own?.manifest.name ?? null;
        const license = own?.manifest.license ?? null;
        const shipped = own && packageLicenseFile(own.dir);
        const packageRows = own && !own.manifest.private ? [{
            npmName: owner,
            name: owner,
            version: own.manifest.version ?? null,
            nativeVersion: null,
            license,
            licenseDeclared: license,
            licenseSelected: null,
            isCopyleft: Boolean(license) && isCopyleft(license),
            sourceUrl: own.manifest.homepage ?? null,
            licenseNotes: `the app extension ${extension.name}, which the app's host compiles in`,
            licenseText: shipped ? textOf(shipped) : null,
        }] : [];
        const carried = (extension.app.licenses ?? []).map((entry) => ({
            npmName: null,
            name: entry.name,
            version: null,
            nativeVersion: entry.version,
            sha256: entry.sha256 ?? null,
            license: entry.license,
            licenseDeclared: entry.license,
            licenseSelected: null,
            isCopyleft: isCopyleft(entry.license),
            sourceUrl: entry.source ?? null,
            licenseNotes: `carried by the app extension ${extension.name}${owner ? ` of ${owner}` : ''}, which the app's host compiles in`,
            licenseText: textOf(path.join(extension.root, entry.file)),
        }));
        return [...packageRows, ...carried];
    });
}

function appRuntimeRows(platform) {
    const hostRoot = resolveAppHostRoot();
    const hermesLicense = textOf(path.join(hostRoot, 'third_party', 'jsi', 'LICENSE'));
    const mit = {
        npmName: '@crossbind/core-app-host', license: 'MIT', licenseDeclared: 'MIT', licenseSelected: null, isCopyleft: false,
    };
    const hermes = HERMES_BUILDS[platform] ?? {
        sha256: HERMES.sha256,
        sourceUrl: hermesUrl(HERMES.version),
        licenseNotes: "React Native's Hermes for Apple platforms, which the app carries as hermesvm.framework",
    };
    return [
        ...runtimeRows(resolveAppEmbindJsiRoot(), 'the embind-jsi runtime, the app host and the bindings crossbind generates'),
        {
            ...mit,
            ...hermes,
            name: 'hermes',
            version: HERMES.version,
            nativeVersion: HERMES.version,
            licenseText: hermesLicense,
        },
        {
            ...mit,
            name: 'jsi',
            version: HERMES.version,
            nativeVersion: HERMES.version,
            sha256: JSI_SHA256,
            sourceUrl: 'https://github.com/facebook/hermes',
            licenseNotes: "JSI's jsi.cpp from the same Hermes release, compiled into the host",
            licenseText: hermesLicense,
        },
        ...(platform === 'android' ? androidAppRows() : []),
        ...(platform === 'win32' ? windowsAppRows(hostRoot) : []),
        // A mobile app makes its window with UIKit or an Android activity, without webview/webview.
        ...(['ios', 'android'].includes(platform) ? [] : [{
            ...mit,
            name: 'webview',
            version: WEBVIEW.version,
            nativeVersion: WEBVIEW.version,
            sha256: WEBVIEW.sha256,
            sourceUrl: 'https://github.com/webview/webview',
            licenseNotes: 'webview/webview, with the local patch @crossbind/core-app-host lists',
            licenseText: textOf(path.join(hostRoot, 'third_party', 'webview', 'LICENSE')),
        }]),
        // A desktop app with app.updater alone has the host's updater, which checks updates with Monocypher.
        ...(['ios', 'android'].includes(platform) || state.config.app?.updater === undefined ? [] : [{
            npmName: '@crossbind/core-app-host',
            name: 'monocypher',
            version: MONOCYPHER.version,
            nativeVersion: MONOCYPHER.version,
            sha256: MONOCYPHER.sha256,
            license: 'BSD-2-Clause OR CC0-1.0',
            licenseDeclared: 'BSD-2-Clause OR CC0-1.0',
            licenseSelected: null,
            isCopyleft: false,
            sourceUrl: `https://monocypher.org/download/monocypher-${MONOCYPHER.version}.tar.gz`,
            licenseNotes: "Monocypher's Ed25519 and SHA-512, compiled into the host's updater, which check the app's updates",
            licenseText: textOf(path.join(hostRoot, 'extensions', 'updater', 'monocypher', 'LICENCE.md')),
        }]),
    ];
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
// addon of that platform compiles in, or without a platform the one its loader bundles;
// runtimeEnv 'app' adds what an app's host carries.
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
    if (runtimeEnv === 'app') {
        rows.push(...appRuntimeRows(platform));
        // A library two extensions carry, or one the app has already, is listed once for each version the app ships.
        const versionOf = (row) => `${row.name}@${row.nativeVersion ?? row.version}`;
        const listed = new Set(rows.map(versionOf));
        for (const row of extensionRows()) {
            if (listed.has(versionOf(row))) continue;
            listed.add(versionOf(row));
            rows.push(row);
        }
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name));
}
