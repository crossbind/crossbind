import state from '../state/index.js';
import { getFilteredBuildTargets, getTargetParams } from '../actions/target.js';
import { appTargetParams } from '../actions/buildApp.js';

// The build of a page a browser opens: single-threaded unless crossbind.config.js sets target.runtime to 'mt'.
const WEB = { platform: ['wasm'], arch: ['wasm32'], runtime: ['st'], runtimeEnv: ['browser'] };

function familyOf(params, filter = {}) {
    const release = getFilteredBuildTargets(params, { buildType: 'release', ...filter })?.[0];
    const debug = getFilteredBuildTargets(params, { buildType: 'debug', ...filter })?.[0];
    if (!release && !debug) return null;
    return { params, release: release ?? debug, debug: debug ?? release };
}

export function webTargets() {
    return familyOf(getTargetParams(WEB, true));
}

// An app's page reaches the module in the host the app runs, so its build makes the host, not wasm: this machine's, or
// with CROSSBIND_APP_PLATFORM one per iOS SDK, Android ABI or Linux or Windows arch. iOS and Android keep targets without
// a runtime environment for React Native, which every filter of runtimeEnv lets through.
export function appTargets() {
    const params = appTargetParams();
    const all = getFilteredBuildTargets(params, { buildType: 'release', runtimeEnv: 'app' }) ?? [];
    if (!all[0]) {
        throw new Error(`crossbind: desktop apps build on macOS, Linux and Windows so far, and this machine runs ${process.platform}-${process.arch}.`);
    }
    return { ...familyOf(params, { runtimeEnv: 'app' }), all };
}

export const NO_WEB_TARGET = 'crossbind: crossbind.config.js leaves no wasm32 browser target to build the web app with.';

// React Native's build for iOS or Android, which Xcode and Gradle link.
export const nativeTarget = (platform) => state.targets.find((target) => target.platform === platform);
