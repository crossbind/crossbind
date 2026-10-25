import { afterEach, describe, expect, test, vi } from 'vitest';
import {
    app, dialog, events, menu, shell, updater,
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
        await app.relaunch();
        expect(host).toHaveBeenLastCalledWith('app.relaunch', {});
        host.mockResolvedValueOnce(['myapp://open?id=1']);
        await expect(app.launchUrls()).resolves.toEqual(['myapp://open?id=1']);
        expect(host).toHaveBeenLastCalledWith('app.launchUrls', {});
        host.mockResolvedValueOnce({ version: '1.3.0' });
        await expect(updater.check()).resolves.toEqual({ version: '1.3.0' });
        expect(host).toHaveBeenLastCalledWith('updater.check', {});
        await updater.install();
        expect(host).toHaveBeenLastCalledWith('updater.install', {});
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
});
