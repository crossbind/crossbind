import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import loadSystemConfig, { extensionSettingsOf, systemConfigPath, updateSystemConfig } from '../src/utils/systemConfig.js';

let home;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-system-config-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
});
afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
});

const written = () => JSON.parse(fs.readFileSync(systemConfigPath(), 'utf8'));

describe("this machine's settings", () => {
    test("keep an extension's own apart under its name, beside crossbind's and every other extension's", () => {
        fs.writeFileSync(systemConfigPath(), JSON.stringify({ RUNNER: 'LOCAL', extensions: { demo: { TOKEN: 'grace' } } }));

        updateSystemConfig({ XCODE_DEVELOPMENT_TEAM: 'ABCDE12345' }, { name: 'demo-store', values: { TOKEN: 'ada' } });
        updateSystemConfig({}, { name: 'demo-store', values: { REGION: 'eu' } });

        expect(written()).toMatchObject({
            RUNNER: 'LOCAL', XCODE_DEVELOPMENT_TEAM: 'ABCDE12345', extensions: { demo: { TOKEN: 'grace' }, 'demo-store': { TOKEN: 'ada', REGION: 'eu' } },
        });
        expect(extensionSettingsOf(loadSystemConfig(), 'demo-store')).toEqual({ TOKEN: 'ada', REGION: 'eu' });
        expect(extensionSettingsOf(loadSystemConfig(), 'other')).toEqual({});
    });

    test("refuse an extension's settings the file keeps as no object of them", () => {
        for (const extensions of ['demo-store', { 'demo-store': 'ada' }, { 'demo-store': ['ada'] }]) {
            fs.writeFileSync(systemConfigPath(), JSON.stringify({ extensions }));
            expect(() => updateSystemConfig({}, { name: 'demo-store', values: { TOKEN: 'ada' } }))
                .toThrow(`crossbind: ${systemConfigPath()} keeps the settings of the extension demo-store as no object of them, under extensions: fix it.`);
        }
    });
});
