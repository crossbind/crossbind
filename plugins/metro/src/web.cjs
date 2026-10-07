// The files the web bundle's boot code asks for, each one a build output of the web target.
const WEB_FILES = [
    { name: 'crossbind.js', output: 'jsName', contentType: 'text/javascript' },
    { name: 'crossbind.wasm', output: 'wasmName', contentType: 'application/wasm' },
    { name: 'crossbind.data.txt', output: 'dataTxtName', contentType: 'text/plain', isOptional: true },
];

// The build the Vite, webpack and Rollup plugins make for a browser: single-threaded unless
// crossbind.config.js sets target.runtime to 'mt'. Null when the config leaves no such target.
function getWebTargets({ getTargetParams, getFilteredBuildTargets }) {
    const targetParams = getTargetParams({
        platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'],
    }, true);
    const release = getFilteredBuildTargets(targetParams, { buildType: 'release' })[0];
    const debug = getFilteredBuildTargets(targetParams, { buildType: 'debug' })[0];
    if (!release && !debug) return null;
    return { targetParams, release: release ?? debug, debug: debug ?? release };
}

function requireWebTargets(crossbind) {
    const webTargets = getWebTargets(crossbind);
    if (!webTargets) {
        throw new Error('crossbind: crossbind.config.js leaves no wasm32 browser target to build the web app with.');
    }
    return webTargets;
}

// Metro transforms the .h imports in worker processes, so their bridges are read from the build
// directory, as the native builds read them.
async function buildWebGlue(crossbind, targetParams, target) {
    const {
        state, buildDependencies, isSourceNewer, createLib, getAllBridges, buildWasm,
    } = crossbind;
    await buildDependencies({ targetParams: { ...targetParams, buildType: [target.buildType] } });
    const force = isSourceNewer(target);
    const sourceBuilt = createLib(target, 'Source', { force, buildSource: true });
    const bridgeBuilt = createLib(target, 'Bridge', {
        force,
        buildSource: false,
        nativeGlob: [`${state.config.paths.cli}/assets/cpp-runtime/commonBridges.cpp`, ...getAllBridges()],
    });
    // A rebuilt lib must force the final link, or the wasm keeps the stale registrations.
    await buildWasm(target, { force: force || Boolean(sourceBuilt) || Boolean(bridgeBuilt) });
}

module.exports = {
    WEB_FILES, getWebTargets, requireWebTargets, buildWebGlue,
};
