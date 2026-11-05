import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
    appExtensionsOf, checkedExtension, checkedInstaller, checkedPublisher, extensionCmakeArgs, extensionPart, linuxDepends, listedExtension, mergedEntitlements,
    mergedPlist, mergedPrivacy, ownExtensions,
    registrationSource, withFromApp, withRoles, withoutNamed,
} from '../src/utils/appExtensions.js';

// crossbind's own that add to an app.
const hostExtensions = (root) => appExtensionsOf(ownExtensions(root));

const roots = [];

// A folder whose extensions/ holds these folders, each with the files it names.
function hostWith(extensions) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extensions-'));
    roots.push(root);
    Object.entries(extensions).forEach(([folder, { files = [] }]) => {
        const dir = path.join(root, 'extensions', folder);
        fs.mkdirSync(dir, { recursive: true });
        files.forEach((file) => {
            if (file.endsWith('/')) {
                fs.mkdirSync(path.join(dir, file), { recursive: true });
                return;
            }
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), '');
        });
    });
    return root;
}

// A value as JavaScript source: its JSON, with what could end a script or a line escaped.
const asSource = (value) => JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

// An app host whose package.json has these extensions as their packages among its dependencies, in its node_modules: each
// gives this descriptor, a publisher's or an installer's steps in place of true, or is this source.
function hostOf(extensions) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extensions-')));
    roots.push(root);
    const names = Object.keys(extensions).map((folder) => `@crossbind/extension-${folder}`);
    const dependencies = Object.fromEntries(['@crossbind/core-embind-jsi', ...names].map((name) => [name, '1.0.0']));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@crossbind/core-app-host', dependencies }));
    const written = ({ publisher, installer, ...data }) => {
        const role = publisher ? "publisher: { platform: 'android', upload() {} }" : installer ? "installer: { platform: 'windows', make() {} }" : '';
        return `export default () => ({ ${role}, root: import.meta.dirname, ...${asSource({ contract: 1, ...data })} });`.replace('{ , ', '{ ');
    };
    Object.entries(extensions).forEach(([folder, { json, files = [] }]) => {
        const dir = path.join(root, 'node_modules', '@crossbind', `extension-${folder}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', exports: { './crossbind.extension.js': './crossbind.extension.js' } }));
        fs.writeFileSync(path.join(dir, 'crossbind.extension.js'), typeof json === 'string' ? json : written(json));
        files.forEach((file) => {
            fs.mkdirSync(file.endsWith('/') ? path.join(dir, file) : path.dirname(path.join(dir, file)), { recursive: true });
            if (!file.endsWith('/')) fs.writeFileSync(path.join(dir, file), '');
        });
    });
    return root;
}

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

const DIALOG = {
    json: {
        name: 'dialog',
        app: {
            sources: ['native/dialog.cpp'],
            macos: { sources: ['native/darwin.mm'], frameworks: ['UniformTypeIdentifiers'] },
            windows: { sources: ['native/windows.cpp'], libraries: ['comctl32'] },
            android: { java: 'android/', class: 'dev.crossbind.extension.dialog.DialogExtension' },
        },
    },
    files: [
        'native/dialog.cpp', 'native/darwin.mm', 'native/windows.cpp', 'android/dev/crossbind/extension/dialog/DialogExtension.java',
        'android/AndroidManifest.xml', 'android/res/', 'third_party/LICENSE',
    ],
};

describe("an app host's own extensions", () => {
    test('are the extension packages among its dependencies, in order, each read from its crossbind.extension.js', () => {
        const root = hostOf({
            'secure-storage': { json: { name: 'secure-storage', app: { sources: ['store.cpp'] } }, files: ['store.cpp'] },
            dialog: DIALOG,
        });
        const extensions = hostExtensions(root);
        expect(extensions.map(({ name }) => name)).toEqual(['dialog', 'secure-storage']);
        expect(extensions[0].root).toBe(path.join(root, 'node_modules', '@crossbind', 'extension-dialog'));
        expect(extensions[0].app.macos.frameworks).toEqual(['UniformTypeIdentifiers']);
    });

    test('leave the publishers and the installers among those packages to the publish and the build', () => {
        const root = hostOf({
            dialog: DIALOG,
            store: { json: { name: 'store', publisher: true } },
            zip: { json: { name: 'zip', installer: true } },
        });
        expect(ownExtensions(root).map(({ name }) => name)).toEqual(['dialog', 'store', 'zip']);
        expect(hostExtensions(root).map(({ name }) => name)).toEqual(['dialog']);
    });

    test('keep one that adds to the app and installs what it makes as well', () => {
        const root = hostOf({ updater: { json: { name: 'updater', installer: true, app: { sources: ['updater.cpp'] } }, files: ['updater.cpp'] } });
        expect(hostExtensions(root).map(({ name, installer }) => [name, installer.platforms])).toEqual([['updater', ['windows']]]);
    });

    test("are written for this crossbind's extension contract, else name the app host to update", () => {
        const root = hostOf({ dialog: { json: { contract: undefined, name: 'dialog' } } });
        expect(() => hostExtensions(root)).toThrow(
            "crossbind: @crossbind/extension-dialog's crossbind.extension.js names no contract, the version of crossbind's extension contract it is written for, as contract: 1 is for this crossbind: update @crossbind/core-app-host to match crossbind.",
        );
        const newer = hostOf({ dialog: { json: { contract: 2, name: 'dialog' } } });
        expect(() => hostExtensions(newer)).toThrow("is written for crossbind's extension contract 2, newer than this crossbind's 1: update crossbind.");
    });

    test("of crossbind's own host are the activities', the dialog's, the files', the instance's, the links', the menu's, the page's dialogs, downloads, drops, files, location, navigation and permissions, the power's, the shell's, the shortcuts' and the updater's, which each platform's sources show", () => {
        const root = path.join(import.meta.dirname, '..', '..', 'app-host');
        const packages = path.join(root, '..', '..', 'extensions');
        // Those an app has only where its config asks for them, as these options say here.
        const asked = ['activities', 'files', 'instance', 'links', 'page-location', 'shortcuts', 'updater'];
        const appHostExtensions = (options) => hostExtensions(root).filter(({ name }) => !asked.includes(name) || Object.hasOwn(options, name));
        const sources = (platform, options = {}) => extensionPart(appHostExtensions(options), platform).sources
            .map((file) => path.relative(packages, file).split(path.sep).join('/').replace('/native/', '/'));
        const updater = { updater: { url: 'https://example.com/{platform}-{arch}.json' } };
        const updaterSources = ['updater/updater.cpp', 'updater/monocypher.cpp', 'updater/monocypher-ed25519.cpp'];
        const instance = { instance: { id: 'com.example.demo' } };
        const linuxMenu = ['menu/menu.cpp', 'menu/linux.cpp', 'menu/linux-tray.cpp', 'menu/linux-notifications.cpp'];
        expect(hostExtensions(root).map(({ name }) => name)).toEqual([
            'activities', 'dialog', 'files', 'instance', 'links', 'menu', 'page-dialogs', 'page-downloads', 'page-drops', 'page-files', 'page-location', 'page-navigation',
            'page-permissions', 'power', 'shell', 'shortcuts', 'updater',
        ]);
        expect(sources('linux', { files: {} })).toContain('files/files.cpp');
        expect(sources('linux')).not.toContain('files/files.cpp');
        const activities = { activities: { types: ['com.example.demo.edit'] } };
        ['ios', 'darwin'].forEach((platform) => expect(sources(platform, activities)).toEqual(['activities/apple.mm', ...sources(platform)]));
        ['ios', 'android'].forEach((platform) => expect(sources(platform, { shortcuts: {} })).toEqual([...sources(platform), 'shortcuts/shortcuts.cpp']));
        // A phone takes no drops of files.
        const page = (platform) => [
            'page-dialogs/dialogs.cpp', `page-dialogs/${platform}`, 'page-downloads/downloads.cpp', ...(platform === 'ios.mm' ? [] : ['page-drops/drops.cpp']),
            ...(platform === 'darwin.mm' ? ['page-files/darwin.mm'] : []), 'page-navigation/navigation.cpp', 'page-permissions/permissions.cpp',
        ];
        expect(sources('ios', { links: {} })).toEqual(['dialog/dialog.cpp', 'dialog/ios.mm', 'links/links.cpp', 'menu/menu.cpp', 'menu/ios.cpp', ...page('ios.mm'), 'shell/shell.cpp', 'shell/ios.mm']);
        expect(sources('darwin')).toEqual([
            'dialog/dialog.cpp', 'dialog/darwin.mm', 'menu/menu.cpp', 'menu/darwin.mm', ...page('darwin.mm'), 'power/power.cpp', 'power/darwin.mm', 'shell/shell.cpp',
            'shell/darwin.mm',
        ]);
        expect(sources('darwin', updater)).toEqual([...sources('darwin'), ...updaterSources, 'updater/darwin.mm']);
        expect(sources('darwin', { 'page-location': {} })).toEqual(sources('darwin').toSpliced(sources('darwin').indexOf('page-files/darwin.mm') + 1, 0, 'page-location/darwin.mm'));
        expect(sources('darwin', instance)).toEqual([
            'dialog/dialog.cpp', 'dialog/darwin.mm', 'instance/instance.cpp', 'instance/posix.cpp', 'menu/menu.cpp', 'menu/darwin.mm', ...page('darwin.mm'), 'power/power.cpp',
            'power/darwin.mm', 'shell/shell.cpp', 'shell/darwin.mm',
        ]);
        expect(sources('ios')).toEqual(['dialog/dialog.cpp', 'dialog/ios.mm', 'menu/menu.cpp', 'menu/ios.cpp', ...page('ios.mm'), 'shell/shell.cpp', 'shell/ios.mm']);
        expect(sources('linux', { ...instance, ...updater })).toEqual([
            'dialog/dialog.cpp', 'dialog/linux.cpp', 'instance/instance.cpp', 'instance/posix.cpp', ...linuxMenu, ...page('linux.cpp'), 'power/power.cpp', 'power/linux.cpp',
            'shell/shell.cpp', 'shell/linux.cpp', ...updaterSources, 'updater/linux.cpp',
        ]);
        expect(sources('win32', { ...instance, ...updater })).toEqual([
            'dialog/dialog.cpp', 'dialog/windows.cpp', 'instance/instance.cpp', 'instance/windows.cpp', 'menu/menu.cpp', 'menu/windows.cpp', ...page('windows.cpp'),
            'power/power.cpp', 'power/windows.cpp', 'shell/shell.cpp', 'shell/windows.cpp', ...updaterSources, 'updater/windows.cpp',
        ]);
        expect(sources('android')).toEqual([
            'dialog/dialog.cpp', 'dialog/android.cpp', 'menu/menu.cpp', 'menu/android.cpp', 'page-downloads/downloads.cpp', 'page-navigation/navigation.cpp', 'shell/shell.cpp',
            'shell/android.cpp',
        ]);
        expect(extensionPart(appHostExtensions({}), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications']);
        expect(extensionPart(appHostExtensions(updater), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications', 'Security']);
        expect(extensionPart(appHostExtensions({ 'page-location': {} }), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications', 'CoreLocation']);
        expect(extensionPart(appHostExtensions({}), 'win32').libraries).toEqual(['comctl32', 'shell32', 'ole32']);
        expect(extensionPart(appHostExtensions(updater), 'win32').libraries).toEqual(['comctl32', 'shell32', 'ole32', 'winhttp', 'wintrust', 'crypt32']);
        expect(extensionPart(appHostExtensions({}), 'android').java.map(({ className }) => className)).toEqual([
            'dev.crossbind.extension.dialog.DialogExtension', 'dev.crossbind.extension.pagedialogs.PageDialogsExtension', 'dev.crossbind.extension.pagefiles.PageFilesExtension',
            'dev.crossbind.extension.pagepermissions.PagePermissionsExtension',
        ]);
    });

    test('stop the build where its dependencies hold no extension package, as an older host keeps them in itself', () => {
        const root = hostOf({});
        expect(() => hostExtensions(root)).toThrow(`crossbind: the app host at ${root} brings no extensions: update @crossbind/core-app-host to match crossbind.`);
    });

    test('are named as their packages', () => {
        const root = hostOf({ dialogs: DIALOG });
        expect(() => hostExtensions(root)).toThrow("crossbind: @crossbind/extension-dialogs's crossbind.extension.js names the extension dialog, not dialogs as its package.");
    });

    // Of a name no install has, which the NODE_PATH pnpm's scripts run with finds nowhere either.
    test('stop the build on a crossbind.extension.js that cannot be read, saying which and what to do', () => {
        const root = hostOf({ unread: { json: 'export default (' } });
        expect(() => hostExtensions(root)).toThrow("crossbind: cannot read @crossbind/extension-unread's crossbind.extension.js");
        fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
        expect(() => hostExtensions(root)).toThrow("install the project's packages, or update @crossbind/core-app-host to match crossbind.");
    });
});

describe("what an extension says of crossbind's own host", () => {
    test('is the roles it holds and the options of the app it reads, as lists of names, each once', () => {
        const root = os.tmpdir();
        const checked = checkedExtension({ name: 'menu', holds: ['menu', 'tray'], reads: ['urlSchemes', 'permissions.location'] }, root, 'menu');
        expect(checked).toMatchObject({ holds: ['menu', 'tray'], reads: ['urlSchemes', 'permissions.location'] });
        expect(() => checkedExtension({ name: 'menu', holds: 'menu' }, root, 'menu')).toThrow("crossbind: menu's holds \"menu\" is no list of names, each once.");
        expect(() => checkedExtension({ name: 'menu', holds: ['menu', 'menu'] }, root, 'menu')).toThrow('is no list of names');
        expect(() => checkedExtension({ name: 'menu', reads: ['a b'] }, root, 'menu')).toThrow("crossbind: menu's reads [\"a b\"] is no list of names, each once.");
    });

    test('is no more than a fromApp, which is a function, or options, which it gives itself', () => {
        const root = os.tmpdir();
        expect(() => checkedExtension({ name: 'shell', fromApp: true }, root, 'shell')).toThrow("crossbind: shell's fromApp is no function.");
        expect(() => checkedExtension({ name: 'shell', fromApp: () => ({}), options: {} }, root, 'shell')).toThrow('gives options and a fromApp, which gives them too: one of them alone.');
    });
});

describe('the options an extension takes from the app', () => {
    const extension = (fromApp) => ({ name: 'demo', root: '/demo', app: {}, fromApp });

    test("are what its fromApp gives, from the api of its name, and leave it out where that is null", () => {
        const called = [];
        const taken = withFromApp([extension(({ name }) => { called.push(name); return { id: 1 }; }), { name: 'plain', root: '/plain', app: {} }, extension(() => null)], (name) => ({ name }));
        expect(taken.map(({ name, options }) => [name, options])).toEqual([['demo', { id: 1 }], ['plain', undefined]]);
        expect(called).toEqual(['demo']);
    });

    test('stop the build on what is no JSON value, as the host reads them as they are, and on a failure, naming the extension', () => {
        expect(() => withFromApp([extension(() => undefined)], () => ({}))).toThrow("crossbind: demo's fromApp gives no JSON value the host reads as it is, or null, which leaves it out of the app.");
        expect(() => withFromApp([extension(() => { throw new Error('broken'); })], () => ({}))).toThrow("crossbind: demo's fromApp failed: broken");
        expect(() => withFromApp([extension(() => { throw new Error('crossbind: app.demo is wrong.'); })], () => ({}))).toThrow(/^crossbind: app\.demo is wrong\.$/);
    });
});

describe('app.without', () => {
    test('leaves the rest as they are, and every one without it', () => {
        const own = [{ name: 'dialog' }, { name: 'menu' }];
        expect(withoutNamed(own)).toEqual(own);
        expect(withoutNamed(own, {})).toEqual(own);
        expect(withoutNamed(own, { without: ['menu'] })).toEqual([{ name: 'dialog' }]);
    });
});

describe('the extensions an app has', () => {
    const named = (name, root = `/host/${name}`, extra = {}) => ({ name, root, app: {}, ...extra });
    const rolesOf = (extensions) => extensions.map(({ name, roles, given }) => [name, roles, given]);
    const menu = named('menu', '/host/menu', { holds: ['menu', 'notification', 'tray'] });
    const pageNavigation = named('page-navigation', '/host/page-navigation', { holds: ['page-authentication', 'page-navigation'] });

    test("are the host's own, each with the roles it holds, then those listed, each with the roles it replaces", () => {
        const own = [named('dialog'), menu, pageNavigation];
        expect(rolesOf(withRoles(own, [named('clipboard', '/app/clipboard')]))).toEqual([
            ['dialog', ['dialog'], []], ['menu', ['menu', 'notification', 'tray'], []], ['page-navigation', ['page-authentication', 'page-navigation'], []],
            ['clipboard', [], []],
        ]);
    });

    test("leave out of the host's own the roles a listed one replaces, and the host's own that holds none then", () => {
        const own = [named('dialog'), menu, pageNavigation];
        const tray = named('acme-tray', '/app/tray', { replaces: ['tray'] });
        const browser = named('acme-browser', '/app/browser', { replaces: ['page-navigation', 'page-authentication'] });
        const dialog = named('acme-dialog', '/app/dialog', { replaces: ['dialog'] });
        expect(rolesOf(withRoles(own, [tray, browser, dialog]))).toEqual([
            ['menu', ['menu', 'notification'], ['tray']], ['acme-tray', ['tray'], []], ['acme-browser', ['page-navigation', 'page-authentication'], []],
            ['acme-dialog', ['dialog'], []],
        ]);
    });

    test('stop the build where two listed replace one role, naming both', () => {
        expect(() => withRoles([menu], [named('a-tray', '/a', { replaces: ['tray'] }), named('b-tray', '/b', { replaces: ['tray'] })]))
            .toThrow("crossbind: the extensions a-tray and b-tray both replace the host's tray, which one alone takes.");
    });

    test("take no replaces of a role none of the host's own holds, naming those they hold", () => {
        expect(() => withRoles([named('dialog'), menu], [named('acme-clipboard', '/a', { replaces: ['clipboard'] })]))
            .toThrow("crossbind: the extension acme-clipboard replaces clipboard, which is no role of the host's: it takes dialog, menu, notification, tray.");
    });

    test('take a role of one of the host\'s own that app.without leaves out, which they know of beside those the app keeps', () => {
        expect(rolesOf(withRoles([named('dialog')], [named('acme-tray', '/a', { replaces: ['tray'] })], () => {}, [named('dialog'), menu]))).toEqual([
            ['dialog', ['dialog'], []], ['acme-tray', ['tray'], []],
        ]);
    });

    test("take none named as a role another of the host's own holds, whose functions would clash", () => {
        expect(() => withRoles([menu], [named('tray', '/a')])).toThrow(
            "crossbind: the extension tray is named as the host's role tray, which its menu holds: name it as its package, as acme-tray, and give replaces: 'tray' to take the host's place.",
        );
    });

    test("let a listed one of the name of a host's own take its place, saying so, as one a later crossbind adds may have it", () => {
        const warnings = [];
        const merged = withRoles([named('dialog'), named('battery')], [named('battery', '/app/battery')], (message) => warnings.push(message));
        expect(merged.map(({ name, root }) => [name, root])).toEqual([['dialog', '/host/dialog'], ['battery', '/app/battery']]);
        expect(warnings).toEqual([
            "the extension battery that crossbind.config.js lists takes the place of the host's own battery: name it as its package, as acme-battery, to keep both",
        ]);
    });

    test("give a listed one that takes the place of a host's own by its name the roles that one held, but those another replaces", () => {
        expect(rolesOf(withRoles([menu], [named('menu', '/fork')]))).toEqual([['menu', ['menu', 'notification', 'tray'], []]]);
        expect(rolesOf(withRoles([menu], [named('menu', '/fork'), named('acme-tray', '/a', { replaces: ['tray'] })]))).toEqual([
            ['menu', ['menu', 'notification'], ['tray']], ['acme-tray', ['tray'], []],
        ]);
    });

    test("leave out those listed with a publisher or an installer alone, which leave the host's own of their name as it is", () => {
        const upload = async () => {};
        const store = { name: 'dialog', root: '/demo', app: {}, publisher: { upload } };
        const installer = { name: 'menu', root: '/demo', app: {}, installer: { make: () => [] } };
        const both = { name: 'demo-store', root: '/demo', app: { sources: ['store.cpp'] }, publisher: { upload } };
        const plain = { name: 'clipboard', root: '/demo', app: {} };
        expect(appExtensionsOf([store, installer, both, plain])).toEqual([both, plain]);
    });

    test('stop the build with two listed of one name, as any two of one name do', () => {
        const merged = withRoles([named('dialog')], [named('acme', '/a'), named('acme', '/b')]);
        expect(merged.map(({ root }) => root)).toEqual(['/host/dialog', '/a', '/b']);
        expect(() => extensionPart(merged, 'darwin')).toThrow('crossbind: the app has two extensions named acme.');
    });
});

describe('an extension', () => {
    const root = () => hostWith({ dialog: DIALOG }) && path.join(roots.at(-1), 'extensions', 'dialog');
    const check = (app, name = 'dialog') => () => checkedExtension({ name, app }, root(), 'dialog');

    test('is named in lowercase letters and digits, which dashes may join', () => {
        for (const name of ['Dialog', 'dialog_box', '-dialog', 'dialog-', '1dialog', '']) {
            expect(check({}, name)).toThrow('crossbind: dialog has no name of lowercase letters and digits, which dashes may join.');
        }
        expect(check({}, 'secure-storage2')).not.toThrow();
    });

    test('adds parts of the platforms an app builds for alone, each of what that platform takes', () => {
        expect(check({ web: {} })).toThrow("crossbind: dialog's app takes sources, includes, defines, files, urlSchemes, fileTypes, links, activityTypes, shortcutItems, licenses and macos, ios, linux, windows, android; web is none of them.");
        expect(check({ linux: { frameworks: ['Gtk'] } })).toThrow("crossbind: dialog's app.linux takes sources, includes, defines, files, libraries, packages, depends; frameworks is none of them.");
        expect(check({ android: { entitlements: {} } })).toThrow("crossbind: dialog's app.android takes sources, includes, defines, files, libraries, java, class, permissions, manifest, resources, maven, verification; entitlements is none of them.");
    });

    test("carries files and folders of its own, every platform's and each one's, which keep their places, and no link", () => {
        const dir = root();
        fs.mkdirSync(path.join(dir, 'models', 'eng'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'models', 'eng', 'eng.bin'), '');
        fs.writeFileSync(path.join(dir, 'words.txt'), '');
        const carry = (app) => () => checkedExtension({ name: 'dialog', app }, dir, 'dialog');

        expect(carry({ files: ['models/', 'words.txt'], android: { files: ['words.txt'] } })().app).toEqual({ files: ['models', 'words.txt'], android: { files: ['words.txt'] } });
        expect(carry({ files: 'models/' })).toThrow("crossbind: dialog's app.files is no list of the files and folders the extension carries.");
        expect(carry({ files: ['../outside.txt'] })).toThrow("crossbind: dialog's app.files names \"../outside.txt\", which is no path inside the extension's folder.");
        expect(carry({ ios: { files: ['missing.bin'] } })).toThrow("crossbind: dialog's app.ios.files names missing.bin, which is no file or folder of the extension's.");
        fs.symlinkSync(os.tmpdir(), path.join(dir, 'models', 'eng', 'keys'));
        expect(carry({ files: ['models/'] })).toThrow(`crossbind: dialog's app.files names models/, which holds the link ${path.join('models', 'eng', 'keys')}: an app carries no link, which could reach any file of the machine it is built on.`);
        expect(carry({ files: ['models/eng/keys/x'] })).toThrow("crossbind: dialog's app.files names models/eng/keys/x, which is no file or folder of the extension's.");
        const outside = root();
        fs.writeFileSync(path.join(outside, 'secret.txt'), '');
        fs.symlinkSync(outside, path.join(dir, 'home'));
        expect(carry({ files: ['home/secret.txt'] })).toThrow("crossbind: dialog's app.files names home/secret.txt, which a link leads out of the extension's folder: an app carries no link, which could reach any file of the machine it is built on.");
    });

    test("declares the schemes whose links its native code gets, by app.urlSchemes' rules", () => {
        expect(check({ urlSchemes: ['myapp.oauth'] })()).toMatchObject({ app: { urlSchemes: ['myapp.oauth'] } });
        expect(check({ urlSchemes: 'myapp' })).toThrow("crossbind: dialog's app.urlSchemes \"myapp\" is no list of schemes, as ['myapp'] is.");
        expect(check({ urlSchemes: ['MyApp'] })).toThrow("crossbind: dialog's app.urlSchemes takes schemes of a lowercase letter");
        expect(check({ urlSchemes: ['https'] })).toThrow("crossbind: dialog's app.urlSchemes cannot take https");
        expect(check({ urlSchemes: ['myapp', 'myapp'] })).toThrow("crossbind: dialog's app.urlSchemes lists a scheme twice");
    });

    test("declares the types of the user activities its native code continues, by app.activityTypes' rules", () => {
        expect(check({ activityTypes: ['com.example.notes.open'] })()).toMatchObject({ app: { activityTypes: ['com.example.notes.open'] } });
        expect(check({ activityTypes: 'com.example.notes.open' })).toThrow("crossbind: dialog's app.activityTypes \"com.example.notes.open\" is no list of user activity types");
        expect(check({ activityTypes: ['NSUserActivityTypeBrowsingWeb'] })).toThrow("crossbind: dialog's app.activityTypes cannot take NSUserActivityTypeBrowsingWeb");
    });

    test("declares the quick actions whose taps its native code gets, by app.shortcutItems' rules", () => {
        expect(check({ shortcutItems: [{ type: 'scan', title: 'Scan' }] })()).toMatchObject({ app: { shortcutItems: [{ type: 'scan', title: 'Scan', subtitle: null, icon: null }] } });
        expect(check({ shortcutItems: { type: 'scan' } })).toThrow("crossbind: dialog's app.shortcutItems {\"type\":\"scan\"} is no list of quick actions");
        expect(check({ shortcutItems: [{ type: 'scan' }] })).toThrow("crossbind: dialog's app.shortcutItems[0].title is no text, which the system shows.");
    });

    test("reaches its Java through one class in a package, whose source in Java or Kotlin its Java's folder holds", () => {
        const DIALOG_CLASS = 'dev.crossbind.extension.dialog.DialogExtension';
        for (const android of [{ java: 'android/' }, { class: DIALOG_CLASS }]) {
            expect(check({ android })).toThrow("crossbind: dialog's app.android takes java and class together: the folder of its Java and the Extension class in it the app calls.");
        }
        expect(check({ android: { java: 'android/', class: 'DialogExtension' } }))
            .toThrow("crossbind: dialog's app.android.class names DialogExtension, which is no Java class in a package.");
        const missing = path.join('android/', 'dev', 'crossbind', 'extension', 'dialog', 'Missing');
        expect(check({ android: { java: 'android/', class: 'dev.crossbind.extension.dialog.Missing' } }))
            .toThrow(`crossbind: dialog's app.android.class names dev.crossbind.extension.dialog.Missing, which has no source ${missing}.java or ${missing}.kt.`);
        expect(check({ android: { java: 'android/', class: DIALOG_CLASS } })).not.toThrow();
        const kotlin = root();
        fs.writeFileSync(path.join(kotlin, 'android', 'dev', 'crossbind', 'extension', 'dialog', 'KotlinExtension.kt'), '');
        expect(() => checkedExtension({ name: 'dialog', app: { android: { java: 'android/', class: 'dev.crossbind.extension.dialog.KotlinExtension' } } }, kotlin, 'dialog'))
            .not.toThrow();
    });

    test("takes a Linux part's Ubuntu packages by architecture, file and SHA-256, and the Debian packages the app needs", () => {
        const sha = '971297916405f1f184ec0ee5f18734b448a80b45813fe40ff2e00b77609689e7';
        expect(check({ linux: { packages: [`arm64 libzstd-dev_1.4.8+dfsg-3build1_arm64.deb ${sha}`, `amd64 tzdata_2024a-0ubuntu0.22.04_all.deb ${sha}`], depends: ['libzstd1 (>= 1.4)'] } }))
            .not.toThrow();
        for (const line of [`amd64 libzstd-dev_1.4.8_arm64.deb ${sha}`, `i386 libzstd-dev_1.4.8_i386.deb ${sha}`, 'amd64 libzstd-dev_1.4.8_amd64.deb abc', `amd64 ../evil_1_amd64.deb ${sha}`]) {
            expect(check({ linux: { packages: [line] } })).toThrow('which is no "<arch> <file> <sha256>" of an Ubuntu 22.04 package of amd64 or arm64');
        }
        expect(check({ linux: { depends: ['libzstd1; reboot'] } })).toThrow("crossbind: dialog's app.linux.depends is no list of the Debian packages the app needs");
        expect(check({ macos: { packages: [] } })).toThrow('packages is none of them');
    });

    test("takes an Android part's Maven libraries of one version each, with the verification metadata of their files", () => {
        const dir = root();
        fs.writeFileSync(path.join(dir, 'android', 'verification-metadata.xml'), '');
        const withMaven = (android) => () => checkedExtension({ name: 'dialog', app: { android } }, dir, 'dialog');
        expect(withMaven({ maven: ['javax.inject:javax.inject:1', 'androidx.core:core:1.13.1@aar'], verification: 'android/verification-metadata.xml' })).not.toThrow();
        for (const maven of [['javax.inject:javax.inject:1.+'], ['javax.inject:javax.inject'], 'javax.inject:javax.inject:1', ['javax.inject:javax.inject:[1,2)']]) {
            expect(withMaven({ maven, verification: 'android/verification-metadata.xml' }))
                .toThrow("crossbind: dialog's app.android.maven is no list of Maven libraries of one version each, as ['javax.inject:javax.inject:1'].");
        }
        expect(withMaven({ maven: ['javax.inject:javax.inject:1'] })).toThrow("crossbind: dialog's app.android takes maven and verification together");
        expect(withMaven({ verification: 'android/verification-metadata.xml' })).toThrow("crossbind: dialog's app.android takes maven and verification together");
    });

    test('compiles its own C++ everywhere, and Objective-C++ on Apple platforms alone', () => {
        expect(check({ sources: ['native/darwin.mm'] })).toThrow("crossbind: dialog's app.sources names native/darwin.mm, which is no C or C++ source.");
        expect(check({ linux: { sources: ['native/darwin.mm'] } })).toThrow("crossbind: dialog's app.linux.sources names native/darwin.mm, which is no C or C++ source.");
        expect(check({ ios: { sources: ['native/darwin.mm'] } })).not.toThrow();
        expect(check({ sources: ['native/missing.cpp'] })).toThrow("crossbind: dialog's app.sources names native/missing.cpp, which is no file of the extension's.");
        // A C source passes on every platform, and Objective-C on Apple's alone, where the file is there.
        expect(check({ sources: ['native/glue.c'] })).toThrow("crossbind: dialog's app.sources names native/glue.c, which is no file of the extension's.");
        expect(check({ linux: { sources: ['native/glue.m'] } })).toThrow('which is no C or C++ source.');
        expect(check({ macos: { sources: ['native/glue.m'] } })).toThrow("crossbind: dialog's app.macos.sources names native/glue.m, which is no file of the extension's.");
    });

    test('compiles with folders of its own its includes are found in, and with macros, every platform\'s and its own', () => {
        expect(check({ includes: ['native'], defines: ['DIALOG_LEGACY', 'DIALOG_LIMIT=10'], linux: { defines: ['DIALOG_GTK=3'] } })()).toMatchObject({
            app: { includes: ['native'], defines: ['DIALOG_LEGACY', 'DIALOG_LIMIT=10'], linux: { defines: ['DIALOG_GTK=3'] } },
        });
        expect(check({ includes: ['.'] })()).toMatchObject({ app: { includes: ['.'] } });
        expect(check({ includes: ['native/dialog.cpp'] })).toThrow("crossbind: dialog's app.includes names native/dialog.cpp, which is no folder of the extension's.");
        expect(check({ includes: ['../include'] })).toThrow("which is no path inside the extension's folder.");
        for (const defines of ['DIALOG=1', ['1DIALOG'], ['DIALOG=a b'], ['DIALOG="x"'], [42]]) {
            expect(check({ defines })).toThrow("crossbind: dialog's app.defines is no list of macros, each NAME or NAME=value, a value of letters, digits and _.+- alone.");
        }
    });

    test("gives an Apple app Info.plist keys, and an iOS app reasons for Apple's required reason API", () => {
        const plist = { NSContactsUsageDescription: 'To pick a contact', UIBackgroundModes: ['audio'], CrossbindDialogLimit: 3, CrossbindDialog: { isModal: true } };
        expect(check({ ios: { plist, privacy: { userDefaults: ['CA92.1'] } }, macos: { plist } })()).toMatchObject({
            app: { ios: { plist, privacy: { userDefaults: ['CA92.1'] } }, macos: { plist } },
        });
        for (const wrong of [null, [], { key: null }, { key: () => {} }, { '': 'x' }, { key: Number.NaN }, { key: [undefined] }, { key: 'a\u0001b' }, { 'a\u001fb': 'x' }]) {
            expect(check({ ios: { plist: wrong } })).toThrow("crossbind: dialog's app.ios.plist is no object of Info.plist keys, each with text, a number, a boolean, or a list or an object of them.");
        }
        expect(check({ macos: { privacy: {} } })).toThrow("crossbind: dialog's app.macos takes sources, includes, defines, files, frameworks, entitlements, plist; privacy is none of them.");
        expect(check({ ios: { privacy: { userDefaults: ['XXXX.1'] } } })).toThrow("crossbind: dialog's app.ios.privacy.userDefaults [\"XXXX.1\"] is no list of Apple's reasons for it");
        expect(check({ ios: { privacy: { clipboard: ['CA92.1'] } } })).toThrow("crossbind: dialog's app.ios.privacy takes fileTimestamp");
    });

    // The sources and resources of the iOS targets the tests below add, in the extension's folder.
    const withTargetFiles = () => {
        const dir = root();
        ['ios/widget/Clock.swift', 'ios/widget/Format.swift', 'ios/share/Share.swift', 'ios/notify/Service.h', 'ios/notify/Service.m', 'ios/content/Content.swift', 'ios/keys/Keys.swift', 'ios/widget/Info.plist'].forEach((file) => {
            fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
            fs.writeFileSync(path.join(dir, file), '');
        });
        fs.mkdirSync(path.join(dir, 'ios', 'widget', 'Assets.xcassets'), { recursive: true });
        return dir;
    };
    const TARGETS = [
        {
            name: 'clock', kind: 'widget', sources: ['ios/widget/Clock.swift', 'ios/widget/Format.swift'], resources: ['ios/widget/Assets.xcassets'],
            displayName: 'Clock', appGroup: true, deploymentTarget: '17.0', privacy: { userDefaults: ['1C8F.1'] }, frameworks: ['WidgetKit'],
            plist: { CrossbindClockStyle: 'digital' }, entitlements: { 'com.apple.developer.weatherkit': true },
        },
        { name: 'share', kind: 'share', sources: ['ios/share/Share.swift'], principalClass: 'ShareViewController', activation: { images: 10, urls: 1, text: true } },
        { name: 'notify', kind: 'notification-service', sources: ['ios/notify/Service.m'], principalClass: 'NotificationService' },
        { name: 'invite', kind: 'notification-content', sources: ['ios/content/Content.swift'], principalClass: 'ContentController', categories: ['invite'] },
        {
            name: 'keys', kind: 'other', sources: ['ios/keys/Keys.swift'], extensionPoint: 'com.apple.keyboard-service', principalClass: 'KeyboardViewController',
            attributes: { IsASCIICapable: true, PrimaryLanguage: 'en-US' },
        },
    ];

    test("adds Apple's app extensions to an iOS app as targets of their own, each with its own sources and what its kind takes", () => {
        const dir = withTargetFiles();
        const extension = checkedExtension({ name: 'dialog', app: { ios: { targets: TARGETS } } }, dir, 'dialog');

        expect(extension.app.ios.targets).toEqual(TARGETS);
        const [clock, ...others] = extensionPart([{ ...extension, root: dir }], 'ios').targets;
        expect(clock).toEqual({ ...TARGETS[0], owner: 'dialog', root: dir });
        expect(others.map(({ name, owner }) => [name, owner])).toEqual([['share', 'dialog'], ['notify', 'dialog'], ['invite', 'dialog'], ['keys', 'dialog']]);
        expect(extensionPart([{ ...extension, root: dir }], 'android').targets).toEqual([]);
    });

    test('refuses an iOS target that is no app extension crossbind makes, naming what is wrong', () => {
        const dir = withTargetFiles();
        const targets = (value) => () => checkedExtension({ name: 'dialog', app: { ios: { targets: value } } }, dir, 'dialog');
        const target = (fields) => targets([{ ...TARGETS[0], ...fields }]);
        const at = "crossbind: dialog's app.ios.targets[0]";

        expect(targets({ clock: {} })).toThrow("crossbind: dialog's app.ios.targets is no list of targets, as [{ name: 'clock', kind: 'widget', sources: ['ios/Clock.swift'] }] is.");
        expect(targets([TARGETS[1], TARGETS[1]])).toThrow("crossbind: dialog's app.ios.targets names two targets share.");
        expect(targets([7])).toThrow(`${at} is no object of a target.`);
        expect(target({ color: 'red' })).toThrow(`${at} takes name, kind, sources, resources, displayName, plist, entitlements, frameworks, privacy, appGroup, deploymentTarget, principalClass, activation, categories, extensionPoint, attributes; color is none of them.`);
        expect(target({ name: 'Clock' })).toThrow(`${at}.name "Clock" is no name of lowercase letters and digits, which dashes may join.`);
        expect(target({ kind: 'watch' })).toThrow(`${at}.kind "watch" is none of widget, share, notification-service, notification-content, other.`);
        expect(target({ sources: [] })).toThrow(`${at} has no sources, which a target compiles alone.`);
        expect(target({ sources: ['ios/widget/Missing.swift'] })).toThrow(`${at}.sources names ios/widget/Missing.swift, which is no file of the extension's.`);
        expect(target({ sources: ['ios/notify/Service.m'] })).toThrow(`${at} is a widget, whose SwiftUI needs a Swift source among its sources.`);
        expect(target({ resources: ['ios/widget/Missing.png'] })).toThrow(`${at}.resources names ios/widget/Missing.png, which is no file or folder of the extension's.`);
        expect(target({ activation: { images: 1 } })).toThrow(`${at}, a widget target, takes no activation.`);
        expect(targets([{ ...TARGETS[1], activation: undefined }])).toThrow(`${at}, a share target, has no activation: what of the share sheet's items it takes, as { images: 10 }.`);
        expect(targets([{ ...TARGETS[1], activation: { everything: true } }])).toThrow(`${at}.activation is no object of attachments, files, images, movies, text, urls, webPages, each a count from 1 and text true, as { images: 10, urls: 1 } is.`);
        expect(targets([{ ...TARGETS[1], activation: {} }])).toThrow(`${at}.activation is no object of attachments`);
        expect(targets([{ ...TARGETS[2], principalClass: undefined }])).toThrow(`${at}, a notification-service target, has no principalClass: the class iOS makes as it starts the target.`);
        expect(targets([{ ...TARGETS[2], principalClass: 'Module.Service' }])).toThrow(`${at}.principalClass "Module.Service" is no class name.`);
        expect(targets([{ ...TARGETS[3], categories: [] }])).toThrow(`${at}.categories is no list of the notification categories the target shows.`);
        expect(targets([{ ...TARGETS[4], extensionPoint: undefined }])).toThrow(`${at}, an other target, has no extensionPoint: the extension point iOS runs it at, as com.apple.keyboard-service.`);
        expect(targets([{ ...TARGETS[4], extensionPoint: 'com.apple.appintents-extension' }])).toThrow(`${at}.extensionPoint com.apple.appintents-extension is ExtensionKit's, whose extensions crossbind makes none of yet.`);
        expect(targets([{ ...TARGETS[2], sources: ['ios/notify/Service.h'] }])).toThrow(`${at} has no sources, which a target compiles alone.`);
        expect(targets([{ ...TARGETS[2], sources: ['ios/notify/Service.m', 'ios/notify/Service.txt'] }])).toThrow(`${at}.sources names ios/notify/Service.txt, which is no C, C++, Objective-C, Objective-C++ or Swift source, nor a header.`);
        expect(target({ resources: ['ios/widget/Info.plist'] })).toThrow(`${at}.resources names ios/widget/Info.plist, a file crossbind writes into the target's bundle.`);
        expect(target({ entitlements: { 'com.apple.security.application-groups': 'group.x' } })).toThrow(`${at}.entitlements.com.apple.security.application-groups is no list, which crossbind joins with the app's.`);
        expect(() => checkedExtension({ name: 'dialog', app: { ios: { entitlements: { 'com.apple.developer.associated-domains': 'applinks:x' } } } }, dir, 'dialog'))
            .toThrow("crossbind: dialog's app.ios.entitlements.com.apple.developer.associated-domains is no list, which crossbind joins with the app's.");
        expect(targets([{ ...TARGETS[4], extensionPoint: 'keyboard' }])).toThrow(`${at}.extensionPoint "keyboard" is no extension point, as com.apple.keyboard-service is.`);
        expect(targets([{ ...TARGETS[1], attributes: { NSExtensionActivationRule: 'TRUEPREDICATE' } }])).toThrow(`${at}.attributes gives NSExtensionActivationRule, which crossbind writes from the target's activation.`);
        expect(targets([{ ...TARGETS[3], attributes: { UNNotificationExtensionCategory: 'other' } }])).toThrow(`${at}.attributes gives UNNotificationExtensionCategory, which crossbind writes from the target's categories.`);
        expect(target({ deploymentTarget: '14.0' })).toThrow(`${at}.deploymentTarget 14.0 is below the app's iOS 15.1, which each of its targets runs on as well.`);
        expect(target({ deploymentTarget: 'latest' })).toThrow(`${at}.deploymentTarget "latest" is no iOS version, as '17.0' is.`);
        expect(target({ appGroup: 'yes' })).toThrow(`${at}.appGroup is no boolean.`);
        expect(target({ displayName: '' })).toThrow(`${at}.displayName is no name the system shows.`);
        expect(target({ plist: { CFBundleIdentifier: 'x' } })).toThrow(`${at}.plist gives CFBundleIdentifier, which crossbind writes for each target.`);
        expect(() => checkedExtension({ name: 'dialog', app: { macos: { targets: TARGETS } } }, dir, 'dialog')).toThrow("crossbind: dialog's app.macos takes sources, includes, defines, files, frameworks, entitlements, plist; targets is none of them.");
    });

    test("lets an other target give the attributes of its point, as an action's activation rule, and a target headers beside its sources", () => {
        const dir = withTargetFiles();
        const action = { ...TARGETS[4], extensionPoint: 'com.apple.ui-services', attributes: { NSExtensionActivationRule: { NSExtensionActivationSupportsImageWithMaxCount: 1 } } };
        const service = { ...TARGETS[2], sources: ['ios/notify/Service.h', 'ios/notify/Service.m'] };
        expect(checkedExtension({ name: 'dialog', app: { ios: { targets: [action, service] } } }, dir, 'dialog').app.ios.targets).toEqual([action, service]);
    });

    test('stop the build where two name one iOS target, naming both', () => {
        const dir = withTargetFiles();
        const extension = (name) => ({ ...checkedExtension({ name, app: { ios: { targets: [TARGETS[0]] } } }, dir, name), root: dir });
        expect(() => extensionPart([extension('dialog'), extension('weather')], 'ios')).toThrow('crossbind: the extensions dialog and weather both name an iOS target clock.');
    });

    test('gives an Android app the permissions it asks for, a manifest of its own and its resources', () => {
        const android = { permissions: ['android.permission.READ_CONTACTS'], manifest: 'android/AndroidManifest.xml', resources: 'android/res' };
        expect(check({ android })()).toMatchObject({ app: { android } });
        for (const permissions of ['android.permission.CAMERA', ['CAMERA'], ['android.permission.'], [7]]) {
            expect(check({ android: { permissions } })).toThrow("crossbind: dialog's app.android.permissions is no list of Android permissions, each by its full name, as android.permission.READ_CONTACTS.");
        }
        expect(check({ android: { manifest: 'android/res' } })).toThrow("crossbind: dialog's app.android.manifest names android/res, which is no file of the extension's.");
        expect(check({ android: { resources: 'android/AndroidManifest.xml' } })).toThrow("crossbind: dialog's app.android.resources names android/AndroidManifest.xml, which is no folder of the extension's.");
    });

    test("lists the code of others it carries, with the file of its license's text", () => {
        const vendored = { name: 'tinyexpr', version: '1.0.0', license: 'Zlib', file: 'third_party/LICENSE', source: 'https://github.com/codeplea/tinyexpr' };
        const pinned = { ...vendored, name: 'other', sha256: 'a'.repeat(64) };
        expect(check({ licenses: [vendored, pinned] })()).toMatchObject({ app: { licenses: [vendored, pinned] } });
        expect(check({ licenses: [{ ...vendored, license: '' }] })).toThrow("crossbind: dialog's app.licenses[0] is no code the extension carries: { name, version, license, file }");
        expect(check({ licenses: [{ ...vendored, url: 'x' }] })).toThrow("crossbind: dialog's app.licenses[0] takes name, version, license, file, source, sha256, notes; url is none of them.");
        expect(check({ licenses: [{ ...vendored, file: 'third_party/MISSING' }] })).toThrow("crossbind: dialog's app.licenses[0].file names third_party/MISSING, which is no file of the extension's.");
        expect(check({ licenses: [{ ...vendored, sha256: 'ABC' }] })).toThrow("crossbind: dialog's app.licenses[0].sha256 is no SHA-256, in 64 lowercase hex digits.");
        expect(check({ licenses: vendored })).toThrow("crossbind: dialog's app.licenses is no list of the code of others the extension carries.");
    });

    test('names no path outside its folder', () => {
        for (const file of ['../dialog.cpp', '/etc/dialog.cpp', 'native/../../dialog.cpp']) {
            expect(check({ sources: [file] })).toThrow(`crossbind: dialog's app.sources names ${JSON.stringify(file)}, which is no path inside the extension's folder.`);
        }
        expect(check({ android: { java: '..' } })).toThrow("which is no path inside the extension's folder.");
        expect(check({ android: { java: 'native/dialog.cpp' } })).toThrow("crossbind: dialog's app.android.java names native/dialog.cpp, which is no folder of the extension's.");
    });

    test('links frameworks and libraries by name, and claims entitlements of values Apple takes', () => {
        expect(check({ windows: { libraries: ['-lcomctl32'] } })).toThrow("crossbind: dialog's app.windows.libraries is no list of names.");
        expect(check({ macos: { frameworks: 'AppKit' } })).toThrow("crossbind: dialog's app.macos.frameworks is no list of names.");
        expect(check({ ios: { entitlements: { 'aps-environment': 1 } } }))
            .toThrow("crossbind: dialog's app.ios.entitlements is no object of entitlements, each a boolean, a string or a list of strings.");
        expect(check({ ios: { entitlements: { 'aps-environment': 'development', 'keychain-access-groups': ['$(AppIdentifierPrefix)demo'] } } })).not.toThrow();
    });
});

describe('an extension crossbind.config.js lists', () => {
    const project = () => {
        const base = hostWith({ clipboard: { json: {}, files: ['native/clipboard.cpp'] } });
        return { base, root: path.join(base, 'extensions', 'clipboard') };
    };

    test('is its name, the folder its files are in and what it adds to an app', () => {
        const { base, root } = project();
        expect(listedExtension({ contract: 1, name: 'clipboard', root, app: { sources: ['native/clipboard.cpp'] } }, 'extensions[0]', base))
            .toEqual({ name: 'clipboard', root, app: { sources: ['native/clipboard.cpp'] } });
        expect(() => listedExtension({ contract: 1, name: 'clipboard', root, app: { sources: ['native/missing.cpp'] } }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0]'s app.sources names native/missing.cpp, which is no file of the extension's.");
    });

    test("refuses the hooks of crossbind's build, which no build runs, and anything but its name, root, app, options, publisher and installer", () => {
        const { base, root } = project();
        expect(() => listedExtension({ loadConfig: { after: () => {} }, buildWasm: {} }, 'extensions[0]', base)).toThrow(
            'crossbind: extensions[0] has the hooks loadConfig, buildWasm, which crossbind no longer runs: an extension adds native code to an app. Set build flags in targetSpecs or crossbind.build.js.',
        );
        expect(() => listedExtension({ contract: 1, name: 'clipboard', root, app: {}, version: 1 }, 'extensions[0]', base))
            .toThrow('crossbind: extensions[0] takes name, contract, root, app, options, fromApp, publisher, installer, commands, replaces; version is none of them.');
        expect(() => listedExtension('clipboard', 'extensions[0]', base))
            .toThrow("crossbind: extensions[0] is no extension, as an extension package's crossbind.extension.js gives one.");
    });

    test('takes options of JSON values alone, which its native code reads back as they are', () => {
        const { base, root } = project();
        const extension = { name: 'clipboard', root, app: { sources: ['native/clipboard.cpp'] } };
        const nested = (levels) => (levels === 0 ? 'deep' : [nested(levels - 1)]);
        expect(listedExtension({ contract: 1, ...extension, options: { limit: 10, kinds: ['text'], none: null } }, 'extensions[0]', base))
            .toEqual({ ...extension, options: { limit: 10, kinds: ['text'], none: null } });
        expect(listedExtension({ contract: 1, ...extension, options: nested(64) }, 'extensions[0]', base).options).toEqual(nested(64));
        const refused = [() => {}, { limit: Number.NaN }, { when: new Date(0) }, [undefined], { limit: undefined }, nested(65), ['\ud800'], { '\udc00': 1 }];
        for (const options of refused) {
            expect(() => listedExtension({ contract: 1, ...extension, options }, 'extensions[0]', base)).toThrow(
                "crossbind: extensions[0]'s options are no JSON value the host reads as it is: plain objects, arrays, strings, finite numbers, booleans and null alone, 64 levels deep at most, without a lone surrogate.",
            );
        }
    });

    test("is crossbind's clipboard as its package gives it, its Java and each platform's source its own", async () => {
        const { default: clipboard } = await import('../../../extensions/clipboard/crossbind.extension.js');
        const listed = listedExtension(clipboard(), 'extensions[0]', path.join(import.meta.dirname, '..', '..', '..'));
        const sources = (platform) => extensionPart([listed], platform).sources.map((file) => path.basename(file));
        expect(sources('darwin')).toEqual(['clipboard.cpp', 'darwin.mm']);
        expect(sources('ios')).toEqual(['clipboard.cpp', 'ios.mm']);
        expect(sources('linux')).toEqual(['clipboard.cpp', 'linux.cpp']);
        expect(sources('win32')).toEqual(['clipboard.cpp', 'windows.cpp']);
        expect(sources('android')).toEqual(['clipboard.cpp', 'android.cpp']);
        expect(extensionPart([listed], 'android').java.map(({ className }) => className)).toEqual(['dev.crossbind.extension.clipboard.ClipboardExtension']);
    });

    test("takes no name crossbind keeps for itself, and replaces the roles of the host's it names", () => {
        const { base, root } = project();
        const extension = { contract: 1, root, app: {} };
        for (const name of ['events', 'app', 'windows', 'crossbind', 'page-custom']) {
            expect(() => listedExtension({ ...extension, name }, 'extensions[0]', base))
                .toThrow(`crossbind: extensions[0] is named ${name}, which crossbind keeps for itself: name it as its package, as acme-${name}.`);
        }
        expect(listedExtension({ ...extension, name: 'acme-tray', replaces: 'tray' }, 'extensions[0]', base).replaces).toEqual(['tray']);
        expect(listedExtension({ ...extension, name: 'acme-browser', replaces: ['page-navigation', 'page-downloads'] }, 'extensions[0]', base).replaces)
            .toEqual(['page-navigation', 'page-downloads']);
        for (const replaces of [[], ['tray', 'tray'], 7]) {
            expect(() => listedExtension({ ...extension, name: 'acme-tray', replaces }, 'extensions[0]', base))
                .toThrow("crossbind: extensions[0]'s replaces is no role of the host's, or list of them.");
        }
    });

    test("names its folder by an absolute path, under the project's base, which every build sees", () => {
        const { base, root } = project();
        for (const folder of [undefined, 'extensions/clipboard', path.join(root, 'native', 'clipboard.cpp'), path.join(base, 'missing')]) {
            expect(() => listedExtension({ contract: 1, name: 'clipboard', root: folder }, 'extensions[0]', base))
                .toThrow('crossbind: extensions[0] has no root, the absolute path of the folder its files are in.');
        }
        const other = path.join(base, 'other');
        expect(() => listedExtension({ contract: 1, name: 'clipboard', root }, 'extensions[0]', other))
            .toThrow(`crossbind: extensions[0]'s root ${root} is outside ${other}, the project's base and all a build sees.`);
    });

    test("is written for this crossbind's extension contract, else names what to update", () => {
        const { base, root } = project();
        const extension = { name: 'clipboard', root, app: {} };
        expect(() => listedExtension(extension, 'extensions[0]', base)).toThrow(
            "crossbind: extensions[0] names no contract, the version of crossbind's extension contract it is written for, as contract: 1 is for this crossbind: update it to a version written for this crossbind.",
        );
        expect(() => listedExtension({ ...extension, contract: 2 }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0] is written for crossbind's extension contract 2, newer than this crossbind's 1: update crossbind.");
        // A newer contract may give keys this crossbind does not know, and an app part of a new shape.
        expect(() => listedExtension({ ...extension, contract: 2, hooks: {}, app: { swift: ['a.swift'] } }, 'extensions[0]', base))
            .toThrow('newer than this crossbind\'s 1: update crossbind.');
        for (const contract of ['1', [], [1, 1], [0], 1.5]) {
            expect(() => listedExtension({ ...extension, contract }, 'extensions[0]', base))
                .toThrow(`crossbind: extensions[0]'s contract ${JSON.stringify(contract)} is no version of crossbind's extension contract, as 1 or [1, 2] is.`);
        }
        // One written for several builds where this crossbind takes one of them.
        expect(listedExtension({ ...extension, contract: [1, 2] }, 'extensions[0]', base).name).toBe('clipboard');
        expect(() => listedExtension({ ...extension, contract: [2, 3] }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0] is written for crossbind's extension contract 2 and 3, newer than this crossbind's 1: update crossbind.");
        fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: '@acme/extension-clipboard', crossbind: { extension: './crossbind.extension.js' } }));
        expect(() => listedExtension(extension, 'extensions[0]', base)).toThrow(': update @acme/extension-clipboard to a version written for this crossbind.');
    });
});

describe("an extension's publisher", () => {
    const upload = async () => {};
    const checked = (publisher) => checkedPublisher({ upload, ...publisher }, 'extensions[0].publisher');

    test('takes apps of its platforms, desktop for the three, with its options, steps and the store it names', () => {
        const publisher = {
            platform: ['android', 'desktop', 'linux'],
            store: 'Demo Store',
            options: { track: { help: 'the track', value: '<track>', default: 'beta' }, draft: { help: 'a draft' } },
            check() {
                return { session: this.store };
            },
            upload,
        };
        const result = checkedPublisher(publisher, 'extensions[0].publisher');
        expect(result).toMatchObject({
            platforms: ['android', 'macos', 'linux', 'windows'],
            store: 'Demo Store',
            options: { track: { help: 'the track', value: '<track>', default: 'beta' }, draft: { help: 'a draft', value: null, default: null } },
            after: null,
        });
        expect(result.check()).toEqual({ session: 'Demo Store' });
        expect(checked({ platform: 'ios' })).toMatchObject({ platforms: ['ios'], store: null, options: {} });
    });

    test('refuses what it does not take, a step that is no function, and a publisher without an upload', () => {
        expect(() => checked({ platform: 'ios', publish: upload })).toThrow('crossbind: extensions[0].publisher takes platform, isDefault, store, options, after, build, check, buildNumber, buildEnv, upload; publish is none of them.');
        expect(() => checked({ platform: 'web' })).toThrow('crossbind: extensions[0].publisher.platform is no platform or list of them, of android, ios, macos, linux, windows, desktop.');
        expect(() => checked({ platform: [] })).toThrow('is no platform or list of them');
        expect(() => checked({ platform: 'ios', check: 'yes', buildEnv: {} })).toThrow("crossbind: extensions[0].publisher's check and buildEnv are no function.");
        expect(() => checkedPublisher({ platform: 'ios' }, 'extensions[0].publisher')).toThrow('crossbind: extensions[0].publisher has no upload, the step that sends the app to its store.');
        expect(() => checked({ platform: 'ios', after: 'GitHub' })).toThrow('crossbind: extensions[0].publisher.after is no name of a publisher.');
    });

    test('that comes after another takes no build of its own', () => {
        expect(() => checked({ platform: 'macos', after: 'github', build: () => ({}), buildEnv: () => ({}) }))
            .toThrow('crossbind: extensions[0].publisher comes after github, whose build it publishes from, so it takes no build or buildEnv.');
        expect(checked({ platform: 'macos', after: 'github' }).after).toBe('github');
    });

    test("names its options as JavaScript does, but the command's own, each a flag or one that takes a value", () => {
        expect(() => checked({ platform: 'ios', options: { platform: { help: 'p' } } })).toThrow('crossbind: extensions[0].publisher.options names platform, which is no option of its own: one of letters and digits, starting with a lowercase letter, but platform, help and version.');
        expect(() => checked({ platform: 'ios', options: { version: { help: 'v', value: '<version>' } } })).toThrow('names version, which is no option of its own');
        expect(() => checked({ platform: 'ios', options: { 'release-notes': { help: 'n' } } })).toThrow('names release-notes, which is no option of its own');
        expect(() => checked({ platform: 'ios', options: { mode: { help: 'm', value: '<mode>' } } })).toThrow(
            "crossbind: extensions[0].publisher.options names mode, which is an option of the Vite build the publish runs, the command line's --mode: name it otherwise.",
        );
        expect(() => checked({ platform: 'ios', options: { logLevel: { help: 'l', value: '<level>' } } })).toThrow("the command line's --log-level: name it otherwise.");
        // The dev server's alone, which no publish runs.
        expect(checked({ platform: 'ios', options: { open: { help: 'o' }, port: { help: 'p', value: '<port>' } } }).options).toMatchObject({ open: { help: 'o' }, port: { help: 'p' } });
        expect(() => checked({ platform: 'ios', options: { track: 'beta' } })).toThrow('crossbind: extensions[0].publisher.options.track is no option, which is { help } for a flag and { help, value } for one that takes a value.');
        expect(() => checked({ platform: 'ios', options: { track: { help: 't', type: 'string' } } })).toThrow('crossbind: extensions[0].publisher.options.track takes help, value, default; type is none of them.');
        expect(() => checked({ platform: 'ios', options: { draft: { help: 'd', default: 'yes' } } })).toThrow('crossbind: extensions[0].publisher.options.draft.default is no value of an option that takes one');
    });

    test('is checked with the extension crossbind.config.js lists, beside its app', () => {
        const base = hostWith({ store: { json: {} } });
        const root = path.join(base, 'extensions', 'store');
        const listed = listedExtension({ contract: 1, name: 'demo-store', root, publisher: { platform: 'android', upload } }, 'extensions[0]', base);
        expect(listed).toMatchObject({ name: 'demo-store', root, app: {}, publisher: { platforms: ['android'] } });
        expect(() => listedExtension({ contract: 1, name: 'demo-store', root, publisher: { platform: 'android' } }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0]'s publisher has no upload");
    });
});

describe("an extension's installer", () => {
    const make = () => ['demo.AppImage'];
    const checked = (installer) => checkedInstaller({ make, ...installer }, 'extensions[0].installer');

    test('makes what installs apps of its desktop platforms, desktop for the three, with steps that keep it as their this', () => {
        const installer = {
            platform: ['linux', 'desktop'],
            check() {
                return this.platform;
            },
            make() {
                return [`demo-${this.platform[0]}.AppImage`];
            },
        };
        const result = checkedInstaller(installer, 'extensions[0].installer');
        expect(result.platforms).toEqual(['linux', 'macos', 'windows']);
        expect([result.check(), result.make()]).toEqual([['linux', 'desktop'], ['demo-linux.AppImage']]);
        expect(checked({ platform: 'macos' })).toEqual({ platforms: ['macos'], make: expect.any(Function) });
    });

    test('refuses what it does not take, a platform that is no desktop one, a step that is no function, and an installer without a make', () => {
        expect(() => checked({ platform: 'linux', kind: 'AppImage' })).toThrow('crossbind: extensions[0].installer takes platform, isLast, licenses, check, make; kind is none of them.');
        expect(() => checked({ platform: 'android' })).toThrow('crossbind: extensions[0].installer.platform is no platform or list of them, of macos, linux, windows, desktop.');
        expect(() => checked({ platform: 'linux', isLast: 'yes', make() {} })).toThrow('crossbind: extensions[0].installer.isLast is no boolean.');
        expect(() => checked({})).toThrow('is no platform or list of them');
        expect(() => checked({ platform: 'linux', check: true })).toThrow("crossbind: extensions[0].installer's check is no function.");
        expect(() => checkedInstaller({ platform: 'linux' }, 'extensions[0].installer')).toThrow('crossbind: extensions[0].installer has no make, the step that makes what installs the app.');
        expect(() => checkedInstaller('deb', 'extensions[0].installer')).toThrow('crossbind: extensions[0].installer is no object.');
    });

    test('is checked with the extension crossbind.config.js lists, beside its app and its publisher', () => {
        const base = hostWith({ appimage: { json: {} } });
        const root = path.join(base, 'extensions', 'appimage');
        const listed = listedExtension({ contract: 1, name: 'appimage', root, installer: { platform: 'linux', make } }, 'extensions[0]', base);
        expect(listed).toMatchObject({ name: 'appimage', root, app: {}, installer: { platforms: ['linux'] } });
        expect(() => listedExtension({ contract: 1, name: 'appimage', root, installer: { platform: 'linux' } }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0]'s installer has no make");
    });
});

describe("an extension's commands", () => {
    const checked = (commands) => checkedExtension({ name: 'tool', commands }, os.tmpdir(), 'extensions[0]').commands;
    const run = () => {};

    test('are each its help, its options, as a publisher takes them, and what runs it', () => {
        const commands = checked({
            'make-key': { help: 'makes a key', run },
            hello: { help: 'says hello', run, options: { to: { help: 'whom', value: '<name>', default: 'you' }, loud: { help: 'louder' }, mode: { help: 'not the Vite option here' } } },
        });
        expect(Object.keys(commands)).toEqual(['make-key', 'hello']);
        expect(commands['make-key']).toMatchObject({ help: 'makes a key', options: {} });
        expect(commands.hello.options).toEqual({
            to: { help: 'whom', value: '<name>', default: 'you' }, loud: { help: 'louder', value: null, default: null }, mode: { help: 'not the Vite option here', value: null, default: null },
        });
        expect(checkedExtension({ name: 'tool' }, os.tmpdir(), 'extensions[0]')).not.toHaveProperty('commands');
    });

    test('keep the object as the this of what runs them', () => {
        const command = { help: 'says hello', run() { return this.help; } };
        expect(checked({ hello: command }).hello.run()).toBe('says hello');
    });

    test('are refused where they are not so', () => {
        const at = "crossbind: extensions[0]'s commands";
        expect(() => checked('hello')).toThrow(`${at} is no object of commands, as { 'my-key': { help, run } }.`);
        expect(() => checked({ Hello: { help: 'h', run } })).toThrow(`${at} names Hello, which is no command of lowercase letters and digits, which dashes may join.`);
        expect(() => checked({ hello: 'run' })).toThrow(`${at}.hello is no command, which is { help, run }.`);
        expect(() => checked({ hello: { help: 'h', run, about: 'x' } })).toThrow(`${at}.hello takes help, options, run; about is none of them.`);
        expect(() => checked({ hello: { run } })).toThrow(`${at}.hello has no help, its line in crossbind app --help.`);
        expect(() => checked({ hello: { help: 'h' } })).toThrow(`${at}.hello has no run, the step that does its work.`);
        expect(() => checked({ hello: { help: 'h', run, options: 'x' } })).toThrow(`${at}.hello.options is no object of options.`);
        expect(() => checked({ hello: { help: 'h', run, options: { help: { help: 'x' } } } })).toThrow('which is no option of its own');
    });
});

describe("what an app's extensions add on a platform", () => {
    const extensions = () => {
        const root = hostOf({
            dialog: DIALOG,
            push: {
                json: {
                    name: 'push',
                    app: {
                        macos: { frameworks: ['UniformTypeIdentifiers', 'UserNotifications'], entitlements: { 'aps-environment': 'development' } },
                        ios: { sources: ['ios.mm'], entitlements: { 'aps-environment': 'development' } },
                        windows: { libraries: ['comctl32', 'runtimeobject'] },
                    },
                },
                files: ['ios.mm'],
            },
        });
        return hostExtensions(root);
    };

    test('is the sources of each, every platform\'s first, by their full paths, and what it links, each once', () => {
        const all = extensions();
        const [dialog] = all;
        const darwin = extensionPart(all, 'darwin');
        expect(darwin.native).toEqual([{ name: 'dialog', options: null, roles: [], given: [] }]);
        expect(darwin.roots).toEqual([dialog.root]);
        expect(darwin.sources).toEqual([path.join(dialog.root, 'native/dialog.cpp'), path.join(dialog.root, 'native/darwin.mm')]);
        expect(darwin.frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications']);
        expect(extensionPart(all, 'win32').libraries).toEqual(['comctl32', 'runtimeobject']);
        expect(extensionPart(all, 'ios').native.map(({ name }) => name)).toEqual(['dialog', 'push']);
        expect(extensionPart(all, 'linux').sources).toEqual([path.join(dialog.root, 'native/dialog.cpp')]);
    });

    test("is the files each carries on the platform, every platform's first, by the folder they come from", () => {
        const root = hostOf({
            models: { json: { name: 'models', app: { files: ['data/'], ios: { files: ['ios.bin'] } } }, files: ['data/', 'ios.bin'] },
            plain: { json: { name: 'plain', app: { sources: ['plain.cpp'] } }, files: ['plain.cpp'] },
        });
        const all = hostExtensions(root);
        expect(extensionPart(all, 'ios').files).toEqual([{ name: 'models', root: all[0].root, paths: ['data', 'ios.bin'] }]);
        expect(extensionPart(all, 'darwin').files).toEqual([{ name: 'models', root: all[0].root, paths: ['data'] }]);
    });

    test("is an Android app's Java folders with their classes and an Apple app's entitlements, by their owners", () => {
        const all = extensions();
        expect(extensionPart(all, 'android').java).toEqual([
            { name: 'dialog', dir: path.join(all[0].root, 'android/'), className: 'dev.crossbind.extension.dialog.DialogExtension', roles: [] },
        ]);
        expect(extensionPart(all, 'ios').entitlements).toEqual([['the extension push', { 'aps-environment': 'development' }]]);
        expect(extensionPart(all, 'linux').entitlements).toEqual([]);
    });

    test("is each extension's sources, folders of includes and macros, which the host's CMake project gets of each", () => {
        const all = extensions();
        const [dialog] = all;
        const withMacros = [{ ...dialog, app: { ...dialog.app, includes: ['native'], defines: ['DIALOG_LIMIT=10'], linux: { defines: ['DIALOG_GTK=3'] } } }];
        const { compiled } = extensionPart(withMacros, 'linux');
        expect(compiled).toEqual([{
            name: 'dialog', sources: [path.join(dialog.root, 'native/dialog.cpp')], swift: [], packages: [], includes: [path.join(dialog.root, 'native')], defines: ['DIALOG_LIMIT=10', 'DIALOG_GTK=3'],
        }]);
        expect(extensionCmakeArgs([...compiled, { name: 'page-dialogs', sources: ['/x/a.cpp', '/x/b.mm'], includes: [], defines: [] }])).toEqual([
            '-DCROSSBIND_EXTENSIONS=dialog;page_dialogs',
            `-DCROSSBIND_EXTENSION_dialog_SOURCES=${path.join(dialog.root, 'native/dialog.cpp')}`,
            `-DCROSSBIND_EXTENSION_dialog_INCLUDES=${path.join(dialog.root, 'native')}`,
            '-DCROSSBIND_EXTENSION_dialog_DEFINES=DIALOG_LIMIT=10;DIALOG_GTK=3',
            '-DCROSSBIND_EXTENSION_page_dialogs_SOURCES=/x/a.cpp;/x/b.mm',
            '-DCROSSBIND_EXTENSION_page_dialogs_INCLUDES=',
            '-DCROSSBIND_EXTENSION_page_dialogs_DEFINES=',
        ]);
        expect(extensionCmakeArgs([])).toEqual(['-DCROSSBIND_EXTENSIONS=']);
    });

    test("compiles an Apple part's Swift apart from the sources whose C++ holds the extension's entry", () => {
        const [dialog] = extensions();
        const withSwift = (macos) => [{ ...dialog, app: { ...dialog.app, macos } }];
        const [compiled] = extensionPart(withSwift({ sources: ['native/darwin.mm', 'native/store.swift'] }), 'darwin').compiled;
        expect(compiled.sources).toEqual([path.join(dialog.root, 'native/dialog.cpp'), path.join(dialog.root, 'native/darwin.mm')]);
        expect(compiled.swift).toEqual([path.join(dialog.root, 'native/store.swift')]);
        const swiftAlone = [{ ...dialog, app: { macos: { sources: ['native/store.swift'] } } }];
        expect(() => extensionPart(swiftAlone, 'darwin'))
            .toThrow('crossbind: the extension dialog has Swift alone on macos, whose entry, crossbind_extension_dialog, a C++ or Objective-C++ source of its own defines.');
    });

    test("unpacks a Linux part's pinned Ubuntu packages for its sources, and gives the app's package what they need", () => {
        const [dialog] = extensions();
        const zstd = ['amd64 libzstd-dev_1.4.8+dfsg-3build1_amd64.deb 971297916405f1f184ec0ee5f18734b448a80b45813fe40ff2e00b77609689e7'];
        const withPackages = [{ ...dialog, app: { ...dialog.app, linux: { packages: zstd, depends: ['libzstd1'] } } }];
        expect(extensionPart(withPackages, 'linux').compiled[0].packages).toEqual(zstd);
        expect(extensionPart(withPackages, 'darwin').compiled[0].packages).toEqual([]);
        expect(linuxDepends([...withPackages, { ...dialog, name: 'other', app: { linux: { depends: ['libzstd1', 'libsecret-1-0 (>= 0.20.5) | libsecret-1-1'] } } }]))
            .toEqual(['libzstd1', 'libsecret-1-0 (>= 0.20.5) | libsecret-1-1']);
    });

    test("is each Android part's Maven libraries, with the verification metadata of their files, which the app's Gradle project takes", () => {
        const [dialog] = extensions();
        const android = { ...dialog.app.android, maven: ['javax.inject:javax.inject:1'], verification: 'android/verification-metadata.xml' };
        expect(extensionPart([{ ...dialog, app: { ...dialog.app, android } }], 'android').maven).toEqual([
            { name: 'dialog', coordinates: ['javax.inject:javax.inject:1'], verification: path.join(dialog.root, 'android/verification-metadata.xml') },
        ]);
        expect(extensionPart([dialog], 'android').maven).toEqual([]);
    });

    test('stops at two extensions of one name', () => {
        const all = extensions();
        expect(() => extensionPart([...all, all[0]], 'linux')).toThrow('crossbind: the app has two extensions named dialog.');
    });
});

describe('entitlements', () => {
    test('merge, one value each, in the order they are claimed', () => {
        expect(mergedEntitlements([
            ['app.permissions', { 'com.apple.security.device.camera': true }],
            ['the extension push', { 'aps-environment': 'production', 'com.apple.security.device.camera': true }],
        ])).toEqual({ 'com.apple.security.device.camera': true, 'aps-environment': 'production' });
        expect(mergedEntitlements([])).toEqual({});
    });

    test('stop the build where two owners give one different values, naming both', () => {
        expect(() => mergedEntitlements([
            ['the extension push', { 'aps-environment': 'production' }],
            ['the extension debug', { 'aps-environment': 'development' }],
        ])).toThrow('crossbind: the extension push and the extension debug give the entitlement aps-environment different values.');
    });

    test("join two owners' lists, as of the domains each serves", () => {
        expect(mergedEntitlements([
            ['the extension links', { 'com.apple.developer.associated-domains': ['applinks:example.com'] }],
            ['the extension auth', { 'com.apple.developer.associated-domains': ['webcredentials:example.com', 'applinks:example.com'] }],
        ])).toEqual({ 'com.apple.developer.associated-domains': ['applinks:example.com', 'webcredentials:example.com'] });
    });
});

describe("an Apple app's Info.plist and an iOS app's privacy reasons", () => {
    test("take each extension's keys, lists joined, and a key crossbind writes alone where its value is the same", () => {
        const base = { CFBundleIdentifier: 'com.example.demo', NSCameraUsageDescription: 'To scan' };
        expect(mergedPlist(base, [
            ['the extension audio', { UIBackgroundModes: ['audio'], NSCameraUsageDescription: 'To scan' }],
            ['the extension fetch', { UIBackgroundModes: ['fetch', 'audio'], NSContactsUsageDescription: 'To pick' }],
        ])).toEqual({ ...base, UIBackgroundModes: ['audio', 'fetch'], NSContactsUsageDescription: 'To pick' });
        expect(() => mergedPlist(base, [['the extension scan', { NSCameraUsageDescription: 'To read codes' }]]))
            .toThrow("crossbind: the extension scan gives the Info.plist key NSCameraUsageDescription, which crossbind writes from the app's config.");
        expect(() => mergedPlist(base, [['the extension a', { LSUIElement: true }], ['the extension b', { LSUIElement: false }]]))
            .toThrow('crossbind: the extension a and the extension b give the Info.plist key LSUIElement different values.');
        expect(mergedPlist(base, [])).toEqual(base);
    });

    test("join each category's reasons, app.privacy's first", () => {
        expect(mergedPrivacy({ fileTimestamp: ['C617.1'] }, [['the extension store', { userDefaults: ['CA92.1'], fileTimestamp: ['C617.1', '3B52.1'] }]]))
            .toEqual({ fileTimestamp: ['C617.1', '3B52.1'], userDefaults: ['CA92.1'] });
    });

    test("are an extension's on the platform it gives them for, with an Android app's permissions, manifests and resources", () => {
        const share = {
            name: 'share',
            root: '/ext/share',
            app: {
                ios: { plist: { NSContactsUsageDescription: 'To pick' }, privacy: { userDefaults: ['CA92.1'] } },
                android: { permissions: ['android.permission.READ_CONTACTS'], manifest: 'android/AndroidManifest.xml', resources: 'android/res' },
            },
        };
        const ios = extensionPart([share], 'ios');
        expect([ios.plist, ios.privacy, ios.permissions]).toEqual([
            [['the extension share', { NSContactsUsageDescription: 'To pick' }]], [['the extension share', { userDefaults: ['CA92.1'] }]], [],
        ]);
        const android = extensionPart([share], 'android');
        expect(android).toMatchObject({
            plist: [],
            permissions: ['android.permission.READ_CONTACTS'],
            manifests: [{ name: 'share', file: path.join('/ext/share', 'android/AndroidManifest.xml') }],
            resources: [{ name: 'share', dir: path.join('/ext/share', 'android/res') }],
        });
    });
});

describe("the host's registration of its extensions", () => {
    const HEAD = `// crossbind writes this file from the app's extensions: the entry of each one with native code, which starts it with
// its options, the roles of the host's it holds and those it gave an app's extension, and the owner of each of the
// app's URL schemes, file types, their MIME types, links, user activity types and quick actions, the extension that
// gets them.
#include "crossbind/extension.h"
`;
    const NO_OWNERS = `std::vector<std::pair<std::string, std::string>> urlSchemes() {
    return {};
}

std::vector<std::pair<std::string, std::string>> fileTypes() {
    return {};
}

std::vector<std::pair<std::string, std::string>> fileMimeTypes() {
    return {};
}

std::vector<std::pair<std::string, std::string>> appLinks() {
    return {};
}

std::vector<std::pair<std::string, std::string>> userActivityTypes() {
    return {};
}

std::vector<std::pair<std::string, std::string>> shortcutItemTypes() {
    return {};
}`;

    test('starts each extension with native code through its entry, with its options', () => {
        expect(registrationSource([{ name: 'dialog', options: null, roles: ['dialog'] }, { name: 'secure-storage', options: { openPath: ['logs'] }, roles: [] }], [])).toBe(`${HEAD}
void crossbind_extension_dialog(crossbind::Registry &registry);
void crossbind_extension_secure_storage(crossbind::Registry &registry);

namespace crossbind::app {

void startExtension(const char *name, const char *options, void (*entry)(Registry &), std::vector<std::string> roles,
    std::vector<std::string> given);

void extensionEntries() {
    startExtension("dialog", nullptr, crossbind_extension_dialog, {"dialog"}, {});
    startExtension("secure-storage", R"crossbind_json({"openPath":["logs"]})crossbind_json", crossbind_extension_secure_storage, {}, {});
}

${NO_OWNERS}

}  // namespace crossbind::app
`);
        expect(() => registrationSource([{ name: 'odd', options: { text: ')crossbind_json' } }], []))
            .toThrow('crossbind: the extension odd\'s options hold )crossbind_json", which ends the text the host reads them from.');
    });

    test("names each URL scheme's owner: the extension that declared it, or the holder of the links' role for those of app.urlSchemes", () => {
        const native = [{ name: 'links', options: null, roles: ['links'] }, { name: 'oauth', options: null, roles: [], given: [] }];
        const source = registrationSource(native, [{ scheme: 'myapp', extension: null }, { scheme: 'myapp.oauth', extension: 'oauth' }]);
        expect(source).toContain('    return {{"myapp", "links"}, {"myapp.oauth", "oauth"}};\n');
        const replaced = registrationSource([{ name: 'acme-links', options: null, roles: ['links'] }], [{ scheme: 'myapp', extension: null }]);
        expect(replaced).toContain('    return {{"myapp", "acme-links"}};\n');
        expect(replaced).toContain('    startExtension("acme-links", nullptr, crossbind_extension_acme_links, {"links"}, {});\n');
        // The host's own that gave a role keeps its others, and leaves the functions and hooks of the one it gave.
        const menu = registrationSource([{ name: 'menu', options: null, roles: ['menu', 'notification'], given: ['tray'] }], []);
        expect(menu).toContain('    startExtension("menu", nullptr, crossbind_extension_menu, {"menu", "notification"}, {"tray"});\n');
    });

    test("names the owner of each file type's extension and each link: the extension that declared it, or the host's files or links", () => {
        const native = [{ name: 'files', options: null }, { name: 'links', options: null }, { name: 'maps', options: null }];
        const source = registrationSource(native, [], [
            { name: 'GeoJSON', extensions: ['geojson', 'geo'], extension: null }, { name: 'KML', extensions: ['kml'], extension: 'maps' },
        ], [{ link: 'example.com', extension: null }, { link: 'example.com/map', extension: 'maps' }]);
        expect(source).toContain('fileTypes() {\n    return {{"geojson", "files"}, {"geo", "files"}, {"kml", "maps"}};\n');
        expect(source).toContain('appLinks() {\n    return {{"example.com", "links"}, {"example.com/map", "maps"}};\n');
        expect(() => registrationSource([{ name: 'links', options: null }], [], [{ name: 'KML', extensions: ['kml'], extension: 'maps' }]))
            .toThrow('crossbind: the extension maps gets the files .kml, but has no native code on this platform.');
        expect(() => registrationSource([], [], [], [{ link: 'example.com', extension: null }]))
            .toThrow('crossbind: the extension links gets the links of example.com, but has no native code on this platform.');
    });

    test("names each user activity type's owner: the extension that declared it, or the host's activities for those of app.activityTypes", () => {
        const native = [{ name: 'activities', options: null }, { name: 'notes', options: null }];
        const source = registrationSource(native, [], [], [], [{ type: 'com.example.app.edit', extension: null }, { type: 'com.example.notes.open', extension: 'notes' }]);
        expect(source).toContain('userActivityTypes() {\n    return {{"com.example.app.edit", "activities"}, {"com.example.notes.open", "notes"}};\n');
        expect(() => registrationSource([], [], [], [], [{ type: 'com.example.app.edit', extension: null }]))
            .toThrow('crossbind: the extension activities gets the user activities com.example.app.edit, but has no native code on this platform.');
    });

    test("names each quick action's owner: the extension that declared it, or the host's shortcuts for those of app.shortcutItems", () => {
        const native = [{ name: 'shortcuts', options: null }, { name: 'scanner', options: null }];
        const source = registrationSource(native, [], [], [], [], [{ type: 'new-note', extension: null }, { type: 'scan', extension: 'scanner' }]);
        expect(source).toContain('shortcutItemTypes() {\n    return {{"new-note", "shortcuts"}, {"scan", "scanner"}};\n');
        expect(() => registrationSource([], [], [], [], [], [{ type: 'scan', extension: 'scanner' }]))
            .toThrow('crossbind: the extension scanner gets the quick action scan, but has no native code on this platform.');
    });

    test("names the owner of each MIME type one owner's types alone list, which names an Android file's before its name", () => {
        const native = [{ name: 'files', options: null }, { name: 'maps', options: null }];
        const source = registrationSource(native, [], [
            { name: 'GeoJSON', extensions: ['geojson'], mimeTypes: ['application/geo+json', 'application/json'], extension: null },
            { name: 'Map JSON', extensions: ['mapjson'], mimeTypes: ['application/geo+json'], extension: null },
            { name: 'KML', extensions: ['kml'], mimeTypes: ['application/vnd.google-earth.kml+xml', 'application/json'], extension: 'maps' },
        ]);
        expect(source).toContain('fileMimeTypes() {\n    return {{"application/geo+json", "files"}, {"application/vnd.google-earth.kml+xml", "maps"}};\n');
    });

    test('refuses a scheme whose owner has no native code to get its links', () => {
        expect(() => registrationSource([{ name: 'dialog', options: null }], [{ scheme: 'myapp.oauth', extension: 'oauth' }]))
            .toThrow('crossbind: the extension oauth gets the links of myapp.oauth, but has no native code on this platform.');
        expect(() => registrationSource([{ name: 'dialog', options: null }], [{ scheme: 'myapp', extension: null }]))
            .toThrow('crossbind: the extension links gets the links of myapp, but has no native code on this platform.');
    });

    test('starts nothing without them', () => {
        expect(registrationSource([], [])).toBe(`${HEAD}
namespace crossbind::app {

void startExtension(const char *name, const char *options, void (*entry)(Registry &), std::vector<std::string> roles,
    std::vector<std::string> given);

void extensionEntries() {
}

${NO_OWNERS}

}  // namespace crossbind::app
`);
    });
});
