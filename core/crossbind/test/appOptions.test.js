import { describe, expect, test } from 'vitest';
import {
    appBackgroundColor, appCategory, appCopyright, appDisplayName, appEncryption, appHeader, appId, appPermissions, appPrivacy, appUpdater,
    appUrlSchemes, appWindow, hostExtensionOptions, urlSchemeOwners, usageDescriptions,
} from '../src/utils/appOptions.js';

const config = (app = {}, version = '1.2.3') => ({ general: { name: 'demo-app' }, app, package: { version } });

describe("an app's id", () => {
    test("is app.id, else one made from the project's name", () => {
        expect(appId(config({ id: 'com.example.demo' }))).toBe('com.example.demo');
        expect(appId({ general: { name: '@scope/my app' }, app: {} })).toBe('dev.crossbind.-scope-my-app');
    });

    test('takes letters, digits, hyphens and dots alone, as it names folders as well', () => {
        expect(() => appId(config({ id: 'com.example/demo' }))).toThrow('app.id');
    });

    test('has no empty part, which would name the folder above the app\'s own', () => {
        ['.', '..', 'com..example', '.com.example', 'com.example.'].forEach((id) => {
            expect(() => appId(config({ id }))).toThrow(`app.id ${JSON.stringify(id)} is no bundle id`);
        });
    });
});

describe("an app's name", () => {
    test("is app.name, else the project's name", () => {
        expect(appDisplayName(config({ name: 'Démo Uygulaması' }))).toBe('Démo Uygulaması');
        expect(appDisplayName(config())).toBe('demo-app');
    });

    test('takes no quotation mark, backslash or control character, which its C and Windows resource strings cannot hold', () => {
        for (const name of ['Say "hi"', 'a\\b', 'two\nlines', '', '  ', 42]) {
            expect(() => appDisplayName(config({ name }))).toThrow('app.name');
        }
    });

    test('starts with neither @ nor ?, which Android reads as a resource', () => {
        expect(() => appDisplayName(config({ name: '@string/app' }))).toThrow('@ nor ?');
        expect(() => appDisplayName(config({ name: '?attr' }))).toThrow('@ nor ?');
    });

    test("names general.name and the fix when the project's name is the one it cannot show", () => {
        expect(() => appDisplayName({ general: { name: '@scope' }, app: {} })).toThrow('Set app.name');
    });
});

describe("an app's copyright and category", () => {
    test('are none without app.copyright and app.category', () => {
        expect(appCopyright(config())).toBeNull();
        expect(appCategory(config())).toBeNull();
    });

    test('take a copyright line its C and Windows resource strings can hold', () => {
        expect(appCopyright(config({ copyright: '© 2026 Örnek A.Ş.' }))).toBe('© 2026 Örnek A.Ş.');
        for (const copyright of ['Say "hi"', 'a\\b', 'two\nlines', '', '  ', 42]) {
            expect(() => appCopyright(config({ copyright }))).toThrow('app.copyright');
        }
    });

    test("take one of Apple's categories, which macOS shows the app under, and the main one a Linux menu shows it under", () => {
        expect(appCategory(config({ category: 'developer-tools' }))).toEqual({ darwin: 'public.app-category.developer-tools', linux: 'Development' });
        expect(appCategory(config({ category: 'puzzle-games' }))).toEqual({ darwin: 'public.app-category.puzzle-games', linux: 'Game' });
        // An audio or a video app is in AudioVideo as well, as the freedesktop menu specification asks.
        expect(appCategory(config({ category: 'music' })).linux).toBe('Audio;AudioVideo');
    });

    test("refuses a category Apple has none of, naming the ones it has", () => {
        for (const category of ['Development', 'public.app-category.games', '', 7]) {
            expect(() => appCategory(config({ category }))).toThrow(`app.category ${JSON.stringify(category)} is none of Apple's app categories`);
        }
        expect(() => appCategory(config({ category: 'games ' }))).toThrow('developer-tools');
    });
});

describe("an app's window", () => {
    test('opens a 1024 × 768 page that resizes, without app.window', () => {
        expect(appWindow(config())).toEqual({
            width: 1024, height: 768, minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0, resizable: true, fullscreen: false, backgroundColor: null,
        });
    });

    test('takes the page size, its limits, whether it resizes or opens full screen, and its background from app.window', () => {
        const window = { width: 800, height: 600, minWidth: 400, minHeight: 300, maxWidth: 1200, maxHeight: 900, fullscreen: true, backgroundColor: '#1E1E1E' };
        expect(appWindow(config({ window }))).toEqual({ ...window, resizable: true });
        expect(appWindow(config({ window: { resizable: false } }))).toMatchObject({ resizable: false });
    });

    test('refuses anything but an object of its options, so a misspelt option does not pass unnoticed', () => {
        for (const window of [800, true, [], 'big']) expect(() => appWindow(config({ window }))).toThrow('no object');
        expect(() => appWindow(config({ window: { heigth: 600 } }))).toThrow('heigth');
    });

    test('refuses a size that is no whole number of pixels up to 16384', () => {
        for (const width of [0, -1, 10.5, '800', 16385, 1e21]) expect(() => appWindow(config({ window: { width } }))).toThrow('app.window.width');
        expect(() => appWindow(config({ window: { minHeight: -1 } }))).toThrow('app.window.minHeight');
        expect(() => appWindow(config({ window: { resizable: 'yes' } }))).toThrow('app.window.resizable');
    });

    test('refuses a minimum above the size it opens with, or on a window that does not resize', () => {
        expect(() => appWindow(config({ window: { width: 800, minWidth: 900 } }))).toThrow('raise app.window.width');
        expect(() => appWindow(config({ window: { minHeight: 800 } }))).toThrow('app.window.minHeight 800');
        expect(() => appWindow(config({ window: { resizable: false, minHeight: 300 } }))).toThrow('resizable');
    });

    test('refuses a maximum below the size it opens with, or on a window that does not resize', () => {
        expect(() => appWindow(config({ window: { width: 800, maxWidth: 700 } }))).toThrow('lower app.window.width');
        expect(() => appWindow(config({ window: { maxHeight: 700 } }))).toThrow('app.window.maxHeight 700 is below the height the window opens with, 768');
        expect(() => appWindow(config({ window: { resizable: false, maxWidth: 2000 } }))).toThrow('maxWidth and maxHeight limit a window that resizes');
        expect(() => appWindow(config({ window: { maxWidth: 16385 } }))).toThrow('app.window.maxWidth');
    });

    test('takes true or false alone for whether it opens full screen', () => {
        expect(() => appWindow(config({ window: { fullscreen: 'yes' } }))).toThrow('app.window.fullscreen "yes" is no boolean');
    });
});

describe("an app's permissions", () => {
    test('are none without app.permissions, and the devices it lists with their reasons', () => {
        expect(appPermissions(config())).toEqual({});
        expect(appPermissions(config({ permissions: { camera: 'To scan barcodes', location: 'To find the nearest store' } })))
            .toEqual({ camera: 'To scan barcodes', location: 'To find the nearest store' });
    });

    test('take the camera, the microphone and the location alone, each with a reason its user can read', () => {
        for (const permissions of [['camera'], 'camera']) {
            expect(() => appPermissions(config({ permissions }))).toThrow('is no object of camera, microphone, location');
        }
        expect(() => appPermissions(config({ permissions: { contacts: 'To invite friends' } }))).toThrow('contacts is none of them');
        for (const reason of ['', '  ', 'two\nlines', true]) {
            expect(() => appPermissions(config({ permissions: { camera: reason } }))).toThrow('app.permissions.camera');
        }
    });

    test('give macOS and iOS their reasons under the keys each reads, macOS the older location one as well', () => {
        const app = { permissions: { camera: 'To scan', microphone: 'To record', location: 'To find' } };
        expect(usageDescriptions(config(app), 'ios')).toEqual({
            NSCameraUsageDescription: 'To scan', NSMicrophoneUsageDescription: 'To record', NSLocationWhenInUseUsageDescription: 'To find',
        });
        expect(usageDescriptions(config(app), 'darwin')).toMatchObject({ NSLocationWhenInUseUsageDescription: 'To find', NSLocationUsageDescription: 'To find' });
        expect(usageDescriptions(config(), 'darwin')).toEqual({});
    });
});

describe("an app's background color", () => {
    test("is app.window.backgroundColor, which a phone shows as well, else the system's", () => {
        expect(appBackgroundColor(config({ window: { backgroundColor: '#12abEF' } }))).toBe('#12abEF');
        expect(appBackgroundColor(config())).toBe(null);
        // A phone's build takes the color without the desktop's options, whatever they are.
        expect(appBackgroundColor(config({ window: 800 }))).toBe(null);
    });

    test('takes #rrggbb alone', () => {
        for (const backgroundColor of ['red', '#fff', '#12345g', '#1e1e1e80', 'rgb(0, 0, 0)', 0x1e1e1e]) {
            expect(() => appBackgroundColor(config({ window: { backgroundColor } }))).toThrow('no color of the form #rrggbb');
        }
    });
});

describe("a desktop app's updater", () => {
    const publicKey = Buffer.alloc(32, 7).toString('base64');
    const url = 'https://example.com/updates/demo-app-{platform}-{arch}.update.json';

    test('is none without app.updater', () => {
        expect(appUpdater(config())).toBeNull();
    });

    test("takes where the updates are and the key that checks them, with package.json's version", () => {
        expect(appUpdater(config({ updater: { url, publicKey } }, '1.2.3-beta.4'))).toEqual({ url, publicKey: Buffer.alloc(32, 7), version: '1.2.3-beta.4' });
    });

    test('takes an https address, or http on this machine alone', () => {
        for (const local of ['http://localhost:8080/u.json', 'http://127.0.0.1/u.json', 'http://[::1]/u.json']) {
            expect(appUpdater(config({ updater: { url: local, publicKey } })).url).toBe(local);
        }
        for (const bad of ['http://example.com/u.json', 'ftp://example.com/u.json', 'example.com/u.json', 'https://example.com/a b.json', 'https://example.com/"u".json', 42]) {
            expect(() => appUpdater(config({ updater: { url: bad, publicKey } }))).toThrow('is no https address');
        }
    });

    test("takes a manifest's address, beside which its file is, as the host can take it", () => {
        for (const bad of ['https://example.com', 'https://example.com?x=1', 'https://example.com/updates/', 'https://example.com/güncelleme.json']) {
            expect(() => appUpdater(config({ updater: { url: bad, publicKey } }))).toThrow('is no https address of a manifest');
        }
    });

    test('refuses a key of small order, whose signatures anyone can forge, whatever the sign of x', () => {
        const identity = Buffer.alloc(32);
        identity[0] = 1;
        identity[31] = 0x80;
        for (const key of [Buffer.alloc(32), identity]) {
            expect(() => appUpdater(config({ updater: { url, publicKey: key.toString('base64') } }))).toThrow('anyone can forge signatures for');
        }
    });

    test('takes the Ed25519 public key `crossbind app updater-key` prints, as it prints it', () => {
        for (const bad of [Buffer.alloc(31).toString('base64'), `${publicKey} `, publicKey.replace(/=$/, ''), undefined]) {
            expect(() => appUpdater(config({ updater: { url, publicKey: bad } }))).toThrow('is no Ed25519 public key');
        }
    });

    test('refuses an option it does not take', () => {
        expect(() => appUpdater(config({ updater: { url, publicKey, interval: 60 } }))).toThrow('interval is none of them');
        expect(() => appUpdater(config({ updater: url }))).toThrow('is no object of url and publicKey');
        expect(() => appUpdater(config({ updater: null }))).toThrow('is no object of url and publicKey');
    });

    test('needs a semver version in package.json to tell a newer one by', () => {
        for (const version of ['1.2', '1.2.3.4', '1.2.3-', '1.2.3-a..b', '1.2.3+', 'v1.2.3']) {
            expect(() => appUpdater(config({ updater: { url, publicKey } }, version))).toThrow('is no semver version');
        }
    });

    test('needs a general.name an app can fetch its update files by', () => {
        expect(() => appUpdater({ general: { name: 'my app' }, app: { updater: { url, publicKey } } })).toThrow('general.name "my app" names');
        expect(() => appUpdater({ general: { name: '.hidden' }, app: { updater: { url, publicKey } } })).toThrow('not starting with a dot');
    });
});

describe("an app's URL schemes", () => {
    test('are none without app.urlSchemes, and the ones it lists', () => {
        expect(appUrlSchemes(config())).toEqual([]);
        expect(appUrlSchemes(config({ urlSchemes: ['myapp', 'my-app.dev+1'] }))).toEqual(['myapp', 'my-app.dev+1']);
    });

    test('take lowercase scheme names alone, which is how Android matches them', () => {
        expect(() => appUrlSchemes(config({ urlSchemes: 'myapp' }))).toThrow("is no list of schemes, as ['myapp'] is");
        // One letter would take a Windows path's drive, as C:\, for a link.
        for (const scheme of ['MyApp', '1app', 'my app', 'myapp:', '', 'c', 7]) {
            expect(() => appUrlSchemes(config({ urlSchemes: [scheme] }))).toThrow('takes schemes of a lowercase letter');
        }
    });

    test("refuse a scheme the web, the system or crossbind owns, and one listed twice", () => {
        for (const scheme of ['http', 'https', 'file', 'mailto', 'crossbind', 'javascript', 'clsid']) {
            expect(() => appUrlSchemes(config({ urlSchemes: [scheme] }))).toThrow(`cannot take ${scheme}`);
        }
        expect(() => appUrlSchemes(config({ urlSchemes: ['myapp', 'myapp'] }))).toThrow('lists a scheme twice');
    });

    test("are app.urlSchemes's, then its extensions', each with the extension whose native code gets its links", () => {
        const app = { ...config({ urlSchemes: ['myapp'] }), extensions: [{ name: 'oauth', app: { urlSchemes: ['myapp.oauth'] } }, { name: 'clipboard', app: {} }] };
        expect(urlSchemeOwners(app)).toEqual([{ scheme: 'myapp', extension: null }, { scheme: 'myapp.oauth', extension: 'oauth' }]);
        expect(appUrlSchemes(app)).toEqual(['myapp', 'myapp.oauth']);
    });

    test('have one owner each: two that claim one stop the build, naming both', () => {
        const extensions = (...lists) => lists.map((urlSchemes, index) => ({ name: `link${index}`, app: { urlSchemes } }));
        expect(() => urlSchemeOwners({ ...config({ urlSchemes: ['myapp'] }), extensions: extensions(['myapp']) }))
            .toThrow('crossbind: app.urlSchemes and the extension link0 both claim the scheme myapp, whose links one alone gets.');
        expect(() => appUrlSchemes({ ...config(), extensions: extensions(['other'], ['other']) }))
            .toThrow('crossbind: the extension link0 and the extension link1 both claim the scheme other');
    });
});

describe("the header a desktop app's host builds with", () => {
    test('defines the name and the window', () => {
        expect(appHeader(config({ name: 'Demo App', window: { width: 800, height: 600, minWidth: 400 } }), 'darwin')).toBe([
            '// crossbind writes this file from crossbind.config.js and package.json.',
            '#define CROSSBIND_APP_PERMISSION_CAMERA 0',
            '#define CROSSBIND_APP_PERMISSION_MICROPHONE 0',
            '#define CROSSBIND_APP_PERMISSION_LOCATION 0',
            '#define CROSSBIND_APP_ID "dev.crossbind.demo-app"',
            '#define CROSSBIND_APP_NAME "Demo App"',
            '#define CROSSBIND_APP_WINDOW_WIDTH 800',
            '#define CROSSBIND_APP_WINDOW_HEIGHT 600',
            '#define CROSSBIND_APP_WINDOW_MIN_WIDTH 400',
            '#define CROSSBIND_APP_WINDOW_MIN_HEIGHT 0',
            '#define CROSSBIND_APP_WINDOW_RESIZABLE 1',
            '',
        ].join('\n'));
    });

    test('defines the most the window grows to, any size on the side without a maximum, and whether it opens full screen', () => {
        const header = appHeader(config({ window: { maxWidth: 1600, fullscreen: true } }), 'win32');
        expect(header).toContain('#define CROSSBIND_APP_WINDOW_MAX_WIDTH 1600\n#define CROSSBIND_APP_WINDOW_MAX_HEIGHT 16384\n');
        expect(header).toContain('#define CROSSBIND_APP_WINDOW_FULLSCREEN 1\n');
        expect(appHeader(config(), 'linux')).not.toMatch(/MAX_WIDTH|FULLSCREEN/);
    });

    test("defines the app's id on every platform, an Android app's its application id", () => {
        expect(appHeader(config({ id: 'com.example.demo' }), 'ios')).toContain('#define CROSSBIND_APP_ID "com.example.demo"\n#define CROSSBIND_APP_NAME');
        expect(appHeader(config(), 'android')).toContain('#define CROSSBIND_APP_ID "dev.crossbind.demo_app"\n');
        expect(appHeader(config(), 'linux')).toContain('#define CROSSBIND_APP_ID "dev.crossbind.demo-app"\n');
        expect(() => appHeader(config({ id: 'com.example.my-app' }), 'android')).toThrow('is no Android application id');
    });

    test("defines the background color on the desktop and on iOS, while an Android app's comes with its project", () => {
        const app = { window: { backgroundColor: '#1E1E1E' } };
        expect(appHeader(config(app), 'darwin')).toContain('#define CROSSBIND_APP_BACKGROUND_COLOR 0x1e1e1e\n');
        expect(appHeader(config(app), 'ios')).toContain('#define CROSSBIND_APP_BACKGROUND_COLOR 0x1e1e1e\n');
        expect(appHeader(config(app), 'android')).not.toContain('BACKGROUND_COLOR');
        expect(appHeader(config(), 'linux')).not.toContain('BACKGROUND_COLOR');
        expect(() => appHeader(config({ window: { backgroundColor: 'black' } }), 'ios')).toThrow('app.window.backgroundColor "black"');
    });

    test("defines the devices the page may use on the desktop and on iOS, while an Android app's manifest lists them", () => {
        const app = { permissions: { camera: 'To scan' } };
        expect(appHeader(config(app), 'linux')).toContain(
            '#define CROSSBIND_APP_PERMISSION_CAMERA 1\n#define CROSSBIND_APP_PERMISSION_MICROPHONE 0\n#define CROSSBIND_APP_PERMISSION_LOCATION 0\n',
        );
        expect(appHeader(config(app), 'ios')).toContain('#define CROSSBIND_APP_PERMISSION_CAMERA 1\n');
        expect(appHeader(config(app), 'android')).not.toContain('PERMISSION');
    });

    test("adds the version a Windows executable carries: package.json's, else 1.0.0", () => {
        expect(appHeader(config({}, '1.2.3-beta.4'), 'win32')).toContain('#define CROSSBIND_APP_VERSION "1.2.3-beta.4"\n#define CROSSBIND_APP_VERSION_NUMBERS 1,2,3,0\n');
        expect(appHeader(config({}, '1.2.3.4+build.5'), 'win32')).toContain('#define CROSSBIND_APP_VERSION_NUMBERS 1,2,3,4\n');
        expect(appHeader(config({}, '2.1'), 'win32')).toContain('#define CROSSBIND_APP_VERSION_NUMBERS 2,1,0,0\n');
        expect(appHeader({ general: { name: 'demo' }, app: {} }, 'win32')).toContain('#define CROSSBIND_APP_VERSION_NUMBERS 1,0,0,0\n');
    });

    test("gives a phone's host the app's id and name alone, so the desktop's options do not stop its build", () => {
        expect(appHeader(config({ id: 'com.example.my_app', window: 800 }), 'android')).toBe([
            '// crossbind writes this file from crossbind.config.js and package.json.',
            '#define CROSSBIND_APP_ID "com.example.my_app"',
            '#define CROSSBIND_APP_NAME "demo-app"',
            '',
        ].join('\n'));
    });

    test("leaves a desktop app's updates to the updater's options", () => {
        const updater = { url: 'https://example.com/{platform}-{arch}.json', publicKey: Buffer.alloc(32, 7).toString('base64') };
        expect(appHeader(config({ updater }), 'linux')).not.toContain('UPDATER');
    });

    test("leaves the app's URL schemes to its extensions' registration, and one instance to the instance's options", () => {
        expect(appHeader(config({ urlSchemes: ['myapp'], singleInstance: true }), 'win32')).not.toMatch(/URL_SCHEMES|SINGLE_INSTANCE/);
    });

    test('names the icon a Windows executable carries, which the build writes beside the header', () => {
        expect(appHeader(config({ icon: 'icon.png' }), 'win32')).toContain('#define CROSSBIND_APP_ICON 1\n');
        expect(appHeader(config(), 'win32')).not.toContain('CROSSBIND_APP_ICON');
        expect(appHeader(config({ icon: 'icon.png' }), 'darwin')).not.toContain('CROSSBIND_APP_ICON');
    });

    test('adds the copyright a Windows executable carries, with app.copyright', () => {
        expect(appHeader(config({ copyright: '© 2026 Example' }), 'win32')).toContain('#define CROSSBIND_APP_COPYRIGHT "© 2026 Example"\n');
        expect(appHeader(config(), 'win32')).not.toContain('COPYRIGHT');
        expect(appHeader(config({ copyright: '© 2026 Example' }), 'darwin')).not.toContain('COPYRIGHT');
    });

    test('refuses an app.copyright or app.category no desktop shows, on every desktop', () => {
        expect(() => appHeader(config({ copyright: 'a\\b' }), 'linux')).toThrow('app.copyright');
        expect(() => appHeader(config({ category: 'tools' }), 'darwin')).toThrow('app.category');
        expect(() => appHeader(config({ category: 'tools' }), 'win32')).toThrow('app.category');
    });

    test('refuses a version Windows cannot carry on Windows alone', () => {
        for (const version of ['70000.0.0', '1.2.3.4.5', 'v1.2.3', '1.0.0-x"y', 1]) {
            expect(() => appHeader(config({}, version), 'win32')).toThrow('65535');
        }
        expect(appHeader(config({}, '20261021.0.0'), 'darwin')).not.toContain('VERSION');
    });
});

describe("an iOS app's encryption statement", () => {
    test('is none without app.encryption, as it is a legal statement crossbind does not make for the app', () => {
        expect(appEncryption(config())).toBe(null);
        expect(appEncryption(config({ encryption: false }))).toBe(false);
        expect(appEncryption(config({ encryption: true }))).toBe(true);
    });

    test('takes true or false alone', () => {
        for (const encryption of ['no', 0, null]) {
            expect(() => appEncryption(config({ encryption }))).toThrow(`app.encryption ${JSON.stringify(encryption)} is no boolean`);
        }
    });
});

describe("an iOS app's privacy reasons", () => {
    test("are none without app.privacy, and Apple's reasons for each category it lists", () => {
        expect(appPrivacy(config())).toEqual({});
        expect(appPrivacy(config({ privacy: { fileTimestamp: ['C617.1'], diskSpace: ['E174.1', '85F4.1'] } })))
            .toEqual({ fileTimestamp: ['C617.1'], diskSpace: ['E174.1', '85F4.1'] });
    });

    test("take Apple's categories alone, so a misspelt one does not pass unnoticed", () => {
        expect(() => appPrivacy(config({ privacy: { fileTimestamps: ['C617.1'] } })))
            .toThrow('app.privacy takes fileTimestamp, systemBootTime, diskSpace, activeKeyboards, userDefaults; fileTimestamps is none of them');
        expect(() => appPrivacy(config({ privacy: { toString: ['C617.1'] } }))).toThrow('toString is none of them');
        expect(() => appPrivacy(config({ privacy: ['C617.1'] }))).toThrow('app.privacy ["C617.1"] is no object');
    });

    test("take for each category one or more of the reasons Apple allows for it", () => {
        expect(() => appPrivacy(config({ privacy: { fileTimestamp: ['E174.1'] } })))
            .toThrow('app.privacy.fileTimestamp ["E174.1"] is no list of Apple\'s reasons for it, which are DDA9.1, C617.1, 3B52.1, 0A2A.1');
        expect(() => appPrivacy(config({ privacy: { userDefaults: [] } }))).toThrow('app.privacy.userDefaults []');
        expect(() => appPrivacy(config({ privacy: { systemBootTime: '35F9.1' } }))).toThrow('app.privacy.systemBootTime "35F9.1"');
    });
});

describe("the options of the host's own extensions", () => {
    test("give a desktop app's instance the app's id, which names it, with app.singleInstance", () => {
        ['darwin', 'linux', 'win32'].forEach((platform) => {
            expect(hostExtensionOptions(config({ id: 'com.example.demo', singleInstance: true }), platform).instance).toEqual({ id: 'com.example.demo' });
        });
        expect(hostExtensionOptions(config({ singleInstance: false }), 'win32')).not.toHaveProperty('instance');
        expect(hostExtensionOptions(config(), 'darwin')).not.toHaveProperty('instance');
        // A phone keeps every app to one instance itself.
        ['ios', 'android'].forEach((platform) => {
            expect(hostExtensionOptions(config({ singleInstance: true }), platform)).not.toHaveProperty('instance');
        });
    });

    test('keep a Windows or Linux app with a scheme to one instance unless app.singleInstance is false, as a link starts it again', () => {
        const linked = config({ urlSchemes: ['myapp'] });
        expect(hostExtensionOptions(linked, 'win32')).toHaveProperty('instance');
        expect(hostExtensionOptions(linked, 'linux')).toHaveProperty('instance');
        // macOS hands a link to the app that runs.
        expect(hostExtensionOptions(linked, 'darwin')).not.toHaveProperty('instance');
        expect(hostExtensionOptions(config({ urlSchemes: ['myapp'], singleInstance: false }), 'linux')).not.toHaveProperty('instance');
        // An extension's scheme starts the app again as well.
        const extended = { ...config(), extensions: [{ name: 'oauth', app: { urlSchemes: ['myapp.oauth'] } }] };
        expect(hostExtensionOptions(extended, 'win32')).toHaveProperty('instance');
    });

    test("give the links, which hand the page the links of app.urlSchemes, to an app that lists any, on every platform", () => {
        ['darwin', 'linux', 'win32', 'ios', 'android'].forEach((platform) => {
            expect(hostExtensionOptions(config({ urlSchemes: ['myapp'] }), platform).links).toEqual({});
        });
        expect(hostExtensionOptions(config(), 'darwin')).not.toHaveProperty('links');
        // An extension's schemes reach that extension, not the page.
        const extended = { ...config(), extensions: [{ name: 'oauth', app: { urlSchemes: ['myapp.oauth'] } }] };
        expect(hostExtensionOptions(extended, 'ios')).not.toHaveProperty('links');
    });

    test("give an Apple app's activities, which hand the page the user activities of app.activityTypes and take its own, the types it lists", () => {
        const continuing = config({ activityTypes: ['com.example.demo.edit'] });
        ['darwin', 'ios'].forEach((platform) => expect(hostExtensionOptions(continuing, platform).activities).toEqual({ types: ['com.example.demo.edit'] }));
        ['linux', 'win32', 'android'].forEach((platform) => expect(hostExtensionOptions(continuing, platform)).not.toHaveProperty('activities'));
        // An extension's types reach that extension, not the page.
        const extended = { ...config(), extensions: [{ name: 'notes', app: { activityTypes: ['com.example.notes.open'] } }] };
        expect(hostExtensionOptions(extended, 'ios')).not.toHaveProperty('activities');
    });

    test("give a phone's shortcuts, which hand the page the taps of app.shortcutItems' quick actions, where it lists any", () => {
        const acting = config({ shortcutItems: [{ type: 'new-note', title: 'New note' }] });
        ['ios', 'android'].forEach((platform) => expect(hostExtensionOptions(acting, platform).shortcuts).toEqual({}));
        ['darwin', 'linux', 'win32'].forEach((platform) => expect(hostExtensionOptions(acting, platform)).not.toHaveProperty('shortcuts'));
        const extended = { ...config(), extensions: [{ name: 'scanner', app: { shortcutItems: [{ type: 'scan', title: 'Scan' }] } }] };
        expect(hostExtensionOptions(extended, 'android')).not.toHaveProperty('shortcuts');
    });

    test("give a phone's links the https links of app.links as well, which a desktop's system hands no app", () => {
        ['ios', 'android'].forEach((platform) => expect(hostExtensionOptions(config({ links: ['example.com'] }), platform).links).toEqual({}));
        ['darwin', 'linux', 'win32'].forEach((platform) => expect(hostExtensionOptions(config({ links: ['example.com'] }), platform)).not.toHaveProperty('links'));
        const extended = { ...config(), extensions: [{ name: 'invites', app: { links: ['example.com/invite'] } }] };
        expect(hostExtensionOptions(extended, 'android')).not.toHaveProperty('links');
    });

    test('give the files, which hand the page the files no extension owns, to an app that opens files, and keep it to one instance on Windows and Linux', () => {
        const opening = config({ fileTypes: [{ name: 'GeoJSON', extensions: ['geojson'] }] });
        ['darwin', 'linux', 'win32', 'ios', 'android'].forEach((platform) => expect(hostExtensionOptions(opening, platform).files).toEqual({}));
        expect(hostExtensionOptions({ ...config(), extensions: [{ name: 'maps', app: { fileTypes: [{ name: 'KML', extensions: ['kml'] }] } }] }, 'linux'))
            .toMatchObject({ files: {}, instance: {} });
        expect(hostExtensionOptions(opening, 'win32')).toHaveProperty('instance');
        expect(hostExtensionOptions(opening, 'darwin')).not.toHaveProperty('instance');
        expect(hostExtensionOptions(config(), 'linux')).not.toHaveProperty('files');
    });

    test("give a macOS app whose app.permissions lists the location the page's location, which WKWebView gives a macOS page none of", () => {
        const located = config({ permissions: { location: 'To show where you are' } });
        expect(hostExtensionOptions(located, 'darwin')['page-location']).toEqual({});
        ['ios', 'linux', 'win32', 'android'].forEach((platform) => expect(hostExtensionOptions(located, platform)).not.toHaveProperty('page-location'));
        expect(hostExtensionOptions(config({ permissions: { camera: 'To scan' } }), 'darwin')).not.toHaveProperty('page-location');
    });

    test('refuse an app.singleInstance that is no boolean on the desktop, naming the values it takes', () => {
        expect(() => hostExtensionOptions(config({ singleInstance: 'yes' }), 'darwin')).toThrow('app.singleInstance "yes" is no boolean');
        expect(hostExtensionOptions(config({ singleInstance: 'yes' }), 'ios')).not.toHaveProperty('instance');
    });

    test("give the shell where the page's shell.openPath opens files: nowhere without app.openPath", () => {
        expect(hostExtensionOptions(config(), 'darwin')).toEqual({ shell: { openPath: [] }, 'page-navigation': { load: [] } });
        expect(hostExtensionOptions(config({ openPath: ['logs', 'picked'] }), 'ios').shell).toEqual({ openPath: ['logs', 'picked'] });
    });

    test("give the page's navigation the origins app.navigation.load lists, on every platform", () => {
        const load = ['https://login.example.com', 'http://localhost:8080'];
        ['darwin', 'linux', 'win32', 'ios', 'android'].forEach((platform) => {
            expect(hostExtensionOptions(config({ navigation: { load } }), platform)['page-navigation']).toEqual({ load });
        });
    });

    test('refuse an app.navigation of anything but origins to load', () => {
        expect(() => hostExtensionOptions(config({ navigation: ['https://a.example'] }), 'linux')).toThrow('app.navigation ["https://a.example"] is no object');
        expect(() => hostExtensionOptions(config({ navigation: { open: [] } }), 'linux')).toThrow('app.navigation takes load alone; open is none of it.');
        expect(() => hostExtensionOptions(config({ navigation: { load: 'https://a.example' } }), 'linux')).toThrow('is no list of origins');
        for (const origin of ['https://a.example/', 'https://a.example/login', 'https://A.example', 'https://a.example:443', 'file:///etc', 'crossbind://app', 7]) {
            expect(() => hostExtensionOptions(config({ navigation: { load: [origin] } }), 'linux')).toThrow(`app.navigation.load's ${JSON.stringify(origin)} is no http or https origin`);
        }
    });

    test('refuse an app.openPath of anything but data, cache, logs and picked', () => {
        expect(() => hostExtensionOptions(config({ openPath: 'data' }), 'linux')).toThrow('app.openPath "data" is no list');
        expect(() => hostExtensionOptions(config({ openPath: ['data', 'home'] }), 'linux')).toThrow('"home" is none of them');
    });

    test("give a Linux app's menu the app's id, which its tray names itself by on the session bus", () => {
        expect(hostExtensionOptions(config({ id: 'com.example.demo' }), 'linux').menu).toEqual({ id: 'com.example.demo' });
        ['darwin', 'win32', 'ios', 'android'].forEach((platform) => {
            expect(hostExtensionOptions(config({ id: 'com.example.demo' }), platform)).not.toHaveProperty('menu');
        });
    });

    test("give a desktop app's updater app.updater, with the app's version and id, which an update's signature covers", () => {
        const updater = { url: 'https://example.com/{platform}-{arch}.json', publicKey: Buffer.alloc(32, 7).toString('base64') };
        ['darwin', 'linux', 'win32'].forEach((platform) => {
            expect(hostExtensionOptions(config({ id: 'com.example.demo', updater }), platform).updater)
                .toEqual({ url: updater.url, publicKey: updater.publicKey, version: '1.2.3', id: 'com.example.demo' });
        });
        expect(hostExtensionOptions(config(), 'win32')).not.toHaveProperty('updater');
    });

    test("give a phone's updater nothing, as its store updates it, and check no app.updater there", () => {
        ['ios', 'android'].forEach((platform) => {
            expect(hostExtensionOptions(config({ updater: { url: 'http://example.com/u.json', publicKey: 'key' } }), platform)).not.toHaveProperty('updater');
        });
        expect(() => hostExtensionOptions(config({ updater: { url: 'http://example.com/u.json', publicKey: 'key' } }), 'darwin')).toThrow('is no https address');
    });
});
