import { afterEach, describe, expect, test, vi } from 'vitest';
import {
    app, dialog, events, invoke, menu, notification, routeUrl, shell, tray, updater, windows,
} from '../src/app/index.js';

// The host of an app, as page.js hands it the page's calls.
const host = vi.fn(async () => null);
const inApp = () => {
    globalThis.Crossbind = { app: host };
};

afterEach(() => {
    delete globalThis.Crossbind;
    delete globalThis.__crossbind_token;
    host.mockClear();
});

describe("crossbind/app, an app's own functions", () => {
    test('rejects outside an app, naming what makes one', async () => {
        await expect(app.paths()).rejects.toThrow("target.runtimeEnv: 'app'");
    });

    test('rejects in an app whose page has not called initNative() yet', async () => {
        globalThis.__crossbind_token = 'token';

        await expect(app.paths()).rejects.toThrow('initNative()');
    });

    test('rejects with a host older than crossbind/app, naming the package to update', async () => {
        globalThis.Crossbind = { initNative: () => {} };

        await expect(app.paths()).rejects.toThrow('update @crossbind/core-app-host');
    });

    test("goes to the app's host by name with its options", async () => {
        inApp();
        host.mockResolvedValueOnce(['/home/me/a.txt']);

        await expect(dialog.open({ multiple: true, filters: [{ name: 'Text', extensions: ['.txt', 'md'] }] })).resolves.toEqual(['/home/me/a.txt']);
        expect(host).toHaveBeenCalledWith('dialog.open', { multiple: true, filters: [{ name: 'Text', extensions: ['.txt', 'md'] }] });
        host.mockResolvedValueOnce('/home/me/b.csv');
        await expect(dialog.save({ defaultName: 'b.csv' })).resolves.toBe('/home/me/b.csv');
        expect(host).toHaveBeenLastCalledWith('dialog.save', { defaultName: 'b.csv' });
        await shell.openExternal(new URL('https://crossbind.dev/guide'));
        expect(host).toHaveBeenLastCalledWith('shell.openExternal', { url: 'https://crossbind.dev/guide' });
        await shell.openPath('/home/me/b.csv');
        expect(host).toHaveBeenLastCalledWith('shell.openPath', { path: '/home/me/b.csv' });
        await shell.revealInFolder('/home/me/a.txt');
        expect(host).toHaveBeenLastCalledWith('shell.revealInFolder', { path: '/home/me/a.txt' });
        await shell.trash('/home/me/old.txt');
        expect(host).toHaveBeenLastCalledWith('shell.trash', { path: '/home/me/old.txt' });
        const folders = { data: '/d', cache: '/c', logs: '/l' };
        host.mockResolvedValueOnce(folders);
        await expect(app.paths()).resolves.toEqual(folders);
        await app.quit();
        expect(host).toHaveBeenLastCalledWith('app.quit', {});
        await app.requestQuit();
        expect(host).toHaveBeenLastCalledWith('app.requestQuit', {});
        await app.relaunch();
        expect(host).toHaveBeenLastCalledWith('app.relaunch', {});
        host.mockResolvedValueOnce([{ url: 'myapp://open?id=1' }, null, { url: 7 }]);
        await expect(app.launchUrls()).resolves.toEqual(['myapp://open?id=1']);
        expect(host).toHaveBeenLastCalledWith('events.held', { name: 'open-url' });
        host.mockResolvedValueOnce([{ paths: ['/home/me/map.geojson', 7] }, null, { paths: '/x' }, { paths: ['/home/me/b.geojson'] }]);
        await expect(app.launchFiles()).resolves.toEqual(['/home/me/map.geojson', '/home/me/b.geojson']);
        expect(host).toHaveBeenLastCalledWith('events.held', { name: 'open-files' });
        host.mockResolvedValueOnce({ args: ['--from-e2e', 'notes.txt'], cwd: '/home/me' });
        await expect(app.launchArgs()).resolves.toEqual({ args: ['--from-e2e', 'notes.txt'], cwd: '/home/me' });
        expect(host).toHaveBeenLastCalledWith('app.launchArgs', {});
        host.mockResolvedValueOnce([{ id: 7 }]);
        await expect(events.held('tapped')).resolves.toEqual([{ id: 7 }]);
        expect(host).toHaveBeenLastCalledWith('events.held', { name: 'tapped' });
        await expect(events.held('')).rejects.toThrow('crossbind: events.held takes the name of an event.');
        host.mockResolvedValueOnce({ version: '1.3.0' });
        await expect(updater.check()).resolves.toEqual({ version: '1.3.0' });
        expect(host).toHaveBeenLastCalledWith('updater.check', {});
        await updater.install();
        expect(host).toHaveBeenLastCalledWith('updater.install', {});
    });

    test("calls an extension's function by its name, with its options or none", async () => {
        inApp();
        host.mockResolvedValueOnce('copied');
        await expect(invoke('clipboard.readText')).resolves.toBe('copied');
        expect(host).toHaveBeenLastCalledWith('clipboard.readText', {}, { onMessage: undefined, signal: undefined });
        await invoke('clipboard.writeText', { text: 'hi' });
        expect(host).toHaveBeenLastCalledWith('clipboard.writeText', { text: 'hi' }, { onMessage: undefined, signal: undefined });
        await expect(invoke('')).rejects.toThrow("crossbind: invoke takes the name of one of the app's functions.");
        expect(host).toHaveBeenCalledTimes(2);
    });

    test("hands the host what takes a call's messages and what cancels it, and refuses them of another kind or to an older host", async () => {
        globalThis.Crossbind = { app: host, takesMessages: true };
        const onMessage = () => {};
        const { signal } = new AbortController();

        await invoke('downloads.fetch', { url: 'https://crossbind.dev/a.zip' }, { onMessage, signal });

        expect(host).toHaveBeenLastCalledWith('downloads.fetch', { url: 'https://crossbind.dev/a.zip' }, { onMessage, signal });
        await expect(invoke('downloads.fetch', {}, { onMessage: 'progress' })).rejects.toThrow('crossbind: invoke takes onMessage as a function.');
        await expect(invoke('downloads.fetch', {}, { signal: { aborted: false } })).rejects.toThrow('crossbind: invoke takes signal as an AbortSignal.');
        inApp();
        await expect(invoke('downloads.fetch', {}, { onMessage })).rejects.toThrow('update @crossbind/core-app-host to call invoke with onMessage or signal');
        expect(host).toHaveBeenCalledTimes(1);
    });

    test("names the URL of a path an extension's route serves, under the app's own origin, before the page called initNative()", () => {
        expect(routeUrl('media', '/clips/intro.mp4?t=1')).toBe('crossbind://app/ext/media/clips/intro.mp4?t=1');
        globalThis.__crossbind_port = Promise.resolve();
        try {
            expect(routeUrl('media', '/clips/a%20b.mp4')).toBe('https://appassets.androidplatform.net/ext/media/clips/a%20b.mp4');
        } finally {
            delete globalThis.__crossbind_port;
        }
        expect(() => routeUrl('Media', '/a')).toThrow("crossbind: routeUrl takes the name of one of the app's extensions.");
        expect(() => routeUrl('media/x', '/a')).toThrow("crossbind: routeUrl takes the name of one of the app's extensions.");
        expect(() => routeUrl('media', 'clips/intro.mp4')).toThrow('crossbind: routeUrl takes a path that starts with "/".');
        for (const path of ['/../other/x', '/a/./b', '/a/%2E%2e/b', '/%2e']) {
            expect(() => routeUrl('media', path)).toThrow('crossbind: routeUrl takes a path without a part "." or "..".');
        }
        expect(routeUrl('media', '/a..b/c?d=..')).toBe('crossbind://app/ext/media/a..b/c?d=..');
    });

    test("hands a listener of the app's events to the host, which returns what stops it", () => {
        const off = () => {};
        globalThis.Crossbind = { on: vi.fn(() => off) };
        const listener = () => {};

        expect(events.on('progress', listener)).toBe(off);
        expect(globalThis.Crossbind.on).toHaveBeenCalledWith('progress', listener);
    });

    test('refuses a listener without a name or a function, and one outside an app or with an older host', () => {
        expect(() => events.on('', () => {})).toThrow('takes the name of an event');
        expect(() => events.on('progress', 'listener')).toThrow('takes a function to call');
        expect(() => events.on('progress', () => {})).toThrow("target.runtimeEnv: 'app'");
        inApp();
        expect(() => events.on('progress', () => {})).toThrow('update @crossbind/core-app-host to call events.on');
    });

    test('refuses an option it does not know or of another kind before the host sees it', async () => {
        inApp();

        await expect(dialog.save({ defualtName: 'a.csv' })).rejects.toThrow('defualtName is none of them');
        await expect(dialog.save({ toString: 'a.csv' })).rejects.toThrow('toString is none of them');
        await expect(dialog.open({ multiple: 'yes' })).rejects.toThrow('multiple is no boolean');
        await expect(dialog.open({ filters: [{ name: 'Text' }] })).rejects.toThrow('list of { name, extensions }');
        await expect(dialog.open('a.txt')).rejects.toThrow('takes an object');
        await expect(shell.openPath('')).rejects.toThrow('takes a path');
        await expect(shell.trash(42)).rejects.toThrow('shell.trash takes a path');
        await expect(shell.openExternal()).rejects.toThrow('takes an address');
        await expect(shell.openExternal(42)).rejects.toThrow('takes an address');
        expect(host).not.toHaveBeenCalled();
    });

    test('makes a user activity current through the host as the page gives it, or none', async () => {
        inApp();
        const activity = { type: 'com.example.demo.edit', userInfo: { id: 7, tags: ['a'] }, webpageUrl: 'https://example.com/notes/7' };

        await app.setUserActivity(activity);
        expect(host).toHaveBeenLastCalledWith('activities.set', activity);
        await app.setUserActivity({ type: 'com.example.demo.edit' });
        expect(host).toHaveBeenLastCalledWith('activities.set', { type: 'com.example.demo.edit' });
        await app.setUserActivity(null);
        expect(host).toHaveBeenLastCalledWith('activities.set', {});
    });

    test('refuses a user activity before the host sees it where the host could not make it, naming what is wrong', async () => {
        inApp();

        await expect(app.setUserActivity()).rejects.toThrow('crossbind: app.setUserActivity takes an object of type, userInfo, webpageUrl.');
        await expect(app.setUserActivity({ userInfo: {} })).rejects.toThrow('crossbind: app.setUserActivity takes a type, one of app.activityTypes.');
        await expect(app.setUserActivity({ type: 'com.example.demo.edit', title: 'Edit' })).rejects.toThrow('app.setUserActivity takes type, userInfo, webpageUrl; title is none of them.');
        await expect(app.setUserActivity({ type: 'com.example.demo.edit', userInfo: [1] })).rejects.toThrow("crossbind: app.setUserActivity's userInfo is no object.");
        for (const webpageUrl of ['ftp://example.com/a', 'example.com/a']) {
            await expect(app.setUserActivity({ type: 'com.example.demo.edit', webpageUrl })).rejects.toThrow("crossbind: app.setUserActivity's webpageUrl is no http or https address.");
        }
        expect(host).not.toHaveBeenCalled();
    });
});

describe("crossbind/app's message dialog", () => {
    test('goes to the host with its options and answers the index of the button clicked', async () => {
        inApp();
        const options = {
            message: 'Save changes to report.csv?', detail: "Your changes are lost if you don't save them.", kind: 'warning', buttons: ['Save', "Don't Save", 'Cancel'],
        };
        host.mockResolvedValueOnce(2);

        await expect(dialog.message(options)).resolves.toBe(2);
        expect(host).toHaveBeenCalledWith('dialog.message', options);
        await dialog.message({ message: 'Exported.' });
        expect(host).toHaveBeenLastCalledWith('dialog.message', { message: 'Exported.' });
    });

    test('takes each kind, one to three labels and options left undefined', async () => {
        inApp();
        const kinds = ['info', 'warning', 'error'];
        const lists = [['OK'], ['Yes', 'No'], ['Save', "Don't Save", 'Cancel']];

        for (const kind of kinds) await dialog.message({ message: 'Saved.', kind });
        for (const buttons of lists) await dialog.message({ message: 'Saved.', buttons });
        await dialog.message({ message: 'Saved.', detail: undefined, kind: undefined, buttons: undefined });

        expect(host).toHaveBeenCalledTimes(kinds.length + lists.length + 1);
        for (const kind of kinds) expect(host).toHaveBeenCalledWith('dialog.message', { message: 'Saved.', kind });
        for (const buttons of lists) expect(host).toHaveBeenCalledWith('dialog.message', { message: 'Saved.', buttons });
    });

    test('is refused before the host sees it without a message, of another kind or without one to three labels', async () => {
        inApp();
        const message = (options) => dialog.message(options);
        const sparse = ['OK'];
        sparse[2] = 'Cancel';

        await expect(message()).rejects.toThrow('dialog.message takes an object of message, detail, kind, buttons');
        await expect(message('Exported.')).rejects.toThrow('takes an object');
        await expect(message({})).rejects.toThrow('dialog.message takes a message');
        await expect(message({ message: '' })).rejects.toThrow('dialog.message takes a message');
        await expect(message({ message: 42 })).rejects.toThrow("dialog.message's message is no string");
        await expect(message({ message: 'Exported.', title: 'Export' })).rejects.toThrow('title is none of them');
        await expect(message({ message: 'Exported.', kind: 'question' })).rejects.toThrow('kind is info, warning or error, not "question"');
        for (const buttons of [[], ['A', 'B', 'C', 'D'], ['OK', ''], ['OK', 1], 'OK', sparse]) {
            await expect(message({ message: 'Exported.', buttons })).rejects.toThrow("dialog.message's buttons is no list of one to three labels");
        }
        expect(host).not.toHaveBeenCalled();
    });
});

describe("crossbind/app's menus", () => {
    test('go to the host as the page gives them', async () => {
        inApp();
        const menus = [
            {
                label: 'File',
                items: [
                    { id: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+Shift+O' },
                    { type: 'separator' },
                    { label: 'Recent', items: [{ id: 'recent-1', label: 'a.txt' }] },
                    { role: 'quit', label: 'Exit' },
                ],
            },
            { role: 'editMenu' },
            { label: 'View', items: [{ id: 'grid', label: 'Grid', checked: true, enabled: false, accelerator: 'F5' }, { role: 'windowMenu' }] },
        ];

        await menu.set(menus);

        expect(host).toHaveBeenLastCalledWith('menu.set', { menus });
    });

    test('take no menus, a standard item without a label and a function key with any modifiers', async () => {
        inApp();
        const file = (...items) => [{ label: 'File', items }];

        await menu.set([]);
        await menu.set(file({ role: 'copy' }, { role: 'quit', accelerator: 'Ctrl+Q' }));
        for (const accelerator of ['Shift+F5', 'Alt+Shift+F5', 'CmdOrCtrl+Plus']) await menu.set(file({ label: 'Run', accelerator }));

        expect(host).toHaveBeenCalledTimes(5);
    });

    test('are refused before the host sees them where it could not build them, naming the item', async () => {
        inApp();
        const set = (menus) => menu.set(menus);
        const file = (...items) => [{ label: 'File', items }];

        await expect(set({})).rejects.toThrow('menu.set takes a list of menus');
        await expect(set([{ id: 'x', label: 'X' }])).rejects.toThrow("menus[0] is a menu, which takes a label and items, or the role editMenu or windowMenu");
        await expect(set([{ role: 'copy' }])).rejects.toThrow('menus[0] has no role "copy", which is one of editMenu, windowMenu');
        await expect(set(file({ role: 'print' }))).rejects.toThrow('menus[0].items[0] has no role "print"');
        await expect(set(file({ role: 'quit', id: 'quit' }))).rejects.toThrow('has a role, which takes a label and an accelerator alone');
        await expect(set(file({ role: 'copy', enabled: false }))).rejects.toThrow('has a role, which takes a label and an accelerator alone');
        await expect(set(file({ role: 'copy', accelerator: 'CmdOrCtrl+C' }))).rejects.toThrow("is an editing item, which keeps the platform's keys");
        await expect(set(file({ role: 'editMenu', accelerator: 'F1' }))).rejects.toThrow('is a standard menu, which takes a label alone');
        await expect(set([{ role: 'editMenu', items: [] }])).rejects.toThrow('menus[0] is a standard menu, which takes a label alone');
        await expect(set(file({ type: 'separator', label: '-' }))).rejects.toThrow("is no separator, which is { type: 'separator' } alone, inside a menu");
        await expect(set(file({ type: 'checkbox', label: 'Grid' }))).rejects.toThrow('menus[0].items[0] is no separator');
        await expect(set([{ type: 'separator' }])).rejects.toThrow('menus[0] is no separator');
        await expect(set(file(null))).rejects.toThrow('menus[0].items[0] is no object');
        const sparse = [];
        sparse[1] = { label: 'Open' };
        await expect(set([{ label: 'File', items: sparse }])).rejects.toThrow('menus[0].items[0] is no object');
        await expect(set([{ label: 'File', items: {} }])).rejects.toThrow('menus[0].items is no list');
        await expect(set(file({ label: '' }))).rejects.toThrow('menus[0].items[0] has no label');
        await expect(set(file({ label: 'Recent', items: [], id: 'recent' }))).rejects.toThrow('is a menu, which takes a label and items alone');
        await expect(set(file({ label: 'Open', onClick: () => {} }))).rejects.toThrow('onClick is none of them');
        await expect(set(file({ label: 'Open', toString: 'x' }))).rejects.toThrow('toString is none of them');
        await expect(set(file({ label: 'Open', checked: 'yes' }))).rejects.toThrow('menus[0].items[0].checked is no boolean');
        for (const accelerator of ['Cmd+O', 'CmdOrCtrl+o', 'Ctrl+Ctrl+O', 'CmdOrCtrl+', 'F13', 'Ctrl+Alt', 'O', 'Shift+O', 'Enter']) {
            await expect(set(file({ label: 'Open', accelerator }))).rejects.toThrow(`menus[0].items[0].accelerator ${JSON.stringify(accelerator)} is none`);
        }
        expect(host).not.toHaveBeenCalled();
    });

    test('open a popup at the page point the page gives, resolving with the id clicked, or null for none', async () => {
        inApp();
        const items = [{ id: 'rename', label: 'Rename', accelerator: 'F2' }, { type: 'separator' }, { role: 'copy' }, { label: 'Sort', items: [{ id: 'by-name', label: 'By name', checked: true }] }];
        host.mockResolvedValueOnce('rename');

        await expect(menu.popup(items, { x: 12.5, y: 40 })).resolves.toBe('rename');
        expect(host).toHaveBeenLastCalledWith('menu.popup', { items, x: 12.5, y: 40 });
        await expect(menu.popup([{ id: 'open', label: 'Open' }], { x: 0, y: 0 })).resolves.toBeNull();
    });

    test('refuse a popup before the host sees it where it could not open it, naming what is wrong', async () => {
        inApp();
        const popup = (items, at) => menu.popup(items, at);
        const open = [{ id: 'open', label: 'Open' }];

        await expect(popup({}, { x: 0, y: 0 })).rejects.toThrow('menu.popup takes a list of items');
        await expect(popup([{ role: 'print' }], { x: 0, y: 0 })).rejects.toThrow("menu.popup's items[0] has no role \"print\"");
        await expect(popup([{ label: 'Open', accelerator: 'O' }], { x: 0, y: 0 })).rejects.toThrow("menu.popup's items[0].accelerator \"O\" is none");
        await expect(popup([{ label: '' }], { x: 0, y: 0 })).rejects.toThrow("menu.popup's items[0] has no label");
        await expect(popup(open)).rejects.toThrow('menu.popup takes the point it opens at, { x, y }');
        await expect(popup(open, { x: 1 })).rejects.toThrow('menu.popup takes the point it opens at, { x, y }');
        await expect(popup(open, { x: Number.NaN, y: 1 })).rejects.toThrow('menu.popup takes the point it opens at, { x, y }');
        await expect(popup(open, { x: '1', y: 1 })).rejects.toThrow('menu.popup takes the point it opens at, { x, y }');
        expect(host).not.toHaveBeenCalled();
    });

    test("set the Dock's menu of a macOS app, of a tray's items, whose clicks are the event menu", async () => {
        inApp();
        const items = [{ label: 'New window', id: 'new-window' }, { type: 'separator' }, { label: 'Recent', items: [{ label: 'a.txt', id: 'recent-a', checked: true }] }];

        await menu.setDock(items);
        expect(host).toHaveBeenLastCalledWith('menu.setDock', { items });
        await menu.setDock([]);
        expect(host).toHaveBeenLastCalledWith('menu.setDock', { items: [] });
    });

    test("refuse a Dock menu before the host sees it where it could not build it, naming the item", async () => {
        inApp();

        await expect(menu.setDock({})).rejects.toThrow("crossbind: menu.setDock takes a list of items.");
        await expect(menu.setDock([{ id: 'open' }])).rejects.toThrow("menu.setDock's items[0] has no label");
        await expect(menu.setDock([{ label: 'Copy', role: 'copy' }])).rejects.toThrow("menu.setDock's items[0] takes label, id, enabled, checked, items, type; role is none of them");
        await expect(menu.setDock([{ label: 'Open', accelerator: 'CmdOrCtrl+O' }])).rejects.toThrow("menu.setDock's items[0] takes label, id, enabled, checked, items, type; accelerator is none of them");
        expect(host).not.toHaveBeenCalled();
    });
});

describe("crossbind/app's tray and notifications", () => {
    test('go to the host as the page gives them', async () => {
        inApp();
        const menuOfTray = [{ label: 'Open', id: 'open' }, { type: 'separator' }, { label: 'View', items: [{ label: 'Dark', id: 'dark', checked: true, enabled: false }] }];

        await tray.set({ tooltip: 'Demo', menu: menuOfTray });
        expect(host).toHaveBeenLastCalledWith('tray.set', { tooltip: 'Demo', menu: menuOfTray });
        await tray.set();
        expect(host).toHaveBeenLastCalledWith('tray.set', {});
        await tray.remove();
        expect(host).toHaveBeenLastCalledWith('tray.remove', {});
        await notification.show({ title: 'Saved', body: 'The file is saved.' });
        expect(host).toHaveBeenLastCalledWith('notification.show', { title: 'Saved', body: 'The file is saved.' });
    });

    test('are refused before the host sees them where it could not show them, naming the item', async () => {
        inApp();

        await expect(tray.set({ icon: 'tray.png' })).rejects.toThrow('tray.set takes tooltip, menu; icon is none of them');
        await expect(tray.set({ menu: {} })).rejects.toThrow("tray.set's menu is no list");
        await expect(tray.set({ menu: [{ id: 'open' }] })).rejects.toThrow("tray.set's menu[0] has no label");
        await expect(tray.set({ menu: [{ label: 'Copy', role: 'copy' }] })).rejects.toThrow("tray.set's menu[0] takes label, id, enabled, checked, items, type; role is none of them");
        await expect(tray.set({ menu: [{ label: 'Open', accelerator: 'CmdOrCtrl+O' }] })).rejects.toThrow('accelerator is none of them');
        await expect(tray.set({ menu: [{ label: 'View', items: [{ type: 'separator', label: '-' }] }] })).rejects.toThrow("tray.set's menu[0].items[0] is no separator");
        await expect(tray.set({ menu: [{ label: 'View', id: 'view', items: [] }] })).rejects.toThrow("tray.set's menu[0] is a menu, which takes a label and items alone");
        await expect(notification.show({})).rejects.toThrow('notification.show takes a title');
        await expect(notification.show({ title: 'Saved', icon: 'x.png' })).rejects.toThrow('notification.show takes title, body; icon is none of them');
        expect(host).not.toHaveBeenCalled();
    });
});

describe("crossbind/app's windows", () => {
    test('go to the host as the page gives them, the page\'s own window without an id', async () => {
        inApp();
        host.mockResolvedValueOnce({ id: 2, ignored: [] });

        await expect(windows.open({
            path: '/settings.html?tab=2', title: 'Settings', name: 'settings', width: 480, height: 360, x: -40, y: 20, alwaysOnTop: true, frame: false,
            parent: 1, modal: true, backgroundColor: '#1e1e1e',
        })).resolves.toEqual({ id: 2, ignored: [] });
        expect(host).toHaveBeenLastCalledWith('windows.open', expect.objectContaining({ path: '/settings.html?tab=2', parent: 1, modal: true }));
        await windows.open();
        expect(host).toHaveBeenLastCalledWith('windows.open', {});
        await windows.set({ title: 'Report.txt' });
        expect(host).toHaveBeenLastCalledWith('windows.set', { title: 'Report.txt' });
        await windows.set(2, { width: 800, height: 600, center: true, maxWidth: 0 });
        expect(host).toHaveBeenLastCalledWith('windows.set', { width: 800, height: 600, center: true, maxWidth: 0, id: 2 });
        await windows.close();
        expect(host).toHaveBeenLastCalledWith('windows.close', {});
        for (const name of ['close', 'focus', 'minimize', 'toggleMaximize']) {
            await windows[name](3);
            expect(host).toHaveBeenLastCalledWith(`windows.${name}`, { id: 3 });
        }
        for (const name of ['startDrag', 'list', 'current']) {
            await windows[name]();
            expect(host).toHaveBeenLastCalledWith(`windows.${name}`, {});
        }
    });

    test('are refused before the host sees them where the host could not honour them, naming what is wrong', async () => {
        inApp();

        await expect(windows.open({ url: 'https://example.com' })).rejects.toThrow('windows.open takes title, width');
        await expect(windows.open({ path: 'https://example.com/' })).rejects.toThrow('is no path of the app\'s own pages');
        await expect(windows.open({ path: '//example.com/' })).rejects.toThrow('is no path of the app\'s own pages');
        await expect(windows.open({ path: '/a/../../b.html' })).rejects.toThrow('is no path of the app\'s own pages');
        await expect(windows.open({ path: '/a/%2e%2e/b.html' })).rejects.toThrow('is no path of the app\'s own pages');
        await expect(windows.open({ width: 0 })).rejects.toThrow("windows.open's width is no whole number of pixels up to 16384");
        await expect(windows.open({ height: 12.5 })).rejects.toThrow("windows.open's height is no whole number");
        await expect(windows.open({ minWidth: 0 })).rejects.toThrow("windows.open's minWidth is no whole number");
        await expect(windows.open({ x: 10 })).rejects.toThrow('windows.open takes x and y together');
        await expect(windows.open({ x: 1.5, y: 2 })).rejects.toThrow("windows.open's x is no whole number of pixels");
        await expect(windows.open({ x: 0, y: -1000001 })).rejects.toThrow("windows.open's y is no whole number of pixels from -1000000 to 1000000");
        await expect(windows.open({ center: true })).rejects.toThrow('windows.open takes title, width');
        await expect(windows.open({ resizable: false, minWidth: 300 })).rejects.toThrow("windows.open's minWidth limit a window that resizes");
        await expect(windows.open({ width: 400, minWidth: 500 })).rejects.toThrow("windows.open's minWidth is above the width the window opens at, 400");
        await expect(windows.open({ maxHeight: 600 })).rejects.toThrow("windows.open's maxHeight is below the height the window opens at, 768");
        await expect(windows.open({ modal: true })).rejects.toThrow('give it parent, the id of a window');
        await expect(windows.open({ parent: 0 })).rejects.toThrow("windows.open's parent is no window's id");
        await expect(windows.open({ backgroundColor: 'red' })).rejects.toThrow('is no color of the form #rrggbb');
        await expect(windows.open({ frame: 'no' })).rejects.toThrow("windows.open's frame is no boolean");
        await expect(windows.set(1, { path: '/x.html' })).rejects.toThrow('windows.set takes title, width');
        await expect(windows.set({ width: -1 })).rejects.toThrow("windows.set's width is no whole number");
        await expect(windows.focus(0)).rejects.toThrow('windows.focus takes the id of a window');
        await expect(windows.close('main')).rejects.toThrow('windows.close takes the id of a window');
        expect(host).not.toHaveBeenCalled();
    });
});
