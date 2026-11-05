import { describe, expect, test, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { config: {}, targets: [] } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: extensionsInApp } = await import('../src/actions/extensionsInApp.js');

const config = (app = {}, version = '1.2.3') => ({ general: { name: 'demo-app' }, app, package: { version } });

// What crossbind's own extensions take from the app's config on a platform, by their names, of those that enter the app.
function hostExtensionOptions(project, platform) {
    state.config = project;
    const listed = (project.extensions ?? []).map(({ name }) => name);
    return Object.fromEntries(extensionsInApp(platform).filter(({ name, options }) => options !== undefined && !listed.includes(name)).map(({ name, options }) => [name, options]));
}

// The names of those that enter an app of a platform.
function namesIn(project, platform) {
    state.config = project;
    return extensionsInApp(platform).map(({ name }) => name);
}

describe("the options crossbind's own extensions take from the app's config", () => {
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

    test('give the links, which hand the page the links of app.urlSchemes, to an app that lists any, on every platform', () => {
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
        expect(hostExtensionOptions(config(), 'darwin')).toEqual({ menu: {}, shell: { openPath: [] }, 'page-navigation': { load: [] } });
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
            expect(hostExtensionOptions(config({ id: 'com.example.demo' }), platform).menu).toEqual({});
        });
    });

    test("ask no platform for an id it has no use for, which that platform's rules might refuse", () => {
        expect(() => hostExtensionOptions(config({ id: 'com.example.my-app' }), 'android')).not.toThrow();
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

describe("crossbind's own extensions an app has", () => {
    test('are each that takes nothing from its config, and those of the others whose fromApp gives options', () => {
        expect(namesIn(config(), 'darwin')).toEqual([
            'dialog', 'menu', 'page-dialogs', 'page-downloads', 'page-drops', 'page-files', 'page-navigation', 'page-permissions', 'power', 'shell',
        ]);
        expect(namesIn(config({ urlSchemes: ['myapp'], singleInstance: true }), 'darwin')).toEqual([
            'dialog', 'instance', 'links', 'menu', 'page-dialogs', 'page-downloads', 'page-drops', 'page-files', 'page-navigation', 'page-permissions', 'power', 'shell',
        ]);
    });

    test("leave a key to the listed extension that takes every role of the one that reads it, whose fromApp does not run", () => {
        const acme = { name: 'acme-updater', root: '/acme', app: {}, replaces: ['updater'] };
        const project = { ...config({ updater: { url: 'http://example.com/u.json', publicKey: 'key' } }), extensions: [acme] };
        const names = namesIn(project, 'darwin');
        expect(names).toContain('acme-updater');
        expect(names).not.toContain('updater');
    });
});

describe('app.without', () => {
    test("leaves out of an app crossbind's own extensions it names", () => {
        const names = namesIn(config({ without: ['menu', 'power'] }), 'linux');
        expect(names).not.toContain('menu');
        expect(names).not.toContain('power');
        expect(names).toContain('dialog');
    });

    test("names crossbind's own extensions alone, each once", () => {
        expect(() => namesIn(config({ without: ['battery'] }), 'linux')).toThrow("crossbind: app.without names battery, which is none of crossbind's own extensions: activities, ");
        expect(() => namesIn(config({ without: 'menu' }), 'linux')).toThrow('crossbind: app.without "menu" is no list of crossbind\'s own extensions, each once:');
        expect(() => namesIn(config({ without: ['menu', 'menu'] }), 'linux')).toThrow('is no list of');
        expect(() => namesIn(config({ without: null }), 'linux')).toThrow('is no list of');
    });

    test('stops the build on a key of the app the one it leaves out reads, as nothing would honor it', () => {
        const updater = { url: 'https://example.com/{platform}-{arch}.json', publicKey: Buffer.alloc(32, 7).toString('base64') };
        expect(() => namesIn(config({ without: ['updater'], updater }), 'linux'))
            .toThrow('crossbind: app.without leaves out updater, which app.updater in crossbind.config.js needs: remove one of them.');
        expect(() => namesIn(config({ without: ['links'], urlSchemes: ['myapp'] }), 'ios')).toThrow('which app.urlSchemes in crossbind.config.js needs');
        expect(() => namesIn(config({ without: ['page-location'], permissions: { location: 'To map' } }), 'darwin')).toThrow('which app.permissions.location in crossbind.config.js needs');
        expect(namesIn(config({ without: ['page-location'], permissions: { camera: 'To scan' } }), 'darwin')).not.toContain('page-location');
        expect(() => namesIn(config({ without: ['page-permissions'], permissions: { camera: 'To scan' } }), 'linux')).toThrow('which app.permissions in crossbind.config.js needs');
    });

    test('takes an option that asks for nothing beside the one that reads it', () => {
        const apps = [
            { without: ['instance'], singleInstance: false }, { without: ['shell'], openPath: [] }, { without: ['links'], urlSchemes: [] },
            { without: ['page-navigation'], navigation: {} }, { without: ['updater'], updater: null },
        ];
        apps.forEach((app) => expect(namesIn(config(app), 'linux')).not.toContain(app.without[0]));
    });

    test('still lets an extension take the role of one it leaves out', () => {
        const acme = { name: 'acme-tray', root: '/acme', app: {}, replaces: ['tray'] };
        state.config = { ...config({ without: ['menu'] }), extensions: [acme] };
        const extensions = extensionsInApp('linux');
        expect(extensions.map(({ name }) => name)).not.toContain('menu');
        expect(extensions.find(({ name }) => name === 'acme-tray').roles).toEqual(['tray']);
    });
});
