import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { checkedExtension, extensionPart, hostExtensions, listedExtension, mergedEntitlements, registrationSource } from '../src/utils/appExtensions.js';

const roots = [];

// An app host whose extensions/ holds these folders, each its extension.json and the files it names.
function hostWith(extensions) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extensions-'));
    roots.push(root);
    Object.entries(extensions).forEach(([folder, { json, files = [] }]) => {
        const dir = path.join(root, 'extensions', folder);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'extension.json'), typeof json === 'string' ? json : JSON.stringify(json));
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
            darwin: { sources: ['native/darwin.mm'], frameworks: ['UniformTypeIdentifiers'] },
            win32: { sources: ['native/windows.cpp'], libraries: ['comctl32'] },
            android: { java: 'android/', class: 'dev.crossbind.extension.dialog.DialogExtension' },
        },
    },
    files: ['native/dialog.cpp', 'native/darwin.mm', 'native/windows.cpp', 'android/dev/crossbind/extension/dialog/DialogExtension.java'],
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
        expect(extensions[0].app.darwin.frameworks).toEqual(['UniformTypeIdentifiers']);
    });

    test("of crossbind's own host are the dialog's, which each platform's sources show", () => {
        const extensions = hostExtensions(path.join(import.meta.dirname, '..', '..', 'app-host'));
        const sources = (platform) => extensionPart(extensions, platform).sources.map((file) => path.basename(file));
        expect(extensions.map(({ name }) => name)).toEqual(['dialog']);
        expect(sources('darwin')).toEqual(['dialog.cpp', 'darwin.mm']);
        expect(sources('ios')).toEqual(['dialog.cpp', 'ios.mm']);
        expect(sources('linux')).toEqual(['dialog.cpp', 'linux.cpp']);
        expect(sources('win32')).toEqual(['dialog.cpp', 'windows.cpp']);
        expect(sources('android')).toEqual(['dialog.cpp', 'android.cpp']);
        expect(extensionPart(extensions, 'darwin').frameworks).toEqual(['UniformTypeIdentifiers']);
        expect(extensionPart(extensions, 'win32').libraries).toEqual(['comctl32']);
        expect(extensionPart(extensions, 'android').java.map(({ className }) => className)).toEqual(['dev.crossbind.extension.dialog.DialogExtension']);
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
        expect(check({ web: {} })).toThrow("crossbind: dialog's app takes sources and darwin, ios, linux, win32, android; web is none of them.");
        expect(check({ linux: { frameworks: ['Gtk'] } })).toThrow("crossbind: dialog's app.linux takes sources, libraries; frameworks is none of them.");
        expect(check({ android: { entitlements: {} } })).toThrow("crossbind: dialog's app.android takes sources, libraries, java, class; entitlements is none of them.");
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
        expect(check({ sources: ['native/darwin.mm'] })).toThrow("crossbind: dialog's app.sources names native/darwin.mm, which is no C++ source.");
        expect(check({ linux: { sources: ['native/darwin.mm'] } })).toThrow("crossbind: dialog's app.linux.sources names native/darwin.mm, which is no C++ source.");
        expect(check({ ios: { sources: ['native/darwin.mm'] } })).not.toThrow();
        expect(check({ sources: ['native/missing.cpp'] })).toThrow("crossbind: dialog's app.sources names native/missing.cpp, which is no file of the extension's.");
    });

    test('names no path outside its folder', () => {
        for (const file of ['../dialog.cpp', '/etc/dialog.cpp', 'native/../../dialog.cpp']) {
            expect(check({ sources: [file] })).toThrow(`crossbind: dialog's app.sources names ${JSON.stringify(file)}, which is no path inside the extension's folder.`);
        }
        expect(check({ android: { java: '..' } })).toThrow("which is no path inside the extension's folder.");
        expect(check({ android: { java: 'native/dialog.cpp' } })).toThrow("crossbind: dialog's app.android.java names native/dialog.cpp, which is no folder of the extension's.");
    });

    test('links frameworks and libraries by name, and claims entitlements of values Apple takes', () => {
        expect(check({ win32: { libraries: ['-lcomctl32'] } })).toThrow("crossbind: dialog's app.win32.libraries is no list of names.");
        expect(check({ darwin: { frameworks: 'AppKit' } })).toThrow("crossbind: dialog's app.darwin.frameworks is no list of names.");
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
        expect(listedExtension({ name: 'clipboard', root, app: { sources: ['native/clipboard.cpp'] } }, 'extensions[0]', base))
            .toEqual({ name: 'clipboard', root, app: { sources: ['native/clipboard.cpp'] } });
        expect(() => listedExtension({ name: 'clipboard', root, app: { sources: ['native/missing.cpp'] } }, 'extensions[0]', base))
            .toThrow("crossbind: extensions[0]'s app.sources names native/missing.cpp, which is no file of the extension's.");
    });

    test("refuses the hooks of crossbind's build, which no build runs, and anything but its name, root and app", () => {
        const { base, root } = project();
        expect(() => listedExtension({ loadConfig: { after: () => {} }, buildWasm: {} }, 'extensions[0]', base)).toThrow(
            'crossbind: extensions[0] has the hooks loadConfig, buildWasm, which crossbind no longer runs: an extension adds native code to an app. Set build flags in targetSpecs or crossbind.build.js.',
        );
        expect(() => listedExtension({ name: 'clipboard', root, app: {}, version: 1 }, 'extensions[0]', base))
            .toThrow('crossbind: extensions[0] takes name, root, app; version is none of them.');
        expect(() => listedExtension('clipboard', 'extensions[0]', base))
            .toThrow("crossbind: extensions[0] is no extension, as an extension package's crossbind.extension.js gives one.");
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
            expect(() => listedExtension({ name: 'clipboard', root: folder }, 'extensions[0]', base))
                .toThrow('crossbind: extensions[0] has no root, the absolute path of the folder its files are in.');
        }
        const other = path.join(base, 'other');
        expect(() => listedExtension({ name: 'clipboard', root }, 'extensions[0]', other))
            .toThrow(`crossbind: extensions[0]'s root ${root} is outside ${other}, the project's base and all a build sees.`);
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
                        darwin: { frameworks: ['UniformTypeIdentifiers', 'UserNotifications'], entitlements: { 'aps-environment': 'development' } },
                        ios: { sources: ['ios.mm'], entitlements: { 'aps-environment': 'development' } },
                        win32: { libraries: ['comctl32', 'runtimeobject'] },
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
        expect(darwin.native).toEqual(['dialog']);
        expect(darwin.roots).toEqual([dialog.root]);
        expect(darwin.sources).toEqual([path.join(dialog.root, 'native/dialog.cpp'), path.join(dialog.root, 'native/darwin.mm')]);
        expect(darwin.frameworks).toEqual(['UniformTypeIdentifiers', 'UserNotifications']);
        expect(extensionPart(all, 'win32').libraries).toEqual(['comctl32', 'runtimeobject']);
        expect(extensionPart(all, 'ios').native).toEqual(['dialog', 'push']);
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
});

describe("the host's registration of its extensions", () => {
    test('calls the entry of each extension with native code', () => {
        expect(registrationSource(['dialog', 'secure-storage'])).toBe(`// crossbind writes this file from the app's extensions, each of which adds its functions through its entry.
#include "crossbind/extension.h"

void crossbind_extension_dialog(crossbind::Registry &registry);
void crossbind_extension_secure_storage(crossbind::Registry &registry);

namespace crossbind::app {

void extensionFunctions([[maybe_unused]] Registry &registry) {
    crossbind_extension_dialog(registry);
    crossbind_extension_secure_storage(registry);
}

}  // namespace crossbind::app
`);
    });

    test('adds nothing without them', () => {
        expect(registrationSource([])).toBe(`// crossbind writes this file from the app's extensions, each of which adds its functions through its entry.
#include "crossbind/extension.h"

namespace crossbind::app {

void extensionFunctions([[maybe_unused]] Registry &registry) {
}

}  // namespace crossbind::app
`);
    });
});
