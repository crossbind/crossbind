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

// Sets keys of ~/.crossbind.json, as `crossbind config set` does, keeping the others.
export function updateSystemConfig(values) {
    writeJson(systemConfigPath(), { ...loadSystemConfig(), ...values });
}
