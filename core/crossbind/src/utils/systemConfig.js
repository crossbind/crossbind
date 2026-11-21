import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import loadJson from './loadJson.js';
import systemKeys from './systemKeys.js';
import writeJson from './writeJson.js';

export const systemConfigPath = () => `${os.homedir()}/.crossbind/config.json`;

// Earlier releases kept the settings in ~/.crossbind.json, which the first load moves here. Where the home takes no
// move, the run reads the earlier file.
function settingsFile() {
    const file = systemConfigPath();
    const earlier = `${os.homedir()}/.crossbind.json`;
    if (fs.existsSync(file) || !fs.existsSync(earlier)) return file;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.renameSync(earlier, file);
    } catch (error) {
        if (fs.existsSync(file)) return file;
        console.warn(`crossbind: ${earlier} could not move to ${file} (${error.code}), so this run reads it where it is.`);
        return earlier;
    }
    console.warn(`crossbind: moved ${earlier} to ${file}, which keeps this machine's settings now.`);
    return file;
}

export default function loadSystemConfig() {
    const system = loadJson(settingsFile()) || {};
    const defaults = Object.entries(systemKeys)
        .filter(([key]) => !(key in system))
        .map(([key, value]) => [key, value.default]);
    return { ...system, ...Object.fromEntries(defaults) };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The settings of an extension's own, which ~/.crossbind/config.json keeps apart from crossbind's, under extensions by
// the extension's name.
export function extensionSettingsOf(system, name) {
    const own = system.extensions === undefined ? {} : isObject(system.extensions) && (system.extensions[name] ?? {});
    if (!isObject(own)) throw new Error(`crossbind: ${systemConfigPath()} keeps the settings of the extension ${name} as no object of them, under extensions: fix it.`);
    return own;
}

// Sets keys of ~/.crossbind/config.json, as `crossbind config set` does, keeping the others, and with { name, values }
// settings of that extension's own.
export function updateSystemConfig(values, extension = null) {
    const system = loadSystemConfig();
    const own = extension && { extensions: { ...system.extensions, [extension.name]: { ...extensionSettingsOf(system, extension.name), ...extension.values } } };
    writeSystemConfig({ ...system, ...values, ...own });
}

export function writeSystemConfig(system) {
    const file = systemConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeJson(file, system);
}
