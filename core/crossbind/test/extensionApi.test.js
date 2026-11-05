import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PNG } from 'pngjs';

const state = { config: {}, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));
// ~/.crossbind.json, as this machine keeps it.
const saved = {};
vi.mock('../src/utils/systemConfig.js', () => ({ default: () => ({ ...saved }), updateSystemConfig: (values) => Object.assign(saved, values) }));
// The system keychain, which keeps each secret by its service and key.
const keychain = new Map();
vi.mock('../src/utils/keychain.js', () => ({
    readSecret: (key, { service }) => keychain.get(`${service}: ${key}`) ?? null,
    storeSecret: (key, secret, { service }) => Boolean(keychain.set(`${service}: ${key}`, secret)),
}));
// The user at the terminal, if there is one, answering these yeses and nos.
const terminal = {};
vi.mock('../src/utils/ask.js', () => ({
    hasTerminal: () => terminal.isThere,
    askLine: async (question) => {
        terminal.asked.push(question);
        return terminal.lines.shift() ?? '';
    },
    askYesNo: async (question) => {
        terminal.asked.push(question);
        return terminal.yes.shift() ?? true;
    },
}));
const signing = { made: 0 };
vi.mock('../src/actions/uploadKey.js', () => ({
    releaseSigningEnv: async () => ({ env: { CROSSBIND_ANDROID_KEYSTORE: '/keys/upload.p12' }, isSigned: true }),
    makeUploadKey: async () => {
        signing.made += 1;
        saved.ANDROID_KEYSTORE = '/keys/upload.p12';
    },
}));
vi.mock('../src/actions/xcodebuild.js', () => ({ xcodebuild: () => 'built', xcodeTeams: () => [{ id: 'ABCDE12345', name: 'Ada Ltd' }] }));
vi.mock('../src/utils/hermes.js', async (importOriginal) => ({ ...await importOriginal(), resolveHermesDsym: async () => '/hermes/hermesvm.framework.dSYM' }));
// The tools that package an app: here and in the linux image, and in the windows image.
const tools = { run: vi.fn(), inWindowsImage: vi.fn() };
vi.mock('../src/actions/run.js', () => ({ default: (...args) => tools.run(...args) }));
vi.mock('../src/actions/windowsSigning.js', async (importOriginal) => ({ ...await importOriginal(), inWindowsImage: (...args) => tools.inWindowsImage(...args) }));

const { default: extensionApi } = await import('../src/actions/extensionApi.js');

let base;
let home;
const config = () => fs.readFileSync(path.join(base, 'crossbind.config.js'), 'utf8');

beforeEach(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extension-api-'));
    fs.writeFileSync(path.join(base, 'crossbind.config.js'), "export default {\n    general: { name: 'demo' },\n};\n");
    state.config = {
        general: { name: 'demo' },
        app: {},
        package: { version: '1.2.3-beta.1', name: 'demo' },
        paths: { base, project: base, build: path.join(base, '.crossbind', 'build') },
        system: {},
    };
    tools.run.mockReset();
    tools.inWindowsImage.mockReset();
    Object.keys(saved).forEach((key) => delete saved[key]);
    keychain.clear();
    Object.assign(terminal, {
        isThere: true, asked: [], lines: [], yes: [],
    });
    signing.made = 0;
    home = vi.spyOn(os, 'homedir').mockReturnValue(base);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubEnv('CROSSBIND_APP_BUILD_NUMBER', '');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    home.mockRestore();
    fs.rmSync(base, { recursive: true, force: true });
});

describe("an extension's api", () => {
    test('is the run it is made for, frozen: its name, platform, terminal and options', () => {
        const api = extensionApi('demo-store', { platform: 'android', options: { track: 'beta' }, isGuided: true });
        expect(api).toMatchObject({
            name: 'demo-store', platform: 'android', isGuided: true, options: { track: 'beta' },
        });
        expect(Object.isFrozen(api)).toBe(true);
        expect(Object.isFrozen(api.options)).toBe(true);
        expect(api.project).toMatchObject({ root: base, name: 'demo', package: { version: '1.2.3-beta.1' } });
        expect(api.workDir).toBe(path.join(base, '.crossbind', 'build', 'demo-store'));
    });

    test("gives the app's facts as the build of its platform reads them, with the run's build number once it has one", () => {
        const run = {};
        const android = extensionApi('demo-store', { platform: 'android', run });
        const ios = extensionApi('demo-store', { platform: 'ios', run });
        expect(android.app).toMatchObject({
            id: 'dev.crossbind.demo', name: 'demo', version: '1.2.3-beta.1', appleVersion: '1.2.3', versionCode: 1002003, buildNumber: null, encryption: null, updater: null,
        });
        state.config.app = { id: 'com.example.demo', name: 'Demo' };
        expect([android.app.id, ios.app.id, ios.app.name]).toEqual(['com.example.demo', 'com.example.demo', 'Demo']);
        run.buildNumber = 42;
        expect([android.app.buildNumber, android.app.versionCode]).toEqual([42, 42]);
    });

    test('reads the config, which it cannot change but through write', () => {
        const api = extensionApi('demo-store', { platform: 'ios' });
        state.config.app = { privacy: { fileTimestamp: ['C617.1'] } };
        expect(api.config.app.privacy.fileTimestamp).toEqual(['C617.1']);
        expect(() => {
            api.config.app.id = 'x';
        }).toThrow('crossbind: api.config is read-only: api.config.write writes an option into crossbind.config.js.');
        expect(() => api.config.app.privacy.fileTimestamp.push('3B52.1')).toThrow(TypeError);
        expect(() => Object.freeze(api.config.app)).toThrow(TypeError);
        expect(() => {
            Object.getOwnPropertyDescriptor(api.config.app, 'privacy').value.fileTimestamp = [];
        }).toThrow(TypeError);
        expect(Object.isExtensible(state.config.app)).toBe(true);
        expect(state.config.app).toEqual({ privacy: { fileTimestamp: ['C617.1'] } });
    });

    test("writes an option into crossbind.config.js once the user says yes, and into the run's config", async () => {
        const api = extensionApi('demo-store', { platform: 'ios' });
        await api.config.write('app.id', 'com.example.demo');
        expect(terminal.asked).toEqual(["Write app.id: 'com.example.demo' into crossbind.config.js? [Y/n] "]);
        expect(config()).toContain("app: {\n        id: 'com.example.demo',\n    },");
        expect(api.config.app.id).toBe('com.example.demo');
        await api.config.write('app.privacy', { fileTimestamp: ['C617.1'] });
        expect(state.config.app).toEqual({ id: 'com.example.demo', privacy: { fileTimestamp: ['C617.1'] } });
    });

    test("refuses an option the config sets, the user's no, a config it cannot write into, and any write without a terminal", async () => {
        const api = extensionApi('demo-store', { platform: 'ios' });
        state.config.app = { id: 'com.example.old' };
        await expect(api.config.write('app.id', 'com.example.demo')).rejects.toThrow("crossbind: set app.id: 'com.example.demo' in crossbind.config.js in place of the app.id there.");
        state.config.app = {};
        terminal.yes = [false];
        await expect(api.config.write('app.id', 'com.example.demo')).rejects.toThrow("crossbind: set app.id: 'com.example.demo' in crossbind.config.js.");
        fs.writeFileSync(path.join(base, 'crossbind.config.js'), 'export default makeConfig();\n');
        await expect(api.config.write('app.id', 'com.example.demo')).rejects.toThrow("crossbind: crossbind.config.js is no config crossbind can write app.id into safely: set app.id: 'com.example.demo' in it yourself.");
        terminal.isThere = false;
        await expect(api.config.write('app.id', 'com.example.demo')).rejects.toThrow("crossbind: demo-store would write app.id: 'com.example.demo' into crossbind.config.js, which takes a yes on a terminal: set it there yourself.");
        await expect(api.config.write('app..id', 'x')).rejects.toThrow('crossbind: demo-store names "app..id", which is no option of crossbind.config.js');
        await expect(api.config.write('app.window', { width: Number.NaN })).rejects.toThrow('a value that is no JSON value');
        expect(state.config.app).toEqual({});
    });

    test('refuses as invalid a value the build would refuse, for the caller to ask again', async () => {
        const api = extensionApi('demo-store', { platform: 'android' });
        const failure = await api.config.write('app.icon', 'missing.png').catch((error) => error);
        expect(failure).toMatchObject({ isInvalid: true, message: `crossbind: app.icon names ${path.join(base, 'missing.png')}, which does not exist.` });
        await expect(api.config.write('app.id', 'com.example.my-app')).rejects.toMatchObject({ isInvalid: true });
        expect(terminal.asked).toEqual([]);
    });

    test("keeps this machine's settings in ~/.crossbind.json, and its secrets in the keychain under the extension's name", () => {
        const api = extensionApi('demo-store', { platform: 'ios' });
        api.settings.set({ DEMO_STORE_ACCOUNT: 'ada' });
        expect(saved).toEqual({ DEMO_STORE_ACCOUNT: 'ada' });
        expect(api.settings.get('DEMO_STORE_ACCOUNT')).toBe('ada');
        expect(() => api.settings.set({ account: 'ada' })).toThrow("crossbind: demo-store sets settings that are no object of this machine's settings");

        expect(api.secrets.get('sign-in')).toBeNull();
        expect(api.secrets.set('sign-in', 'refresh')).toBe(true);
        expect([...keychain.keys()]).toEqual([`crossbind demo-store: ${path.join(base, '.crossbind', 'secrets', 'demo-store', 'sign-in')}`]);
        expect(api.secrets.get('sign-in')).toBe('refresh');
        expect(() => api.secrets.get('../other')).toThrow('crossbind: demo-store names the secret "../other", which is no name of letters, digits, dots, dashes and underscores.');
    });

    test('asks nothing without a terminal', () => {
        terminal.isThere = false;
        const api = extensionApi('demo-store', { platform: 'ios' });
        expect(() => api.ask('Track? ')).toThrow('crossbind: demo-store asks "Track?", with no terminal to answer it.');
        expect(() => api.askYesNo('Go? [Y/n] ')).toThrow('crossbind: demo-store asks "Go? [Y/n]", with no terminal to answer it.');
    });

    test("gives the signing and the tools crossbind builds each platform's apps with", async () => {
        const api = extensionApi('demo-store', { platform: 'ios' });
        expect(await api.android.signing()).toEqual({ env: { CROSSBIND_ANDROID_KEYSTORE: '/keys/upload.p12' }, isSigned: true });
        await api.android.makeUploadKey();
        expect([signing.made, api.settings.get('ANDROID_KEYSTORE')]).toEqual([1, '/keys/upload.p12']);
        expect(api.apple.key()).toBeNull();
        expect(api.apple.teams()).toEqual([{ id: 'ABCDE12345', name: 'Ada Ltd' }]);
        expect(await api.apple.dsyms()).toEqual(['/hermes/hermesvm.framework.dSYM']);
        expect(api.apple.privacyCategories.fileTimestamp.reasons).toContain('C617.1');
        expect(Object.isFrozen(api.apple.privacyCategories.fileTimestamp.reasons)).toBe(true);
    });

    test("runs an installer's tools where crossbind packages its app's platform, in a folder under the project's base", () => {
        const linux = { platform: 'linux', arch: 'x64' };
        const api = extensionApi('demo-installer', { platform: 'linux', target: linux });
        fs.mkdirSync(path.join(base, 'dist'));

        api.run(['dpkg-deb', '--version'], { cwd: path.join(base, 'dist') });
        api.run(['dpkg-deb', '--help'], { cwd: 'dist' });
        const macos = { platform: 'darwin', arch: 'arm64' };
        extensionApi('demo-installer', { platform: 'macos', target: macos }).run(['hdiutil', 'help'], null);
        const windows = extensionApi('demo-installer', { platform: 'windows', target: { platform: 'win32', arch: 'x64' } });
        fs.writeFileSync(path.join(base, 'key.p12'), 'key');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'PKCS12');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_KEYSTORE', path.join(base, 'key.p12'));
        windows.run(['zip', '-v']);
        windows.run(['makensis', '-VERSION'], { isSigning: true });

        expect(tools.run.mock.calls).toEqual([
            [null, ['dpkg-deb', '--version'], null, linux, { workdir: path.join(base, 'dist') }],
            [null, ['dpkg-deb', '--help'], null, linux, { workdir: path.join(base, 'dist') }],
            [null, ['hdiutil', 'help'], null, macos, { workdir: base }],
        ]);
        // The key goes to a tool that signs alone.
        expect(tools.inWindowsImage.mock.calls).toEqual([
            [['zip', '-v'], base, null],
            [['makensis', '-VERSION'], base, { names: ['CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'CROSSBIND_WINDOWS_SIGNING_KEYSTORE'], files: { keystore: path.join(base, 'key.p12') } }],
        ]);
        expect(() => api.run(['dpkg-deb'], { cwd: 42 })).toThrow('crossbind: demo-installer runs dpkg-deb in 42, which is no path of a folder.');
        expect(() => api.run(['dpkg-deb'], { cwd: os.tmpdir() }))
            .toThrow(`crossbind: demo-installer runs dpkg-deb in ${path.resolve(os.tmpdir())}, outside ${base}, the project's base and all the linux container sees.`);
        expect(() => api.run(['dpkg-deb'], { cwd: path.join(base, 'missing') })).toThrow(`crossbind: demo-installer runs dpkg-deb in ${path.join(base, 'missing')}, which is no folder.`);
        expect(() => api.run('dpkg-deb --version')).toThrow('crossbind: demo-installer runs no command with api.run, which takes a list of strings: the program and its arguments.');
        expect(() => extensionApi('demo-store', { platform: 'ios' }).run(['xcrun'])).toThrow("crossbind: demo-store runs a tool with api.run, which an installer's api alone has.");
        expect(tools.run).toHaveBeenCalledTimes(3);
    });

    test("gives the app's link schemes and menu categories, and a Windows app's icon and the script that signs with its key", () => {
        const api = extensionApi('demo-installer', { platform: 'linux' });
        state.config.app = { urlSchemes: ['demo'], category: 'music' };
        expect(api.app.urlSchemes).toEqual(['demo']);
        expect(Object.isFrozen(api.app.urlSchemes)).toBe(true);
        expect(api.app.category).toEqual({ macos: 'public.app-category.music', linux: 'Audio;AudioVideo' });
        expect([api.windows.icon(), api.windows.signer]).toEqual([null, null]);

        state.config.app = { icon: 'icon.png' };
        fs.writeFileSync(path.join(base, 'icon.png'), PNG.sync.write({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }));
        fs.writeFileSync(path.join(base, 'key.p12'), 'key');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'PKCS12');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_KEYSTORE', path.join(base, 'key.p12'));
        expect(api.app.category).toBeNull();
        expect(api.windows.icon().readUInt16LE(2)).toBe(1);
        expect(api.windows.signer).toMatch(/[/\\]windows[/\\]jsign\.sh$/);
    });
});
