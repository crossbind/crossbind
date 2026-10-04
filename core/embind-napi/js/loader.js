// Entry of the per-project loader crossbind bundles next to the native addons
// (dist/<name>.native.cjs). It keeps the wasm build's initNative() contract, so the same app code
// runs on either build.
import path from 'node:path';
import Module, { crossbindScope } from '@crossbind/core-embind-jsi';
import systemConfig from 'crossbind/systemConfig';
import addonPlatform from './addonPlatform.js';
import stopOnExit from './stopOnExit.js';

const platform = addonPlatform();

function addonFileName() {
    return systemConfig.paths.addon.replace('{platform}', platform).replace('{arch}', process.arch);
}

function loadAddon(file) {
    const addon = { exports: {} };
    try {
        process.dlopen(addon, file);
    } catch (error) {
        throw new Error(
            `crossbind: cannot load ${file} - build it with \`crossbind build -p ${platform} -a ${process.arch}\`.`,
            { cause: error },
        );
    }
    return addon.exports;
}

function setEnv(dataPath, runtimeEnv) {
    // Build-time values are keyed by addon: a target-scoped value must not leak from one arch's
    // build into another's. Values passed to initNative() win, as in the wasm runtime.
    const env = { ...systemConfig.env[`${platform}-${process.arch}`], ...runtimeEnv };
    Object.entries(env).forEach(([key, value]) => {
        Module.Crossbind.setEnv(key, String(value).replace('_CROSSBIND_DATA_PATH_', dataPath), false);
    });
}

let addon = null;

function boot(config) {
    const dataPath = config.dataPath ?? path.join(__dirname, 'data');
    // Loaded and started once per process: Node cannot unload an addon, and a second dlopen gets a
    // fresh environment whose start() would register every binding twice.
    if (!addon) {
        const loaded = loadAddon(config.addonPath ?? path.join(__dirname, addonFileName()));
        // The embind runtime this bundle carries keeps its state on crossbindScope (crossbind's utils/scopedEmbind.js).
        loaded.start(dataPath, crossbindScope);
        // Native values released after this (thread-local ones die inside exit()) must not call
        // back into the runtime.
        stopOnExit(() => loaded.stop());
        addon = loaded;
    }
    setEnv(dataPath, config.env);
    return Module;
}

let booted = null;

export default function initNative(config = {}) {
    if (!booted) {
        try {
            booted = Promise.resolve(boot(config));
        } catch (error) {
            // Not remembered: a later call retries, for example once the addon is built.
            return Promise.reject(error);
        }
    }
    return booted;
}

// The wasm runtime's contract: forget the booted module so the next call boots again. Native state
// cannot be reset (Node cannot unload an addon), so that call resolves the same module.
initNative.terminate = function terminate() {
    booted = null;
};
