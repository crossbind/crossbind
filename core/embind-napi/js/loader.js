// Entry of the per-project loader crossbind bundles next to the native addons
// (dist/<name>.native.cjs). It keeps the wasm build's initNative() contract, so the same app code
// runs on either build.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import Module, { crossbindScope } from '@crossbind/core-embind-jsi';
import systemConfig from 'crossbind/systemConfig';
import addonPlatform from './addonPlatform.js';
import addonLocation from './addonLocation.js';
import stopOnExit from './stopOnExit.js';

const platform = addonPlatform();
const fill = (pattern) => pattern.replace('{platform}', platform).replace('{arch}', process.arch);
const addonPackage = systemConfig.paths.addonPackage ? fill(systemConfig.paths.addonPackage) : null;

function addonFile(config) {
    return config.addonPath ?? addonLocation({
        dir: __dirname,
        fileName: fill(systemConfig.paths.addon),
        packageName: addonPackage,
        exists: fs.existsSync,
        resolve: createRequire(__filename).resolve,
    });
}

function missingAddonRemedy() {
    return addonPackage
        ? `install ${addonPackage}, which npm leaves out with --omit=optional; addons exist for ${Object.keys(systemConfig.env).join(', ')}`
        : `build it with \`crossbind build -p ${platform} -a ${process.arch}\``;
}

function loadAddon(file) {
    const addon = { exports: {} };
    try {
        process.dlopen(addon, file);
    } catch (error) {
        throw new Error(`crossbind: cannot load ${file} - ${fs.existsSync(file) ? error.message : missingAddonRemedy()}.`, { cause: error });
    }
    return addon.exports;
}

function setEnv(dataPath, runtimeEnv = {}) {
    const fillDataPath = (value) => String(value).replace('_CROSSBIND_DATA_PATH_', dataPath);
    // Build-time values are keyed by addon: a target-scoped value must not leak from one arch's
    // build into another's. They never replace a variable the process already has; values passed to
    // initNative() do, as in the wasm runtime, even after a package entry booted the addon.
    Object.entries(systemConfig.env[`${platform}-${process.arch}`] ?? {}).forEach(([key, value]) => {
        Module.Crossbind.setEnv(key, fillDataPath(value), false);
    });
    Object.entries(runtimeEnv).forEach(([key, value]) => {
        Module.Crossbind.setEnv(key, fillDataPath(value), true);
    });
}

let addon = null;
let addonDataPath = null;

function boot(config) {
    // Loaded and started once per process: Node cannot unload an addon, and a second dlopen gets a
    // fresh environment whose start() would register every binding twice.
    if (!addon) {
        addonDataPath = config.dataPath ?? path.join(__dirname, 'data');
        const loaded = loadAddon(addonFile(config));
        // The embind runtime this bundle carries keeps its state on crossbindScope (crossbind's utils/scopedEmbind.js).
        loaded.start(addonDataPath, crossbindScope);
        // Native values released after this (thread-local ones die inside exit()) must not call
        // back into the runtime.
        stopOnExit(() => loaded.stop());
        addon = loaded;
    } else if (config.dataPath && config.dataPath !== addonDataPath) {
        throw new Error(`crossbind: the addon started with its data at ${addonDataPath}; a process cannot move it to ${config.dataPath}.`);
    }
    setEnv(addonDataPath, config.env);
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

// Loading an addon is synchronous, so a package entry boots it on require.
initNative.sync = function sync(config = {}) {
    return boot(config);
};

// The wasm runtime's contract: forget the booted module so the next call boots again. Native state
// cannot be reset (Node cannot unload an addon), so that call resolves the same module.
initNative.terminate = function terminate() {
    booted = null;
};
