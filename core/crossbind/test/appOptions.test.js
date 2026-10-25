import { describe, expect, test } from 'vitest';
import {
    appBackgroundColor, appCategory, appCopyright, appDisplayName, appHeader, appId, appPermissions, appUpdater, appUrlSchemes, appWindow,
    usageDescriptions,
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
});

describe("the header a desktop app's host builds with", () => {
    test('defines the name and the window', () => {
        expect(appHeader(config({ name: 'Demo App', window: { width: 800, height: 600, minWidth: 400 } }), 'darwin')).toBe([
            '// crossbind writes this file from crossbind.config.js and package.json.',
            '#define CROSSBIND_APP_OPEN_PATH {}',
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

    test("defines the background color on the desktop and on iOS, while an Android app's comes with its project", () => {
        const app = { window: { backgroundColor: '#1E1E1E' } };
        expect(appHeader(config(app), 'darwin')).toContain('#define CROSSBIND_APP_OPEN_PATH {}\n#define CROSSBIND_APP_BACKGROUND_COLOR 0x1e1e1e\n');
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

    test("lists where the page's shell.openPath opens files: nowhere without app.openPath", () => {
        expect(appHeader(config(), 'linux')).toContain('#define CROSSBIND_APP_OPEN_PATH {}\n');
        expect(appHeader(config({ openPath: ['logs', 'picked'] }), 'win32')).toContain('#define CROSSBIND_APP_OPEN_PATH {"logs", "picked"}\n');
    });

    test("gives a phone's host that list alone, so the desktop's options do not stop its build", () => {
        expect(appHeader(config({ openPath: ['data'], id: 'com.example.my_app', window: 800 }), 'android')).toBe([
            '// crossbind writes this file from crossbind.config.js and package.json.',
            '#define CROSSBIND_APP_OPEN_PATH {"data"}',
            '',
        ].join('\n'));
    });

    test('refuses anything but a list of data, cache, logs and picked', () => {
        expect(() => appHeader(config({ openPath: 'data' }), 'ios')).toThrow('app.openPath "data" is no list');
        expect(() => appHeader(config({ openPath: ['data', 'home'] }), 'darwin')).toThrow('"home" is none of them');
    });

    test("defines where a desktop app's updates are, the key that checks them and the version they are newer than", () => {
        const updater = { url: 'https://example.com/{platform}-{arch}.json', publicKey: Buffer.alloc(32, 7).toString('base64') };
        const header = appHeader(config({ updater }), 'linux');
        expect(header).toContain('#define CROSSBIND_APP_UPDATER_URL "https://example.com/{platform}-{arch}.json"\n');
        expect(header).toContain(`#define CROSSBIND_APP_UPDATER_KEY {${Array(32).fill('0x07').join(', ')}}\n`);
        expect(header).toContain('#define CROSSBIND_APP_UPDATER_VERSION "1.2.3"\n');
        expect(appHeader(config(), 'darwin')).not.toContain('UPDATER');
        expect(appHeader(config({ updater }), 'ios')).not.toContain('UPDATER');
    });

    test("lists a desktop app's URL schemes, which keep a Windows or Linux app to one instance unless app.singleInstance is false", () => {
        const header = appHeader(config({ urlSchemes: ['myapp', 'other'] }), 'win32');
        expect(header).toContain('#define CROSSBIND_APP_URL_SCHEMES {"myapp", "other"}\n');
        expect(header).toContain('#define CROSSBIND_APP_SINGLE_INSTANCE 1\n');
        expect(appHeader(config({ urlSchemes: ['myapp'], singleInstance: false }), 'linux')).not.toContain('SINGLE_INSTANCE');
        // macOS hands a link to the app that runs.
        expect(appHeader(config({ urlSchemes: ['myapp'] }), 'darwin')).not.toContain('SINGLE_INSTANCE');
        expect(appHeader(config(), 'darwin')).not.toContain('URL_SCHEMES');
        expect(appHeader(config({ urlSchemes: ['myapp'] }), 'android')).not.toContain('URL_SCHEMES');
    });

    test('keeps a desktop app to one instance with app.singleInstance, as a phone keeps every app itself', () => {
        expect(appHeader(config({ singleInstance: true }), 'linux')).toContain('#define CROSSBIND_APP_SINGLE_INSTANCE 1\n');
        expect(appHeader(config({ singleInstance: false }), 'win32')).not.toContain('SINGLE_INSTANCE');
        expect(appHeader(config(), 'darwin')).not.toContain('SINGLE_INSTANCE');
        expect(appHeader(config({ singleInstance: true }), 'ios')).not.toContain('SINGLE_INSTANCE');
    });

    test('refuses an app.singleInstance that is no boolean, naming the values it takes', () => {
        expect(() => appHeader(config({ singleInstance: 'yes' }), 'darwin')).toThrow('app.singleInstance "yes" is no boolean');
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
