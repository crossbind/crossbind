import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
    appExtensionsOf, appHostExtensions, checkedExtension, checkedInstaller, checkedPublisher, extensionCmakeArgs, extensionPart, hostExtensions, listedExtension, mergedEntitlements,
    mergedPlist, mergedPrivacy,
    registrationSource, withListed, withOptions,
} from '../src/utils/appExtensions.js';

const roots = [];

// An app host whose extensions/ holds these folders, each its extension.json and the files it names.
function hostWith(extensions) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extensions-'));
    roots.push(root);
    Object.entries(extensions).forEach(([folder, { json, files = [] }]) => {
        const dir = path.join(root, 'extensions', folder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'extension.json'), typeof json === 'string' ? json : JSON.stringify({ contract: 1, ...json }));
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
    test('are the folders of its extensions/, in order, each read from its extension.json', () => {
        const root = hostWith({
            dialog: DIALOG,
            'secure-storage': { json: { name: 'secure-storage', app: { sources: ['store.cpp'] } }, files: ['store.cpp'] },
        });
        fs.mkdirSync(path.join(root, 'extensions', 'notes'));
        const extensions = hostExtensions(root);
        expect(extensions.map(({ name }) => name)).toEqual(['dialog', 'secure-storage']);
        expect(extensions[0].root).toBe(path.join(root, 'extensions', 'dialog'));
        expect(extensions[0].app.macos.frameworks).toEqual(['UniformTypeIdentifiers']);
    });

    test("are written for this crossbind's extension contract, else name the app host to update", () => {
        const root = hostWith({ dialog: { json: { contract: undefined, name: 'dialog' } } });
        expect(() => hostExtensions(root)).toThrow(
            `crossbind: ${path.join(root, 'extensions', 'dialog', 'extension.json')} names no contract, the version of crossbind's extension contract it is written for, as contract: 1 is for this crossbind: update @crossbind/core-app-host to match crossbind.`,
        );
        const newer = hostWith({ dialog: { json: { contract: 2, name: 'dialog' } } });
        expect(() => hostExtensions(newer)).toThrow("is written for crossbind's extension contract 2, newer than this crossbind's 1: update crossbind.");
    });

    test("of crossbind's own host are the dialog's, the instance's, the links', the menu's, the page's dialogs, files, location and permissions, the power's, the shell's and the updater's, which each platform's sources show", () => {
        const root = path.join(import.meta.dirname, '..', '..', 'app-host');
        const sources = (platform, options = {}) => extensionPart(appHostExtensions(root, options), platform).sources
            .map((file) => path.relative(path.join(file, '..', '..'), file));
        const updater = { updater: { url: 'https://example.com/{platform}-{arch}.json' } };
        const updaterSources = ['updater/updater.cpp', 'updater/monocypher.cpp', 'updater/monocypher-ed25519.cpp'];
        const instance = { instance: { id: 'com.example.demo' } };
        const linuxMenu = ['menu/menu.cpp', 'menu/linux.cpp', 'menu/linux-tray.cpp', 'menu/linux-notifications.cpp'];
        expect(hostExtensions(root).map(({ name }) => name)).toEqual([
            'dialog', 'instance', 'links', 'menu', 'page-dialogs', 'page-files', 'page-location', 'page-permissions', 'power', 'shell', 'updater',
        ]);
        const page = (platform) => ['page-dialogs/dialogs.cpp', `page-dialogs/${platform}`, ...(platform === 'darwin.mm' ? ['page-files/darwin.mm'] : []), 'page-permissions/permissions.cpp'];
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
        expect(sources('android')).toEqual(['dialog/dialog.cpp', 'dialog/android.cpp', 'menu/menu.cpp', 'menu/android.cpp', 'shell/shell.cpp', 'shell/android.cpp']);
        expect(extensionPart(appHostExtensions(root, {}), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications']);
        expect(extensionPart(appHostExtensions(root, updater), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications', 'Security']);
        expect(extensionPart(appHostExtensions(root, { 'page-location': {} }), 'darwin').frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications', 'CoreLocation']);
        expect(extensionPart(appHostExtensions(root, {}), 'win32').libraries).toEqual(['comctl32', 'shell32', 'ole32']);
        expect(extensionPart(appHostExtensions(root, updater), 'win32').libraries).toEqual(['comctl32', 'shell32', 'ole32', 'winhttp', 'wintrust', 'crypt32']);
        expect(extensionPart(appHostExtensions(root, {}), 'android').java.map(({ className }) => className)).toEqual([
            'dev.crossbind.extension.dialog.DialogExtension', 'dev.crossbind.extension.pagedialogs.PageDialogsExtension', 'dev.crossbind.extension.pagefiles.PageFilesExtension',
            'dev.crossbind.extension.pagepermissions.PagePermissionsExtension',
        ]);
    });

    test("give an app the instance, the links, the page's location and the updater only where the app's options give them, as an app's do that keeps one instance, lists app.urlSchemes, lists the location on macOS or has app.updater", () => {
        const root = path.join(import.meta.dirname, '..', '..', 'app-host');
        const updater = { url: 'https://example.com/{platform}-{arch}.json', publicKey: 'key', version: '1.2.3', id: 'com.example.demo' };
        const instance = { id: 'com.example.demo' };
        expect(appHostExtensions(root, { shell: { openPath: [] } }).map(({ name }) => name)).toEqual(['dialog', 'menu', 'page-dialogs', 'page-files', 'page-permissions', 'power', 'shell']);
        expect(appHostExtensions(root, {
            instance, links: {}, 'page-location': {}, shell: { openPath: [] }, updater,
        }).map(({ name, options }) => [name, options])).toEqual([
            ['dialog', undefined], ['instance', instance], ['links', {}], ['menu', undefined], ['page-dialogs', undefined], ['page-files', undefined],
            ['page-location', {}], ['page-permissions', undefined], ['power', undefined], ['shell', { openPath: [] }], ['updater', updater],
        ]);
    });

    test("take the options the app's give them by their own names alone", () => {
        const extensions = hostExtensions(path.join(import.meta.dirname, '..', '..', 'app-host'));
        const named = withOptions(extensions, { shell: { openPath: ['data'] } });
        expect(named[0]).toBe(extensions[0]);
        expect(extensionPart(named, 'darwin').native).toEqual([
            { name: 'dialog', options: null }, { name: 'instance', options: null }, { name: 'links', options: null }, { name: 'menu', options: null },
            { name: 'page-dialogs', options: null }, { name: 'page-files', options: null }, { name: 'page-location', options: null },
            { name: 'page-permissions', options: null }, { name: 'power', options: null }, { name: 'shell', options: { openPath: ['data'] } }, { name: 'updater', options: null },
        ]);
        expect(withOptions([{ name: 'constructor' }], {})).toEqual([{ name: 'constructor' }]);
    });

    test('are none where the host has no extensions/', () => {
        expect(hostExtensions(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extensions-')))).toEqual([]);
    });

    test('are named as their folders', () => {
        const root = hostWith({ dialogs: DIALOG });
        const file = path.join(root, 'extensions', 'dialogs', 'extension.json');
        expect(() => hostExtensions(root)).toThrow(`crossbind: ${file} names the extension dialog, not dialogs as its folder.`);
    });

    test('stop the build on an extension.json that is no JSON, saying which', () => {
        const root = hostWith({ dialog: { json: '{ "name": ' } });
        expect(() => hostExtensions(root)).toThrow(`crossbind: cannot read the extension ${path.join(root, 'extensions', 'dialog', 'extension.json')}`);
    });
});

describe('the extensions an app has', () => {
    const named = (name, root = `/host/${name}`) => ({ name, root, app: {} });

    test("are the host's own, then those listed, one listed under the name of one of the host's in its place", () => {
        const own = [named('dialog'), named('menu'), named('shell')];
        const shell = named('shell', '/app/my-shell');
        const clipboard = named('clipboard', '/app/clipboard');
        expect(withListed(own, [clipboard, shell])).toEqual([own[0], own[1], shell, clipboard]);
        expect(withListed(own, [])).toEqual(own);
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
        const merged = withListed([named('dialog')], [named('dialog', '/a'), named('dialog', '/b')]);
        expect(merged.map(({ root }) => root)).toEqual(['/a', '/b']);
        expect(() => extensionPart(merged, 'darwin')).toThrow('crossbind: the app has two extensions named dialog.');
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
        expect(check({ web: {} })).toThrow("crossbind: dialog's app takes sources, includes, defines, urlSchemes, licenses and macos, ios, linux, windows, android; web is none of them.");
        expect(check({ linux: { frameworks: ['Gtk'] } })).toThrow("crossbind: dialog's app.linux takes sources, includes, defines, libraries; frameworks is none of them.");
        expect(check({ android: { entitlements: {} } })).toThrow("crossbind: dialog's app.android takes sources, includes, defines, libraries, java, class, permissions, manifest, resources; entitlements is none of them.");
    });

    test("declares the schemes whose links its native code gets, by app.urlSchemes' rules", () => {
        expect(check({ urlSchemes: ['myapp.oauth'] })()).toMatchObject({ app: { urlSchemes: ['myapp.oauth'] } });
        expect(check({ urlSchemes: 'myapp' })).toThrow("crossbind: dialog's app.urlSchemes \"myapp\" is no list of schemes, as ['myapp'] is.");
        expect(check({ urlSchemes: ['MyApp'] })).toThrow("crossbind: dialog's app.urlSchemes takes schemes of a lowercase letter");
        expect(check({ urlSchemes: ['https'] })).toThrow("crossbind: dialog's app.urlSchemes cannot take https");
        expect(check({ urlSchemes: ['myapp', 'myapp'] })).toThrow("crossbind: dialog's app.urlSchemes lists a scheme twice");
    });

    test("reaches its Java through one class in a package, whose source its Java's folder holds", () => {
        const DIALOG_CLASS = 'dev.crossbind.extension.dialog.DialogExtension';
        for (const android of [{ java: 'android/' }, { class: DIALOG_CLASS }]) {
            expect(check({ android })).toThrow("crossbind: dialog's app.android takes java and class together: the folder of its Java and the Extension class in it the app calls.");
        }
        expect(check({ android: { java: 'android/', class: 'DialogExtension' } }))
            .toThrow("crossbind: dialog's app.android.class names DialogExtension, which is no Java class in a package.");
        const missing = `${path.join('android/', 'dev', 'crossbind', 'extension', 'dialog', 'Missing')}.java`;
        expect(check({ android: { java: 'android/', class: 'dev.crossbind.extension.dialog.Missing' } }))
            .toThrow(`crossbind: dialog's app.android.class names dev.crossbind.extension.dialog.Missing, which has no source ${missing}.`);
        expect(check({ android: { java: 'android/', class: DIALOG_CLASS } })).not.toThrow();
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
        expect(check({ macos: { privacy: {} } })).toThrow("crossbind: dialog's app.macos takes sources, includes, defines, frameworks, entitlements, plist; privacy is none of them.");
        expect(check({ ios: { privacy: { userDefaults: ['XXXX.1'] } } })).toThrow("crossbind: dialog's app.ios.privacy.userDefaults [\"XXXX.1\"] is no list of Apple's reasons for it");
        expect(check({ ios: { privacy: { clipboard: ['CA92.1'] } } })).toThrow("crossbind: dialog's app.ios.privacy takes fileTimestamp");
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
        expect(check({ licenses: [{ ...vendored, url: 'x' }] })).toThrow("crossbind: dialog's app.licenses[0] takes name, version, license, file, source, sha256; url is none of them.");
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
            .toThrow('crossbind: extensions[0] takes name, contract, root, app, options, publisher, installer; version is none of them.');
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
        expect(() => listedExtension({ ...extension, contract: '1' }, 'extensions[0]', base))
            .toThrow('crossbind: extensions[0]\'s contract "1" is no version of crossbind\'s extension contract, as 1 is.');
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
        expect(() => checked({ platform: 'ios', publish: upload })).toThrow('crossbind: extensions[0].publisher takes platform, store, options, after, build, check, buildNumber, buildEnv, upload; publish is none of them.');
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
        expect(() => checked({ platform: 'linux', kind: 'AppImage' })).toThrow('crossbind: extensions[0].installer takes platform, check, make; kind is none of them.');
        expect(() => checked({ platform: 'android' })).toThrow('crossbind: extensions[0].installer.platform is no platform or list of them, of macos, linux, windows, desktop.');
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

describe("what an app's extensions add on a platform", () => {
    const extensions = () => {
        const root = hostWith({
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
        expect(darwin.native).toEqual([{ name: 'dialog', options: null }]);
        expect(darwin.roots).toEqual([dialog.root]);
        expect(darwin.sources).toEqual([path.join(dialog.root, 'native/dialog.cpp'), path.join(dialog.root, 'native/darwin.mm')]);
        expect(darwin.frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications']);
        expect(extensionPart(all, 'win32').libraries).toEqual(['comctl32', 'runtimeobject']);
        expect(extensionPart(all, 'ios').native.map(({ name }) => name)).toEqual(['dialog', 'push']);
        expect(extensionPart(all, 'linux').sources).toEqual([path.join(dialog.root, 'native/dialog.cpp')]);
    });

    test("is an Android app's Java folders with their classes and an Apple app's entitlements, by their owners", () => {
        const all = extensions();
        expect(extensionPart(all, 'android').java).toEqual([
            { name: 'dialog', dir: path.join(all[0].root, 'android/'), className: 'dev.crossbind.extension.dialog.DialogExtension' },
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
            name: 'dialog', sources: [path.join(dialog.root, 'native/dialog.cpp')], includes: [path.join(dialog.root, 'native')], defines: ['DIALOG_LIMIT=10', 'DIALOG_GTK=3'],
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
// its options, and the owner of each of the app's URL schemes, the extension that gets its links.
#include "crossbind/extension.h"
`;

    test('starts each extension with native code through its entry, with its options', () => {
        expect(registrationSource([{ name: 'dialog', options: null }, { name: 'secure-storage', options: { openPath: ['logs'] } }], [])).toBe(`${HEAD}
void crossbind_extension_dialog(crossbind::Registry &registry);
void crossbind_extension_secure_storage(crossbind::Registry &registry);

namespace crossbind::app {

void startExtension(const char *name, const char *options, void (*entry)(Registry &));

void extensionEntries() {
    startExtension("dialog", nullptr, crossbind_extension_dialog);
    startExtension("secure-storage", R"crossbind_json({"openPath":["logs"]})crossbind_json", crossbind_extension_secure_storage);
}

std::vector<std::pair<std::string, std::string>> urlSchemes() {
    return {};
}

}  // namespace crossbind::app
`);
        expect(() => registrationSource([{ name: 'odd', options: { text: ')crossbind_json' } }], []))
            .toThrow('crossbind: the extension odd\'s options hold )crossbind_json", which ends the text the host reads them from.');
    });

    test("names each URL scheme's owner: the extension that declared it, or the host's links for those of app.urlSchemes", () => {
        const native = [{ name: 'links', options: null }, { name: 'oauth', options: null }];
        const source = registrationSource(native, [{ scheme: 'myapp', extension: null }, { scheme: 'myapp.oauth', extension: 'oauth' }]);
        expect(source).toContain('    return {{"myapp", "links"}, {"myapp.oauth", "oauth"}};\n');
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

void startExtension(const char *name, const char *options, void (*entry)(Registry &));

void extensionEntries() {
}

std::vector<std::pair<std::string, std::string>> urlSchemes() {
    return {};
}

}  // namespace crossbind::app
`);
    });
});
