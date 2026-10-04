import state, { setAllDependecyPaths } from '../state/index.js';
import attachConanDependencies from '../state/attachConanDependencies.js';
import installConanPackages from '../utils/conanInstall.js';

// Conan packages are staged before any header is read: SWIG parses headers that include theirs, and an
// interface made without its includes stays that way until the header itself changes. Release trees
// only - a debug build links them like any prebuilt.
export default async function prepareConanDependencies(targets) {
    if (Object.keys(state.config.conanDependencies ?? {}).length === 0) return;
    // createBridgeFile reads every header for the first wasm target unless it is told otherwise.
    const bridgeTarget = state.targets.find((target) => target.platform === 'wasm');
    const releaseTargets = [...new Map([...targets, bridgeTarget].map((target) => [
        target.releasePath, { ...target, buildType: 'release', path: target.releasePath },
    ])).values()];
    await installConanPackages(state.config, releaseTargets);
    // Also when another process did the staging: this one may have loaded before the manifest existed.
    attachConanDependencies(state.config);
    setAllDependecyPaths();
}
