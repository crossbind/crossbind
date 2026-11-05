import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import * as pageApi from '../../app-host/js/app.js';
import * as coreApi from '../src/app/index.js';
import { ownPackages } from '../src/utils/appExtensions.js';
import { resolveAppPageApi } from '../src/utils/resolveAppHost.js';

const HOST = path.join(import.meta.dirname, '..', '..', 'app-host');
const EXTENSIONS = path.join(HOST, '..', '..', 'extensions');
const has = (name, file) => fs.existsSync(path.join(EXTENSIONS, name.replace('@crossbind/extension-', ''), file));

describe("crossbind/app as an app's page imports it", () => {
    test("is the app host's, which an app's bundler plugins take it from", () => {
        expect(resolveAppPageApi()).toBe(fs.realpathSync(path.join(HOST, 'js', 'app.js')));
    });

    test("names each package of crossbind's own extensions that gives the page functions or types", () => {
        const packages = ownPackages(HOST);
        const script = fs.readFileSync(path.join(HOST, 'js', 'app.js'), 'utf8');
        const types = fs.readFileSync(path.join(HOST, 'app.d.ts'), 'utf8');
        expect(packages.filter((name) => has(name, 'page.js') && !script.includes(`'${name}/page'`))).toEqual([]);
        expect(packages.filter((name) => has(name, 'page.d.ts') && !types.includes(`'${name}/page'`))).toEqual([]);
        expect(packages.filter((name) => has(name, 'page.js') && !has(name, 'page.d.ts'))).toEqual([]);
    });

    test("holds crossbind/app/core's, with each extension's", () => {
        expect(Object.keys(pageApi).sort()).toEqual([
            ...new Set([...Object.keys(coreApi), 'dialog', 'menu', 'notification', 'shell', 'tray', 'updater']),
        ].sort());
        expect(Object.keys(pageApi.app).sort()).toEqual(['launchArgs', 'launchFiles', 'launchUrls', 'paths', 'quit', 'relaunch', 'requestQuit', 'setUserActivity']);
    });

    test('leaves crossbind/app/core with none of the functions of an extension', () => {
        expect(Object.keys(coreApi).sort()).toEqual(['app', 'checkedOptions', 'events', 'invoke', 'routeUrl', 'windows']);
        expect(Object.keys(coreApi.app).sort()).toEqual(['launchArgs', 'paths', 'quit', 'relaunch', 'requestQuit']);
    });
});

describe('a function of an extension an app does not have', () => {
    const absent = (name) => {
        globalThis.Crossbind = { app: async () => { throw new Error(`crossbind: an app has no function ${name}`); } };
    };

    test('names what the updater needs', async () => {
        absent('updater.check');
        await expect(pageApi.updater.check()).rejects.toThrow('crossbind: this app does not update itself: a desktop app does with app.updater');
        delete globalThis.Crossbind;
    });

    test('names what a user activity needs', async () => {
        absent('activities.set');
        await expect(pageApi.app.setUserActivity({ type: 'com.example.edit' })).rejects.toThrow('crossbind: an iOS or macOS app alone sets a user activity');
        delete globalThis.Crossbind;
    });

    test('tells any other failure as it is', async () => {
        globalThis.Crossbind = { app: async () => { throw new Error('crossbind: the download failed'); } };
        await expect(pageApi.updater.install()).rejects.toThrow(/^crossbind: the download failed$/);
        delete globalThis.Crossbind;
    });
});
