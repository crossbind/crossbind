import { describe, expect, test } from 'vitest';
import {
    appBackgroundColor, appCategory, appCopyright, appDarkBackgroundColor, appDisplayName, appEncryption, appHeader, appId, appPermissions, appPrivacy,
    appUrlSchemes, appWindow, iosAppGroup, iosMultipleWindows, urlSchemeOwners, usageDescriptions,
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
            width: 1024, height: 768, minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0, resizable: true, fullscreen: false, backgroundColor: null, titleBar: 'visible',
        });
    });

    test('takes the page size, its limits, whether it resizes or opens full screen, its background and its title bar from app.window', () => {
        const window = { width: 800, height: 600, minWidth: 400, minHeight: 300, maxWidth: 1200, maxHeight: 900, fullscreen: true, backgroundColor: '#1E1E1E', titleBar: 'hidden' };
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

    test("takes 'visible' or 'hidden' alone for its title bar", () => {
        for (const titleBar of ['none', 'Hidden', true, false, '']) {
            expect(() => appWindow(config({ window: { titleBar } }))).toThrow(`app.window.titleBar ${JSON.stringify(titleBar)} is neither 'visible' nor 'hidden'`);
        }
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

    test('is one of two, for a light and a dark system, which a phone follows and a desktop takes the light one of', () => {
        const app = { window: { backgroundColor: { light: '#efece4', dark: '#0C0D10' } } };
        expect(appBackgroundColor(config(app))).toBe('#efece4');
        expect(appDarkBackgroundColor(config(app))).toBe('#0C0D10');
        expect(appDarkBackgroundColor(config({ window: { backgroundColor: '#efece4' } }))).toBe(null);
        expect(appDarkBackgroundColor(config())).toBe(null);
    });

    test('takes the two as { light, dark }, each #rrggbb', () => {
        const pairs = [{ light: '#efece4' }, { light: '#efece4', dark: 'black' }, { light: '#efece4', dark: '#0c0d10', auto: '#000000' }, ['#efece4', '#0c0d10']];
        for (const backgroundColor of pairs) {
            expect(() => appDarkBackgroundColor(config({ window: { backgroundColor } }))).toThrow('nor { light, dark } of two');
        }
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

    test('defines a title bar the page lies under', () => {
        expect(appHeader(config({ window: { titleBar: 'hidden' } }), 'darwin')).toContain('#define CROSSBIND_APP_WINDOW_TITLE_BAR_HIDDEN 1\n');
        expect(appHeader(config({ window: { titleBar: 'visible' } }), 'darwin')).not.toContain('TITLE_BAR');
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

    test('defines the dark background color on iOS alone, as a desktop shows the light one', () => {
        const app = { window: { backgroundColor: { light: '#EFECE4', dark: '#0C0D10' } } };
        expect(appHeader(config(app), 'ios')).toContain('#define CROSSBIND_APP_BACKGROUND_COLOR 0xefece4\n#define CROSSBIND_APP_BACKGROUND_COLOR_DARK 0x0c0d10\n');
        expect(appHeader(config(app), 'darwin')).toContain('#define CROSSBIND_APP_BACKGROUND_COLOR 0xefece4\n');
        expect(appHeader(config(app), 'darwin')).not.toContain('BACKGROUND_COLOR_DARK');
        expect(appHeader(config(app), 'android')).not.toContain('BACKGROUND_COLOR');
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

describe("an iPad app's windows", () => {
    test('open beside the first where app.ios.multipleWindows says so, which the iOS host is built with', () => {
        expect(iosMultipleWindows(config())).toBe(false);
        expect(iosMultipleWindows(config({ ios: { multipleWindows: true } }))).toBe(true);
        expect(appHeader(config({ ios: { multipleWindows: true } }), 'ios')).toContain('#define CROSSBIND_APP_IOS_MULTIPLE_WINDOWS 1\n');
        expect(appHeader(config(), 'ios')).not.toContain('MULTIPLE_WINDOWS');
        expect(appHeader(config({ ios: { multipleWindows: true } }), 'darwin')).not.toContain('MULTIPLE_WINDOWS');
    });

    test('are refused of any other value, naming what app.ios takes', () => {
        expect(() => iosMultipleWindows(config({ ios: true }))).toThrow('app.ios true is no object of multipleWindows and appGroup');
        expect(iosMultipleWindows(config({ ios: null }))).toBe(false);
        expect(() => iosMultipleWindows(config({ ios: { scenes: 2 } }))).toThrow('app.ios takes multipleWindows and appGroup; scenes is none of them');
        expect(() => iosMultipleWindows(config({ ios: { multipleWindows: 'yes' } }))).toThrow('app.ios.multipleWindows "yes" is no boolean');
    });
});

describe("an iOS app's App Group", () => {
    test('is group. and its id, unless app.ios.appGroup names another, which the iOS host is built with where a target asks for it', () => {
        expect(iosAppGroup(config({ id: 'com.example.notes' }))).toBe('group.com.example.notes');
        expect(iosAppGroup(config({ ios: { appGroup: 'group.com.example.shared' } }))).toBe('group.com.example.shared');
        expect(appHeader(config(), 'ios', 'group.com.example.notes')).toContain('#define CROSSBIND_APP_GROUP "group.com.example.notes"\n');
        expect(appHeader(config(), 'ios')).not.toContain('CROSSBIND_APP_GROUP');
    });

    test('is refused of a name that is no App Group', () => {
        expect(() => iosAppGroup(config({ ios: { appGroup: 'com.example.shared' } }))).toThrow('app.ios.appGroup "com.example.shared" is no App Group');
        expect(() => iosAppGroup(config({ ios: { appGroup: 'group.' } }))).toThrow('is no App Group');
    });
});
