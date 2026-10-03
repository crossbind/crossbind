#!/usr/bin/env node
/**
 * Verifies that every platform-specific package under ports/ has a
 * `dist/` folder that contains the expected prebuilt libraries.
 *
 * For each `ports/<family>/<platform>` directory the script:
 *   1. Reads `crossbind.config.js` to determine the library name(s)
 *      (`export.libName`, falling back to `general.name`).
 *   2. Checks the expected prebuilt targets exist:
 *        wasm    → wasm-wasm32-mt-release, wasm-wasm32-st-release
 *        ios     → ios-iphoneos-mt-release, ios-iphonesimulator-mt-release
 *        android → android-arm64-v8a-mt-release, android-x86_64-mt-release
 *        darwin  → darwin-arm64-mt-release, darwin-x64-mt-release
 *        linux   → linux-arm64-mt-release, linux-x64-mt-release
 *        linuxmusl → linuxmusl-arm64-mt-release, linuxmusl-x64-mt-release
 *        win32   → win32-arm64-mt-release, win32-x64-mt-release
 *   3. Verifies each target contains:
 *        - lib/lib<libName>.<ext>   (.a for wasm/ios/darwin/linux/linuxmusl/win32, .so for android)
 *        - include/  (non-empty)
 *   4. Verifies dist/prebuilt/CMakeLists.txt exists.
 *
 * Usage:
 *   node check-dist.js          # Print a report and exit non-zero on failure
 *   node check-dist.js --quiet  # Print only the summary line and failures
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'ports');

const QUIET = process.argv.includes('--quiet');

const PLATFORM_TARGETS = {
    wasm: ['wasm-wasm32-mt-release', 'wasm-wasm32-st-release'],
    ios: ['ios-iphoneos-mt-release', 'ios-iphonesimulator-mt-release'],
    android: ['android-arm64-v8a-mt-release', 'android-x86_64-mt-release'],
    darwin: ['darwin-arm64-mt-release', 'darwin-x64-mt-release'],
    linux: ['linux-arm64-mt-release', 'linux-x64-mt-release'],
    linuxmusl: ['linuxmusl-arm64-mt-release', 'linuxmusl-x64-mt-release'],
    win32: ['win32-arm64-mt-release', 'win32-x64-mt-release'],
};

const PLATFORM_LIB_EXT = {
    wasm: '.a',
    ios: '.a',
    android: '.so',
    darwin: '.a',
    linux: '.a',
    linuxmusl: '.a',
    win32: '.a',
};

// ports/<family>/<target>: the directory name is the target itself.
function detectPlatform(target) {
    return Object.keys(PLATFORM_TARGETS).includes(target) ? target : null;
}

// The gdal3.js-layout platform configs are thin mergeConfig() calls — name and
// libName live in the core package. Import the config for real instead of
// regex-parsing it; workspace links resolve the core from the package dir.
async function loadConfigMeta(configPath, platform) {
    const config = (await import(pathToFileURL(configPath).href)).default;

    const generalName = config?.general?.name ?? null;
    let libNames = config?.export?.libName?.length > 0 ? [...config.export.libName] : generalName ? [generalName] : [];

    const specs = (config?.targetSpecs || []).filter((spec) => !spec.platform || spec.platform === platform);
    const libType = specs.map((spec) => spec.libType ?? spec.specs?.libType).find(Boolean) ?? null;
    const ignored = specs.flatMap((spec) => spec.ignoreLibName ?? spec.specs?.ignoreLibName ?? []);
    libNames = libNames.filter((name) => !ignored.includes(name));

    return { name: generalName, libNames, libType };
}

function findPlatformPackages() {
    const families = fs
        .readdirSync(PACKAGES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

    const out = [];
    for (const family of families) {
        const familyDir = path.join(PACKAGES_DIR, family);
        const subs = fs.readdirSync(familyDir, { withFileTypes: true }).filter((e) => e.isDirectory());
        for (const sub of subs) {
            const platform = detectPlatform(sub.name);
            if (!platform) continue;
            out.push({
                name: `@crossbind/port-${family}-${sub.name}`,
                platform,
                dir: path.join(familyDir, sub.name),
            });
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

async function checkPackage(pkg) {
    const issues = [];
    const distDir = path.join(pkg.dir, 'dist');
    const prebuiltDir = path.join(distDir, 'prebuilt');

    if (!fs.existsSync(distDir)) {
        issues.push('dist/ folder missing');
        return { issues, libNames: [] };
    }

    if (!fs.existsSync(prebuiltDir)) {
        issues.push('dist/prebuilt/ folder missing');
        return { issues, libNames: [] };
    }

    const configPath = path.join(pkg.dir, 'crossbind.config.js');
    if (!fs.existsSync(configPath)) {
        issues.push('crossbind.config.js missing');
        return { issues, libNames: [] };
    }

    let meta;
    try {
        meta = await loadConfigMeta(configPath, pkg.platform);
    } catch (e) {
        issues.push(`crossbind.config.js failed to import: ${e.message}`);
        return { issues, libNames: [] };
    }
    const { libNames, libType } = meta;
    if (libNames.length === 0) {
        issues.push('no libName resolved from crossbind.config.js');
        return { issues, libNames };
    }

    if (!fs.existsSync(path.join(prebuiltDir, 'CMakeLists.txt'))) {
        issues.push('dist/prebuilt/CMakeLists.txt missing');
    }

    const targets = PLATFORM_TARGETS[pkg.platform];
    const ext = libType === 'static' ? '.a' : PLATFORM_LIB_EXT[pkg.platform];

    for (const target of targets) {
        const targetDir = path.join(prebuiltDir, target);
        if (!fs.existsSync(targetDir)) {
            issues.push(`target ${target}/ missing`);
            continue;
        }

        const includeDir = path.join(targetDir, 'include');
        if (!fs.existsSync(includeDir) || fs.readdirSync(includeDir).length === 0) {
            issues.push(`${target}/include/ missing or empty`);
        }

        const libDir = path.join(targetDir, 'lib');
        if (!fs.existsSync(libDir)) {
            issues.push(`${target}/lib/ missing`);
            continue;
        }

        for (const libName of libNames) {
            const libFile = path.join(libDir, `lib${libName}${ext}`);
            if (!fs.existsSync(libFile)) {
                issues.push(`${target}/lib/lib${libName}${ext} missing`);
            }
        }
    }

    return { issues, libNames };
}

async function main() {
    const packages = findPlatformPackages();
    const results = [];
    for (const pkg of packages) {
        results.push({ pkg, ...(await checkPackage(pkg)) });
    }

    const ok = results.filter((r) => r.issues.length === 0);
    const failed = results.filter((r) => r.issues.length > 0);

    const ordered = QUIET ? failed : [...ok, ...failed];

    for (const r of ordered) {
        const status = r.issues.length === 0 ? 'OK' : 'FAIL';
        const libs = r.libNames.length > 0 ? ` [${r.libNames.join(', ')}]` : '';
        console.log(`${status.padEnd(4)} ${r.pkg.name}${libs}`);
        for (const issue of r.issues) {
            console.log(`     - ${issue}`);
        }
    }
    if (!QUIET) console.log('');

    console.log(`Summary: ${ok.length}/${results.length} packages OK, ${failed.length} failed.`);

    process.exit(failed.length > 0 ? 1 : 0);
}

main();
