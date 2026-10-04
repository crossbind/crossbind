import fs from 'node:fs';
import state, { setAllDependecyPaths } from '../state/index.js';
import refreshConanDependencies from '../state/refreshConanDependencies.js';
import installConanPackages from '../utils/conanInstall.js';
import createXCFramework from './createXCFramework.js';

const mtimeOf = (file) => fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -Infinity;

// iOS headers and archives come out of an xcframework per library with a slice per SDK (state/index.js).
// One older than an archive it wraps was made before the package was staged again.
function makeConanXCFrameworks(iosTargets) {
    const isFresh = (dependency, name) => mtimeOf(`${dependency.paths.project}/${name}.xcframework/Info.plist`)
        >= Math.max(...iosTargets.map((target) => mtimeOf(`${dependency.paths.output}/prebuilt/${target.path}/lib/lib${name}.a`)));
    state.config.allDependencies
        .filter((dependency) => dependency.general.conan && !dependency.export.libName.every((name) => isFresh(dependency, name)))
        .forEach((dependency) => createXCFramework({
            paths: { project: dependency.paths.project, output: dependency.paths.output },
            export: { libName: dependency.export.libName },
            targetParams: {
                platform: ['ios'], arch: iosTargets.map((target) => target.arch), runtime: ['mt'], buildType: ['release'],
            },
        }));
}

// Conan packages are staged before any header is read: SWIG parses headers that include theirs, and an
// interface made without its includes stays that way until the header itself changes. Release trees
// only - a debug build links them like any prebuilt.
export default async function prepareConanDependencies(targets) {
    if (Object.keys(state.config.conanDependencies ?? {}).length === 0) return;
    // createBridgeFile reads every header for the first wasm target unless it is told otherwise, as it
    // is by Metro, which builds the React Native bridges for the platform's own target.
    const bridgeTarget = targets.some((target) => target.platform === 'wasm') && state.targets.find((target) => target.platform === 'wasm');
    // One xcframework holds both SDKs, so an iOS build stages both.
    const iosTargets = targets.some((target) => target.platform === 'ios') ? state.targets.filter((target) => target.platform === 'ios') : [];
    const releaseTargets = [...new Map([...targets, bridgeTarget, ...iosTargets].filter(Boolean).map((target) => [
        target.releasePath, { ...target, buildType: 'release', path: target.releasePath },
    ])).values()];
    await installConanPackages(state.config, releaseTargets);
    // Also when another process did the staging: this one may have loaded before the manifests existed.
    refreshConanDependencies(state.config);
    setAllDependecyPaths();
    if (iosTargets.length > 0) makeConanXCFrameworks(releaseTargets.filter((target) => target.platform === 'ios'));
}
