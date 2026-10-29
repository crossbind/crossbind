import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';

const state = { config: { general: { name: 'demo' }, app: {}, target: {} }, targets: [] };
vi.mock('../src/state/index.js', () => ({ default: state }));
// The emulator a dev session runs an Android app on.
vi.mock('../src/actions/androidDevice.js', () => ({ attachedDevice: () => ({ serial: 'emulator-5554', abi: 'x86_64' }) }));
// tar, which archives a Linux app.
const spawnSync = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));
vi.mock('node:child_process', async (importOriginal) => ({ ...await importOriginal(), spawnSync }));
// The windows image, which zips a Windows app, and runs the makensis that writes its setup program.
const run = vi.fn();
vi.mock('../src/actions/run.js', () => ({ default: run }));
const inWindowsImage = vi.fn();
const signWindows = vi.fn();
vi.mock('../src/actions/windowsSigning.js', async (importOriginal) => ({ ...await importOriginal(), inWindowsImage, signWindows }));

const { appLayout, appOutputName, appTargetParams, publishApp } = await import('../src/actions/buildApp.js');

describe('an app on disk', () => {
    test('keeps its executable and its files in a bundle on macOS, and in a directory on Linux and Windows', () => {
        expect(appLayout({ platform: 'darwin', arch: 'arm64' })).toEqual({ executable: 'Contents/MacOS/demo', resources: 'Contents/Resources' });
        expect(appLayout({ platform: 'linux', arch: 'x64' })).toEqual({ executable: 'demo', resources: 'resources' });
        expect(appLayout({ platform: 'win32', arch: 'x64' })).toEqual({ executable: 'demo.exe', resources: 'resources' });
    });

    test('keeps an iOS app\'s files in the app folder of its Xcode project, which links the executable', () => {
        expect(appLayout({ platform: 'ios', arch: 'iphonesimulator' })).toEqual({ executable: null, resources: 'app' });
    });

    test('keeps an Android app\'s files in the assets of its Gradle project', () => {
        expect(appLayout({ platform: 'android', arch: 'x86_64' })).toEqual({ executable: null, resources: 'app/src/main/assets/app' });
    });

    test('is named beside the page as a bundle, a directory after its platform and arch, or one Xcode or Gradle project', () => {
        expect(appOutputName({ platform: 'darwin', arch: 'arm64' })).toBe('demo.app');
        expect(appOutputName({ platform: 'linux', arch: 'x64' })).toBe('demo-linux-x64');
        expect(appOutputName({ platform: 'win32', arch: 'arm64' })).toBe('demo-win32-arm64');
        expect(appOutputName({ platform: 'ios', arch: 'iphoneos' })).toBe('demo-ios');
        expect(appOutputName({ platform: 'ios', arch: 'iphonesimulator' })).toBe('demo-ios');
        expect(appOutputName({ platform: 'android', arch: 'arm64-v8a' })).toBe('demo-android');
        expect(appOutputName({ platform: 'android', arch: 'x86_64' })).toBe('demo-android');
    });
});

describe('the app a bundler builds', () => {
    test('is this machine\'s desktop app without CROSSBIND_APP_PLATFORM', () => {
        expect(appTargetParams({}, {})).toMatchObject({ platform: [process.platform], arch: [process.arch], runtimeEnv: ['app'] });
    });

    test('refuses a platform no app builds for', () => {
        expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'tvos' })).toThrow('CROSSBIND_APP_PLATFORM=tvos');
    });

    test.runIf(process.platform === 'darwin')('is an iOS app for both SDKs, or during development for the Simulator, or for devices where CROSSBIND_APP_DEVICE names one', () => {
        expect(appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'ios' })).toMatchObject({ platform: ['ios'], arch: ['iphoneos', 'iphonesimulator'] });
        expect(appTargetParams({ dev: true }, { CROSSBIND_APP_PLATFORM: 'ios' })).toMatchObject({ arch: ['iphonesimulator'] });
        expect(appTargetParams({ dev: true }, { CROSSBIND_APP_PLATFORM: 'ios', CROSSBIND_APP_DEVICE: "Ada's iPhone" })).toMatchObject({ arch: ['iphoneos'] });
    });

    test('is an Android app for both ABIs, or for the attached device\'s alone during development', () => {
        expect(appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'android' })).toMatchObject({ platform: ['android'], arch: ['arm64-v8a', 'x86_64'] });
        expect(appTargetParams({ dev: true }, { CROSSBIND_APP_PLATFORM: 'android' })).toMatchObject({ arch: ['x86_64'] });
    });

    test.runIf(process.platform !== 'darwin')('is no iOS app off macOS', () => {
        expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'ios' })).toThrow('iOS apps build on macOS');
    });

    test('is a Linux app for both arches, which builds in Docker on any machine', () => {
        expect(appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'linux' })).toMatchObject({ platform: ['linux'], arch: ['x64', 'arm64'] });
    });

    test.runIf(process.platform !== 'linux')('opens no Linux app for development off Linux', () => {
        expect(() => appTargetParams({ dev: true }, { CROSSBIND_APP_PLATFORM: 'linux' })).toThrow('a Linux app runs on Linux');
    });

    test('is a Windows app for both arches, which builds in Docker on any machine', () => {
        expect(appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'windows' })).toMatchObject({ platform: ['win32'], arch: ['x64', 'arm64'] });
    });

    test.runIf(process.platform !== 'win32')('opens no Windows app for development off Windows', () => {
        expect(() => appTargetParams({ dev: true }, { CROSSBIND_APP_PLATFORM: 'windows' })).toThrow('a Windows app runs on Windows');
    });

    test.runIf(process.platform === 'darwin')("is this Mac's app for macOS", () => {
        expect(appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'macos' })).toMatchObject({ platform: ['darwin'], arch: [process.arch] });
    });

    test.runIf(process.platform !== 'darwin')('is no macOS app off macOS', () => {
        expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'macos' })).toThrow('macOS apps build on macOS');
    });

    test("is no Android, Linux or Windows app under a runner without crossbind's images, before any step runs", () => {
        state.config.system = { RUNNER: 'LOCAL' };
        try {
            expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'android' }))
                .toThrow("an Android app builds in crossbind's android-app image, which RUNNER=LOCAL does not use");
            expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'linux' }))
                .toThrow("a Linux app builds in crossbind's linux image, which RUNNER=LOCAL does not use");
            expect(() => appTargetParams({}, { CROSSBIND_APP_PLATFORM: 'windows' }))
                .toThrow("a Windows app builds in crossbind's windows image, which RUNNER=LOCAL does not use");
        } finally {
            delete state.config.system;
        }
    });
});

describe("a desktop app's page", () => {
    test('is the bundle beside the app, without the apps built there and the files that package them', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const dist = path.join(root, 'dist');
        const arm64 = { platform: 'linux', arch: 'arm64', runtimeEnv: 'app', appName: 'demo.linux-arm64' };
        state.config.paths = { base: root, build: path.join(root, 'build') };
        state.targets = [
            arm64, { platform: 'linux', arch: 'x64', runtimeEnv: 'app' }, { platform: 'android', arch: 'x86_64', runtimeEnv: 'app' },
            { platform: 'win32', arch: 'x64', runtimeEnv: 'app' }, { platform: 'darwin', arch: 'arm64', runtimeEnv: 'app' },
        ];
        fs.mkdirSync(path.join(root, 'build', arm64.appName, 'resources'), { recursive: true });
        ['index.html', 'crossbind.js', 'assets/index.js', 'demo-linux-x64/demo', 'demo-linux-x64.tar.gz', 'demo-linux-x64.deb', 'demo-android.apk',
            'demo-android.aab', 'demo-win32-x64.zip', 'demo-win32-x64-setup.exe', 'demo.dmg'].forEach((file) => {
            fs.mkdirSync(path.dirname(path.join(dist, file)), { recursive: true });
            fs.writeFileSync(path.join(dist, file), file);
        });
        try {
            publishApp(arm64, { to: path.join(dist, 'demo-linux-arm64'), page: dist });
            // An app given a name of its own leaves itself out too.
            publishApp(arm64, { to: path.join(dist, 'renamed'), page: dist });

            ['demo-linux-arm64', 'renamed'].forEach((app) => {
                expect(fs.readdirSync(path.join(dist, app, 'resources', 'page')).sort()).toEqual(['assets', 'crossbind.js', 'index.html']);
            });
            expect(spawnSync).toHaveBeenCalledWith('tar', expect.arrayContaining([`${path.join(dist, 'demo-linux-arm64')}.tar.gz`]), expect.anything());
            expect(run).toHaveBeenCalledWith(null, expect.arrayContaining(['dpkg-deb', `${path.join(dist, 'demo-linux-arm64')}.deb`]), null, arm64);
        } finally {
            state.targets = [];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('is in a Windows app, which ships as a zip made beside it in the windows image', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const dist = path.join(root, 'dist');
        const x64 = { platform: 'win32', arch: 'x64', runtimeEnv: 'app', appName: 'demo.win32-x64' };
        state.config.paths = { base: root, build: path.join(root, 'build') };
        state.targets = [x64];
        fs.mkdirSync(path.join(root, 'build', x64.appName, 'resources'), { recursive: true });
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(dist, 'index.html'), 'index.html');
        try {
            publishApp(x64, { to: path.join(dist, 'demo-win32-x64'), page: dist });

            expect(fs.readdirSync(path.join(dist, 'demo-win32-x64', 'resources', 'page'))).toEqual(['index.html']);
            expect(run).toHaveBeenCalledWith(null, ['zip', '-q', '-r', '-X', 'demo-win32-x64.zip', 'demo-win32-x64'], null, x64, { workdir: dist });
            expect(inWindowsImage).toHaveBeenCalledWith(expect.arrayContaining(['makensis', `-DOUTFILE=${path.join(dist, 'demo-win32-x64')}-setup.exe`]), dist, null);
        } finally {
            state.targets = [];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('is in a Windows app signed before its zip and its signed setup program are made, with a key in the environment', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const dist = path.join(root, 'dist');
        const x64 = { platform: 'win32', arch: 'x64', runtimeEnv: 'app', appName: 'demo.win32-x64' };
        state.config.paths = { base: root, build: path.join(root, 'build') };
        state.targets = [x64];
        fs.mkdirSync(path.join(root, 'build', x64.appName), { recursive: true });
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(root, 'key.p12'), 'key');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_STORETYPE', 'PKCS12');
        vi.stubEnv('CROSSBIND_WINDOWS_SIGNING_KEYSTORE', path.join(root, 'key.p12'));
        try {
            publishApp(x64, { to: path.join(dist, 'demo-win32-x64'), page: dist });

            const app = path.join(dist, 'demo-win32-x64');
            const signedAt = signWindows.mock.calls.findLastIndex(([files]) => files.join() === `${app}/demo.exe`);
            const setupAt = inWindowsImage.mock.calls.findLastIndex(([command]) => command[0] === 'makensis');
            const zippedAt = run.mock.calls.findLastIndex(([, args]) => args[0] === 'zip');
            const order = [signWindows.mock.invocationCallOrder[signedAt], run.mock.invocationCallOrder[zippedAt], inWindowsImage.mock.invocationCallOrder[setupAt]];
            expect(order.every(Number.isInteger)).toBe(true);
            expect(order).toEqual(order.toSorted((a, b) => a - b));
            expect(inWindowsImage.mock.calls[setupAt][0].some((param) => /^-DSIGNER=.*jsign\.sh$/.test(param))).toBe(true);
        } finally {
            vi.unstubAllEnvs();
            state.targets = [];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('is in a Windows app the build says SmartScreen warns of, without a key', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const dist = path.join(root, 'dist');
        const x64 = { platform: 'win32', arch: 'x64', runtimeEnv: 'app', appName: 'demo.win32-x64' };
        state.config.paths = { base: root, build: path.join(root, 'build') };
        state.targets = [x64];
        fs.mkdirSync(path.join(root, 'build', x64.appName), { recursive: true });
        fs.mkdirSync(dist, { recursive: true });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            publishApp(x64, { to: path.join(dist, 'demo-win32-x64'), page: dist });

            expect(warn).toHaveBeenCalledWith(expect.stringContaining('demo-win32-x64 is not signed, so SmartScreen warns of it and of its setup program'));
        } finally {
            warn.mockRestore();
            state.targets = [];
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test("is refused for a Windows app outside the project's base, which is all the windows image sees", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const base = path.join(root, 'project');
        const elsewhere = path.join(root, 'elsewhere', 'demo-win32-x64');
        const x64 = { platform: 'win32', arch: 'x64', runtimeEnv: 'app', appName: 'demo.win32-x64' };
        state.config.paths = { base, build: path.join(base, 'build') };
        fs.mkdirSync(path.join(base, 'build', x64.appName), { recursive: true });
        try {
            expect(() => publishApp(x64, { to: elsewhere })).toThrow(`the Windows app ${elsewhere} is outside ${base}`);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

// A macOS app builds on a Mac alone, and its disk image links to /Applications, which Windows writes its own way.
describe.skipIf(process.platform === 'win32')("a macOS app's signature", () => {
    const DEVELOPER_ID = 'Developer ID Application: Ada Lovelace (ABCDE12345)';
    const HASH = '89ABCDEF0123456789ABCDEF0123456789ABCDEF';
    const arm64 = { platform: 'darwin', arch: 'arm64', runtimeEnv: 'app', appName: 'demo.darwin-arm64' };
    // When the last call of a mock that matches came, among the calls of every mock.
    const when = (mock, match) => mock.mock.invocationCallOrder[mock.mock.calls.findLastIndex(match)];

    // A macOS app built beside its page, published with it.
    function publish() {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-'));
        const dist = path.join(root, 'dist');
        state.config.paths = { base: root, build: path.join(root, 'build') };
        state.targets = [arm64];
        fs.mkdirSync(path.join(root, 'build', arm64.appName, 'Contents/Frameworks/hermesvm.framework'), { recursive: true });
        fs.mkdirSync(dist, { recursive: true });
        fs.writeFileSync(path.join(dist, 'index.html'), 'index.html');
        try {
            publishApp(arm64, { to: path.join(dist, 'demo.app'), page: dist });
        } finally {
            state.targets = [];
            fs.rmSync(root, { recursive: true, force: true });
        }
        return path.join(dist, 'demo.app');
    }

    // The keychain holds the Developer ID, and Apple accepts what it is sent.
    function developerId(env) {
        Object.entries({ CROSSBIND_APPLE_SIGNING_IDENTITY: DEVELOPER_ID, ...env }).forEach(([name, value]) => vi.stubEnv(name, value));
        spawnSync.mockImplementation((command, args) => {
            if (command === 'security') return { status: 0, stdout: `  1) ${HASH} "${DEVELOPER_ID}"\n`, stderr: '' };
            if (args[1] === 'submit') return { status: 0, stdout: JSON.stringify({ id: 'submission-id', status: 'Accepted' }), stderr: '' };
            return { status: 0, stdout: '', stderr: '' };
        });
    }

    let warn;
    let log;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
        log.mockRestore();
        vi.unstubAllEnvs();
        spawnSync.mockImplementation(() => ({ status: 0, stdout: '', stderr: '' }));
    });

    test('is ad hoc without a Developer ID, which the build says opens the app on this Mac alone', () => {
        const app = publish();

        expect(run).toHaveBeenCalledWith(null, ['codesign', '--force', '--sign', '-', '--timestamp=none', app], null, arm64);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('demo.app is signed ad hoc, which opens it on this Mac alone'));
    });

    test('is the Developer ID\'s without a key, which the build says another Mac opens only once its user allows it', () => {
        developerId({});

        const app = publish();

        expect(run).toHaveBeenCalledWith(null, ['codesign', '--force', '--sign', HASH, '--options', 'runtime', '--timestamp', app], null, arm64);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('demo.app is signed with your Developer ID but not notarized'));
        expect(spawnSync.mock.calls.some(([command]) => command === 'ditto')).toBe(false);
    });

    test('claims the devices of app.permissions, which the hardened runtime keeps the app from otherwise', () => {
        developerId({});
        state.config.app = { permissions: { camera: 'To scan barcodes', location: 'To find the nearest store' } };
        let entitlements = '';
        run.mockImplementation((_, args) => {
            const at = args.indexOf('--entitlements');
            if (at > 0) entitlements = fs.readFileSync(args[at + 1], 'utf8');
        });
        try {
            const app = publish();

            const sign = ['--sign', HASH, '--options', 'runtime', '--timestamp'];
            expect(run).toHaveBeenCalledWith(null, ['codesign', '--force', ...sign, '--entitlements', expect.stringMatching(/demo\.app\.entitlements$/), app], null, arm64);
            expect(run).toHaveBeenCalledWith(null, ['codesign', '--force', ...sign, `${app}/Contents/Frameworks/hermesvm.framework`], null, arm64);
            expect(entitlements).toContain('<key>com.apple.security.device.camera</key>\n    <true/>');
            expect(entitlements).toContain('<key>com.apple.security.personal-information.location</key>\n    <true/>');
            expect(entitlements).not.toContain('audio-input');
        } finally {
            state.config.app = {};
            run.mockImplementation(() => undefined);
        }
    });

    test("is the Developer ID's, in the hardened runtime, then Apple's ticket, before the unsigned disk image is made of it", () => {
        const key = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-key-')), 'AuthKey.p8');
        fs.writeFileSync(key, 'key');
        developerId({ CROSSBIND_APPLE_API_KEY: key, CROSSBIND_APPLE_API_KEY_ID: 'ABC123', CROSSBIND_APPLE_API_ISSUER: 'issuer-uuid' });
        try {
            const app = publish();

            const sign = ['--sign', HASH, '--options', 'runtime', '--timestamp'];
            const framework = when(run, ([, args]) => args.join(' ') === ['codesign', '--force', ...sign, `${app}/Contents/Frameworks/hermesvm.framework`].join(' '));
            const signed = when(run, ([, args]) => args.join(' ') === ['codesign', '--force', ...sign, app].join(' '));
            const zipped = when(spawnSync, ([command, args]) => command === 'ditto' && args.includes(app));
            const stapled = when(spawnSync, ([, args]) => args.join(' ') === `stapler staple ${app}`);
            const imaged = when(run, ([, args]) => args[0] === 'hdiutil' && args.at(-1) === app.replace(/\.app$/, '.dmg'));
            expect([framework, signed, zipped, stapled, imaged].every(Number.isInteger)).toBe(true);
            expect([framework, signed, zipped, stapled, imaged]).toEqual([framework, signed, zipped, stapled, imaged].toSorted((a, b) => a - b));
            expect(run.mock.calls.some(([, args]) => args[0] === 'codesign' && args.at(-1).endsWith('.dmg'))).toBe(false);
            expect(warn).not.toHaveBeenCalled();
        } finally {
            fs.rmSync(path.dirname(key), { recursive: true, force: true });
        }
    });
});
