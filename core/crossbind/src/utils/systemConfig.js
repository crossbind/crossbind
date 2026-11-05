import os from 'node:os';
import loadJson from './loadJson.js';
import systemKeys from './systemKeys.js';
import writeJson from './writeJson.js';

export const systemConfigPath = () => `${os.homedir()}/.crossbind.json`;

export default function loadSystemConfig() {
    const system = loadJson(systemConfigPath()) || {};
    const defaults = Object.entries(systemKeys)
        .filter(([key]) => !(key in system))
        .map(([key, value]) => [key, value.default]);
    return { ...system, ...Object.fromEntries(defaults) };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The settings of an extension's own, which ~/.crossbind.json keeps apart from crossbind's, under extensions by the
// extension's name.
export function extensionSettingsOf(system, name) {
    const own = system.extensions === undefined ? {} : isObject(system.extensions) && (system.extensions[name] ?? {});
    if (!isObject(own)) throw new Error(`crossbind: ${systemConfigPath()} keeps the settings of the extension ${name} as no object of them, under extensions: fix it.`);
    return own;
}

// Sets keys of ~/.crossbind.json, as `crossbind config set` does, keeping the others, and with { name, values } settings
// of that extension's own.
export function updateSystemConfig(values, extension = null) {
    const system = loadSystemConfig();
    const own = extension && { extensions: { ...system.extensions, [extension.name]: { ...extensionSettingsOf(system, extension.name), ...extension.values } } };
    writeJson(systemConfigPath(), { ...system, ...values, ...own });
}
