import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    state, findFiles, computeInputStamp, getDependenciesStamp,
} from 'crossbind';

const SOURCE_EXTS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'];

// JS sources are inputs too: they decide which .h bridges Metro emits, and those
// bridges are compiled into the Full libs. The deps stamp in the salt invalidates
// the libs when an override rebuild swaps dependency artifacts.
function computeStampHash(buildType, extraRoots) {
    const roots = [
        state.config.paths.project,
        ...state.config.allDependencies.map((d) => d.paths.project),
        ...extraRoots,
    ];
    // Header, native and module roots may sit outside the project (a shared kit dir): inputs too.
    for (const root of [...state.config.paths.header, ...state.config.paths.native, ...state.config.paths.module]) {
        if (!roots.some((r) => root === r || root.startsWith(`${r}/`))) roots.push(root);
    }
    const exts = [...new Set([
        ...SOURCE_EXTS, ...state.config.ext.source, ...state.config.ext.header, ...state.config.ext.module,
    ])];
    const extraFiles = [
        `${state.config.paths.cli}/../package.json`,
        fileURLToPath(new URL('../package.json', import.meta.url)),
    ];
    return computeInputStamp(roots, exts, extraFiles, `ios-libs:${buildType}:${getDependenciesStamp()}`);
}

const stampPath = (buildType) => `${state.config.paths.build}/ios-libs-stamp-${buildType}.json`;

// The xcframework lives in the (possibly shared) plugin dir; pin output mtimes so a
// rebuild from another app using the same plugin checkout invalidates this app's skip.
export function isIosLibsFresh(buildType, pluginDir, extraRoots) {
    if (process.env.CROSSBIND_NO_IOS_CACHE === '1') return false;
    let stamp;
    try {
        stamp = JSON.parse(fs.readFileSync(stampPath(buildType), 'utf8'));
    } catch (e) {
        return false;
    }
    if (!stamp?.hash || !Array.isArray(stamp.outputs) || stamp.outputs.length === 0) return false;
    const outputsIntact = stamp.outputs.every(
        ({ file, mtimeMs }) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs === mtimeMs,
    );
    if (!outputsIntact) return false;
    return stamp.hash === computeStampHash(buildType, extraRoots);
}

export function saveIosLibsStamp(buildType, pluginDir, extraRoots) {
    const outputs = findFiles('react-native-crossbind*.xcframework/**/*', { cwd: pluginDir, nodir: true })
        .map((file) => ({ file, mtimeMs: fs.statSync(file).mtimeMs }));
    fs.writeFileSync(
        stampPath(buildType),
        JSON.stringify({ hash: computeStampHash(buildType, extraRoots), outputs }),
    );
}
