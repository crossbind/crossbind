import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { state, findFiles, computeInputStamp } from 'crossbind';

const SOURCE_EXTS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];

// The Metro run in build_js.js exists for its side effect (SWIG bridges from .h imports)
// plus the bridge bundle. Its effective inputs are the app and dependency sources; the
// node_modules graph is approximated by the package.json files (versions) — escape hatch:
// CROSSBIND_NO_BRIDGE_CACHE=1.
function computeStampHash(platform) {
    const roots = [
        state.config.paths.project,
        ...state.config.allDependencies.map((d) => d.paths.project),
    ];
    // Header, native and module roots may sit outside the project (a shared kit dir): inputs too.
    for (const root of [...state.config.paths.header, ...state.config.paths.native, ...state.config.paths.module]) {
        if (!roots.some((r) => root === r || root.startsWith(`${r}/`))) roots.push(root);
    }
    const exts = [...new Set([...SOURCE_EXTS, ...state.config.ext.header, ...state.config.ext.module])];
    const extraFiles = [
        `${state.config.paths.cli}/../package.json`,
        fileURLToPath(new URL('../package.json', import.meta.url)),
    ];
    return computeInputStamp(roots, exts, extraFiles, `platform:${platform}`);
}

const stampPath = (platform) => `${state.config.paths.build}/bridge-stamp-${platform}.json`;

export function isBridgeFresh(platform, bundleOutput) {
    if (process.env.CROSSBIND_NO_BRIDGE_CACHE === '1') return false;
    let stamp;
    try {
        stamp = JSON.parse(fs.readFileSync(stampPath(platform), 'utf8'));
    } catch (e) {
        return false;
    }
    if (!stamp?.hash || !Array.isArray(stamp.outputs)) return false;
    if (![bundleOutput, ...stamp.outputs].every((file) => fs.existsSync(file))) return false;
    return stamp.hash === computeStampHash(platform);
}

export function saveBridgeStamp(platform, bundleOutput) {
    const outputs = [
        bundleOutput,
        ...findFiles('**/*', { cwd: `${state.config.paths.build}/bridge`, nodir: true }),
    ];
    fs.writeFileSync(stampPath(platform), JSON.stringify({ hash: computeStampHash(platform), outputs }));
}
