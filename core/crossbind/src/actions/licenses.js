import fs from 'node:fs';
import path from 'node:path';
import state from '../state/index.js';
import loadJs from '../utils/loadJs.js';
import { isCopyleft } from '../utils/licenseReport.js';
import familyManifestOf from '../utils/familyManifest.js';
import { wasiToolchainIdentity } from '../utils/provenance.js';
import { resolveWasiSdkPath } from '../utils/wasiToolchain.js';

const LEGACY_LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING'];
const WASI_LIBC_LICENSE = 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT';

// License texts come from any extracted upstream source tree of the family (variants share the tarball).
function findSourceDir(familyDir) {
    const parent = path.dirname(familyDir);
    for (const entry of fs.readdirSync(parent)) {
        const src = path.join(parent, entry, '.crossbind', 'build', 'source');
        if (fs.existsSync(src)) return src;
    }
    return null;
}

function readLicenseTexts(sourceDir, files) {
    const texts = (files || []).map((file) => {
        const filePath = sourceDir ? path.join(sourceDir, file) : null;
        const body = filePath && fs.existsSync(filePath)
            ? fs.readFileSync(filePath, 'utf8').trim()
            : '(missing: build the package once to extract the upstream source)';
        return `=== ${file} ===\n\n${body}`;
    });
    return texts.length > 0 ? texts.join('\n\n') : null;
}

// Vendored copies compiled into the artifact (recipe `bundled` map, keyed by platform)
// become first-class notice/SBOM rows with texts from the family source tree.
async function bundledRowsOf(node, platform) {
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
        licenseText: readLicenseTexts(sourceDir, entry.files),
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
    if (platform === 'linux') {
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
        },
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
        licenseText = readLicenseTexts(findSourceDir(family.dir), upstream.files);
    } else {
        license = manifest?.license || null;
        const legacy = LEGACY_LICENSE_FILES
            .map((name) => `${node.paths.project}/${name}`)
            .find((file) => fs.existsSync(file));
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

// platform (optional, e.g. 'wasi') additionally includes what that platform's
// artifact statically links beyond the package graph: recipe-declared vendored
// copies and the toolchain runtime.
export default async function collectLicenseRows(platform = null) {
    // The root package is a component too: leaf -wasi packages have no deps but ship their own upstream.
    const nodes = [state.config, ...state.config.allDependencies]
        .filter((node) => node?.general?.alias?.package && node.paths?.project);
    const rows = [];
    const seen = new Set();
    for (const node of nodes) {
        const key = node.general.alias.package;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(await buildRow(node));
        if (platform) rows.push(...await bundledRowsOf(node, platform));
    }
    if (platform === 'wasi') rows.push(...wasiToolchainRows());
    if (platform === 'linux' || platform === 'win32') rows.push(...addonToolchainRows(platform));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
}
