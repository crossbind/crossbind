import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import loadSystemConfig, { extensionSettingsOf, systemConfigPath, updateSystemConfig } from '../src/utils/systemConfig.js';

let home;
beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-system-config-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(home, { recursive: true, force: true });
});

const written = () => JSON.parse(fs.readFileSync(systemConfigPath(), 'utf8'));
const earlier = () => upath.join(home, '.crossbind.json');
const keep = (file, settings) => {
    fs.mkdirSync(upath.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings));
};

describe("this machine's settings", () => {
    test('are kept in ~/.crossbind/config.json', () => {
        expect(upath.toUnix(systemConfigPath())).toBe(upath.join(home, '.crossbind', 'config.json'));
    });

    test('are moved once from ~/.crossbind.json, where earlier releases kept them, with a word of it', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        keep(earlier(), { RUNNER: 'LOCAL' });

        expect(loadSystemConfig().RUNNER).toBe('LOCAL');
        expect(written()).toEqual({ RUNNER: 'LOCAL' });
        expect(fs.existsSync(earlier())).toBe(false);
        expect(loadSystemConfig().RUNNER).toBe('LOCAL');
        expect(warn.mock.calls.map(([line]) => upath.toUnix(line))).toEqual([
            `crossbind: moved ${earlier()} to ${upath.join(home, '.crossbind', 'config.json')}, which keeps this machine's settings now.`,
        ]);
    });

    test('take the file another crossbind moved first', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        keep(earlier(), { RUNNER: 'LOCAL' });
        const rename = fs.renameSync;
        vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
            rename(from, to);
            throw Object.assign(new Error('ENOENT: no such file or directory, rename'), { code: 'ENOENT' });
        });

        expect(loadSystemConfig().RUNNER).toBe('LOCAL');
        expect(warn).not.toHaveBeenCalled();
    });

    test('are read from ~/.crossbind.json for the run, with a word of it, where the home takes no move', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        keep(earlier(), { RUNNER: 'LOCAL' });
        fs.writeFileSync(upath.join(home, '.crossbind'), 'no folder');

        expect(loadSystemConfig().RUNNER).toBe('LOCAL');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(upath.toUnix(warn.mock.calls[0][0])).toMatch(/^crossbind: .+\/\.crossbind\.json could not move to .+\/\.crossbind\/config\.json \((EEXIST|ENOTDIR)\), so this run reads it where it is\.$/);
    });

    test('come from ~/.crossbind/config.json alone once it is there', () => {
        keep(earlier(), { RUNNER: 'LOCAL' });
        keep(systemConfigPath(), { RUNNER: 'DOCKER_EXEC' });

        expect(loadSystemConfig().RUNNER).toBe('DOCKER_EXEC');
    });

    test('are written on a machine with no ~/.crossbind yet', () => {
        updateSystemConfig({ RUNNER: 'LOCAL' });

        expect(written().RUNNER).toBe('LOCAL');
    });

    test("keep an extension's own apart under its name, beside crossbind's and every other extension's", () => {
        keep(systemConfigPath(), { RUNNER: 'LOCAL', extensions: { demo: { TOKEN: 'grace' } } });

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
            keep(systemConfigPath(), { extensions });
            expect(() => updateSystemConfig({}, { name: 'demo-store', values: { TOKEN: 'ada' } }))
                .toThrow(`crossbind: ${systemConfigPath()} keeps the settings of the extension demo-store as no object of them, under extensions: fix it.`);
        }
    });
});
