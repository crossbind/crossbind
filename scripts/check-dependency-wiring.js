#!/usr/bin/env node
// Verifies that every declared dependency of a ports/<family> tree is actually WIRED into
// its native build (referenced by getBuildParams / env / getExtraLibs on every platform it is
// declared for). This catches the "declared + fetched + built, but never passed to the
// compiler" class of bug - e.g. libtiff shipped without zlib (Deflate codec off) through
// beta.24, and the GDAL OpenMP flag that was wired inconsistently across platforms.
//
// It works statically: it calls each build recipe's getBuildParams with a Proxy that records
// which dependency lib-keys it reads, then checks that every declared dependency's lib-key
// (its mergeConfig general.name, e.g. zlib -> "z") shows up.
//
//   node scripts/check-dependency-wiring.js            # report
//   node scripts/check-dependency-wiring.js --check    # exit non-zero on any gap (CI gate)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listFamilies, portDir, familyOfName } from './lib/ports.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--check');

const PLATFORMS = [
    { platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release' },
    { platform: 'ios', arch: 'iphoneos', runtime: 'mt', buildType: 'release' },
    { platform: 'android', arch: 'arm64-v8a', runtime: 'mt', buildType: 'release' },
    { platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'release' },
    { platform: 'linux', arch: 'arm64', runtime: 'mt', buildType: 'release' },
    { platform: 'win32', arch: 'x64', runtime: 'mt', buildType: 'release' },
];

// Dependencies intentionally NOT wired explicitly in build.mjs. A `configure` recipe gets every
// dependency's -I/-L added to CFLAGS/LDFLAGS by createLib automatically, so its configure step
// auto-detects them without an explicit flag. Every entry needs a reason; anything NOT listed
// here must be referenced in build.mjs - which is what would have caught the libtiff/zlib gap
// that shipped in beta.24 (zlib was declared and built, but never passed to libtiff's CMake).
const ALLOWLIST = {
    spatialite: {
        proj: 'configure auto-detects proj via the -I/-L createLib adds for every dependency',
        zlib: 'configure auto-detects zlib via the -I/-L createLib adds for every dependency',
        iconv: 'configure auto-detects iconv via the -I/-L createLib adds for every dependency',
    },
};

async function importDefault(file) {
    if (!fs.existsSync(file)) return null;
    return (await import(pathToFileURL(file).href)).default;
}

// A family's lib-keys: the depPaths keys other packages reference it by. crossbind keys depPaths
// by each entry of export.libName (e.g. openssl -> ["ssl","crypto"]), falling back to
// general.name (e.g. zlib -> "z"). A dependency counts as wired if ANY of its keys is used.
async function libKeysOfFamily(family) {
    const mergeConfig = await importDefault(path.join(portDir(ROOT, family), 'mergeConfig.mjs'));
    if (typeof mergeConfig !== 'function') return null;
    const cfg = mergeConfig({});
    const keys = cfg?.export?.libName || (cfg?.general?.name ? [cfg.general.name] : []);
    return keys.length ? keys : null;
}

const familyOfSubpackage = familyOfName;

// Declared native dependencies for one platform subpackage (the sibling package families it
// links against), excluding the family's own brand package.
function declaredDeps(family, platform) {
    const pj = path.join(portDir(ROOT, family, platform), 'package.json');
    if (!fs.existsSync(pj)) return null;
    const deps = JSON.parse(fs.readFileSync(pj, 'utf8')).dependencies || {};
    return Object.keys(deps)
        .filter((d) => d.startsWith('@crossbind/port-') && d.endsWith(`-${platform}`))
        .map(familyOfSubpackage)
        .filter((f) => f !== family);
}

// Everything the build recipe references for a target: the depPaths keys getBuildParams reads
// (recorded via Proxy), plus any -l<name> in env / getExtraLibs.
function referencedLibKeys(recipe, target) {
    const keys = new Set();
    const depPaths = new Proxy(
        {},
        {
            get(_t, prop) {
                if (typeof prop !== 'string') return undefined;
                keys.add(prop);
                // A truthy sentinel so ifDep(depPaths.x, ...) enters and reads .header/.lib/...
                return {
                    header: `__H_${prop}__`,
                    lib: `__L_${prop}__`,
                    libPath: `__P_${prop}__`,
                    package: prop,
                };
            },
            has() {
                return true;
            },
        },
    );

    const collectLinkFlags = (value) => {
        const scan = (v) => {
            if (typeof v === 'string') {
                const m = v.match(/-l([A-Za-z0-9_+.-]+)/g);
                if (m) m.forEach((f) => keys.add(f.slice(2)));
            } else if (Array.isArray(v)) {
                v.forEach(scan);
            }
        };
        scan(value);
    };

    try {
        if (typeof recipe.getBuildParams === 'function') collectLinkFlags(recipe.getBuildParams(target, depPaths, 'a', '/tmp/build'));
    } catch {
        /* ignore */
    }
    try {
        if (typeof recipe.env === 'function') collectLinkFlags(recipe.env(target, depPaths));
    } catch {
        /* ignore */
    }
    try {
        if (typeof recipe.getExtraLibs === 'function') collectLinkFlags(recipe.getExtraLibs(target, depPaths));
    } catch {
        /* ignore */
    }
    return keys;
}

const families = listFamilies(ROOT);

const gaps = [];
let checked = 0;

for (const family of families) {
    const recipe = await importDefault(path.join(portDir(ROOT, family), 'build.mjs'));
    // No build recipe (prebuilt-only), or a recipe that takes no dependencies to wire.
    if (!recipe || (typeof recipe.getBuildParams !== 'function' && typeof recipe.env !== 'function' && typeof recipe.getExtraLibs !== 'function'))
        continue;

    for (const target of PLATFORMS) {
        const deps = declaredDeps(family, target.platform);
        if (!deps || deps.length === 0) continue;
        checked += 1;
        const referenced = referencedLibKeys(recipe, target);
        for (const dep of deps) {
            if (ALLOWLIST[family]?.[dep]) continue; // intentionally auto-detected / not wired
            const libKeys = await libKeysOfFamily(dep);
            if (libKeys && !libKeys.some((k) => referenced.has(k))) {
                gaps.push({
                    family,
                    platform: target.platform,
                    dep,
                    libKey: libKeys.join('/'),
                });
            }
        }
    }
}

if (gaps.length === 0) {
    console.log(`crossbind: dependency wiring OK — every declared dependency is wired on every platform (${checked} package/platform combinations).`);
    process.exit(0);
}

console.error('crossbind: dependency-wiring gaps found (declared + built, but never passed to the build):\n');
for (const g of gaps) {
    console.error(`  - @crossbind/port-${g.family} [${g.platform}] declares ${g.dep} (lib "${g.libKey}") but its build recipe never references it.`);
}
console.error(
    `\n${gaps.length} gap(s). Wire the dependency in build.mjs (getBuildParams/env), or drop it from the platform's dependencies if it is not needed.`,
);
process.exit(STRICT ? 1 : 0);
