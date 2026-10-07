/**
 * Detects which host capabilities are available so the harness can decide,
 * per template, whether to run a step or report it as SKIPPED (instead of
 * failing the whole run on a machine that simply lacks an emulator).
 *
 * Capability keys used by plan.js / runner.js:
 *   docker         - C++ -> Wasm/native builds run inside the crossbind image
 *   playwright     - browsers can be installed (web/cloud e2e)
 *   maestro        - mobile e2e flows (maestro.yaml)
 *   androidDevice  - an Android emulator/device is attached
 *   ios            - macOS + xcrun simctl (iOS simulator can boot)
 *   display        - a window can open (Electron e2e); Linux needs DISPLAY or WAYLAND_DISPLAY
 */

const { commandOk, commandOutput } = require('./exec');

function hasAndroidSdk() {
    return Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT) && commandOk('adb', ['version']);
}

function hasAndroidDevice() {
    if (!commandOk('adb', ['version'])) return false;
    const out = commandOutput('adb', ['devices']);
    // Lines look like "emulator-5554\tdevice"; the header line is "List of devices attached".
    return out
        .split('\n')
        .slice(1)
        .some((line) => /\bdevice\b/.test(line) && !line.includes('offline'));
}

function detectEnv() {
    const platform = process.platform;
    const isDarwin = platform === 'darwin';

    const caps = {
        platform,
        docker: commandOk('docker', ['info']),
        pnpm: commandOk('pnpm', ['--version']),
        npm: commandOk('npm', ['--version']),
        npx: commandOk('npx', ['--version']),
        // Playwright browsers are installed per-project; node+npx is enough to bootstrap them.
        playwright: commandOk('npx', ['--version']),
        maestro: commandOk('maestro', ['--version']),
        cocoapods: isDarwin && commandOk('pod', ['--version']),
        androidSdk: hasAndroidSdk(),
        androidDevice: hasAndroidDevice(),
        ios: isDarwin && commandOk('xcrun', ['simctl', 'help']),
        display: platform !== 'linux' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY),
    };
    return Object.freeze(caps);
}

/** Returns the subset of `required` capability keys that are not available. */
function missingCaps(required, caps) {
    return required.filter((key) => !caps[key]);
}

module.exports = { detectEnv, missingCaps };
