import { afterAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import { PREVIEW_MODULE_ID, previewModuleSource, previewRefusal } from '../src/utils/previewModule.js';

const dir = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-preview-module-')));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// A stand-in of the page API a device's crossbind app answers at /__crossbind/app.js: older than the project's crossbind,
// it lacks haptics, and dialog.openFolder.
const APP_API = `export const app = { paths: async () => 'paths', quit: async () => 'quit' };
export const dialog = { message: async () => 'message', open: async () => 'open' };
export const shell = { openExternal: async () => 'openExternal', openPath: async () => 'openPath' };
export const windows = { set: async () => 'set' };
export const device = Object.freeze({ get platform() { return 'ios'; } });
export const invoke = async (name) => name;
`;
const fn = async () => {};
// The project's own crossbind/app, as Node imports it: one name and one member more.
const projectApi = {
    app: {
        paths: fn, launchArgs: fn, quit: fn, requestQuit: fn, relaunch: fn, setUserActivity: fn,
    },
    device: Object.freeze({ get platform() { return 'never read'; } }),
    dialog: {
        message: fn, open: fn, save: fn, openFolder: fn,
    },
    haptics: { impact: fn },
    invoke: fn,
    menu: { set: fn },
    shell: {
        openExternal: fn, openPath: fn, revealInFolder: fn, trash: fn,
    },
    tray: { set: fn },
    updater: { check: fn },
    windows: { set: fn, open: fn },
};
// What a page that imports the module gets of it, read where Node links modules as a web view does.
const PAGE = `import * as module from 'MODULE';
import * as app from 'APP';
const failure = (promise) => promise.then(() => 'answered', (error) => error.message);
console.log(JSON.stringify({
    names: Object.keys(module).sort(),
    isAppsInvoke: module.invoke === app.invoke,
    isAppsMessage: module.dialog.message === app.dialog.message,
    message: await module.dialog.message(),
    platform: module.device.platform,
    impact: await failure(module.haptics.impact()),
    haptics: await failure(module.haptics()),
    openFolder: await failure(module.dialog.openFolder()),
    notThere: typeof module.dialog.notThere,
    then: typeof module.haptics.then,
}));
`;
// What a page gets of what a preview refuses, and of the members it passes on beside them.
const REFUSALS_PAGE = `import * as module from 'MODULE';
import * as app from 'APP';
const failure = (promise) => promise.then(() => 'answered', (error) => error.message);
console.log(JSON.stringify({
    refused: {
        'app.paths': await failure(module.app.paths()),
        'app.launchArgs': await failure(module.app.launchArgs()),
        'app.setUserActivity': await failure(module.app.setUserActivity({})),
        'app.quit': await failure(module.app.quit()),
        'app.requestQuit': await failure(module.app.requestQuit()),
        'app.relaunch': await failure(module.app.relaunch()),
        'shell.openPath': await failure(module.shell.openPath('/tmp/a')),
        'shell.revealInFolder': await failure(module.shell.revealInFolder('/tmp/a')),
        'shell.trash': await failure(module.shell.trash('/tmp/a')),
        'dialog.open': await failure(module.dialog.open()),
        'dialog.save': await failure(module.dialog.save()),
        'windows.set': await failure(module.windows.set({ title: 'x' })),
        'windows.open': await failure(module.windows.open()),
        'menu.set': await failure(module.menu.set([])),
        'tray.set': await failure(module.tray.set({})),
        'updater.check': await failure(module.updater.check()),
    },
    passed: {
        openExternal: module.shell.openExternal === app.shell.openExternal,
        message: module.dialog.message === app.dialog.message,
    },
    then: [typeof module.app.then, typeof module.windows.then],
}));
`;

// The module as a page loads it, its import of /__crossbind/app.js taking the stand-in.
function pageOf(source, name, page = PAGE) {
    const api = pathToFileURL(upath.join(dir, `${name}-app.mjs`)).href;
    const module = pathToFileURL(upath.join(dir, `${name}.mjs`)).href;
    fs.writeFileSync(new URL(api), APP_API);
    fs.writeFileSync(new URL(module), source.replaceAll('from "/__crossbind/app.js"', `from ${JSON.stringify(api)}`));
    const file = upath.join(dir, `${name}-page.mjs`);
    fs.writeFileSync(file, page.replace('MODULE', module).replace('APP', api));
    return spawnSync(process.execPath, [file], { encoding: 'utf8' });
}

describe('the module of the project side', () => {
    test('is the one Vite serves as /@id/__x00__crossbind-preview:app', () => {
        expect(PREVIEW_MODULE_ID).toBe('\0crossbind-preview:app');
    });

    test("links against an app that lacks a name and a member, the app's own values for the rest, and rejects the use of the two", () => {
        const { status, stdout, stderr } = pageOf(previewModuleSource(projectApi), 'older');
        expect(stderr).toBe('');
        expect(status).toBe(0);
        const older = "crossbind: the crossbind app on this device is older than this project's crossbind: update the app to use ";
        expect(JSON.parse(stdout)).toEqual({
            names: ['app', 'device', 'dialog', 'haptics', 'invoke', 'menu', 'shell', 'tray', 'updater', 'windows'],
            isAppsInvoke: true,
            isAppsMessage: true,
            message: 'message',
            platform: 'ios',
            impact: `${older}haptics.impact`,
            haptics: `${older}haptics`,
            openFolder: `${older}dialog.openFolder`,
            // A name the project's crossbind does not have either is what the app gives.
            notThere: 'undefined',
            // Awaited, a stand-in is no promise.
            then: 'undefined',
        });
    });

    test('refuses what belongs to the built app and what would end the preview, in their words, and passes on the rest', () => {
        const { status, stdout, stderr } = pageOf(previewModuleSource(projectApi), 'refusing', REFUSALS_PAGE);
        expect(stderr).toBe('');
        expect(status).toBe(0);
        const built = (name) => `crossbind: in a preview, ${name} belongs to the built app; try it with crossbind app dev.`;
        const ends = (name) => `crossbind: in a preview, ${name} would end the preview; close it from its menu.`;
        const picks = (name) => `crossbind: in a preview, ${name} belongs to the built app; pick files with a file input, or try it with crossbind app dev.`;
        expect(JSON.parse(stdout)).toEqual({
            refused: {
                'app.paths': built('app.paths'),
                'app.launchArgs': built('app.launchArgs'),
                'app.setUserActivity': built('app.setUserActivity'),
                'app.quit': ends('app.quit'),
                'app.requestQuit': ends('app.requestQuit'),
                'app.relaunch': ends('app.relaunch'),
                'shell.openPath': built('shell.openPath'),
                'shell.revealInFolder': built('shell.revealInFolder'),
                'shell.trash': built('shell.trash'),
                'dialog.open': picks('dialog.open'),
                'dialog.save': picks('dialog.save'),
                'windows.set': built('windows.set'),
                'windows.open': built('windows.open'),
                'menu.set': built('menu.set'),
                'tray.set': built('tray.set'),
                'updater.check': built('updater.check'),
            },
            passed: { openExternal: true, message: true },
            then: ['undefined', 'undefined'],
        });
        expect(previewRefusal('app.quit')).toBe(ends('app.quit'));
    });

    test("passes on no name it cannot write as one of a module's own", () => {
        expect(() => previewModuleSource({ ...projectApi, default: {} })).toThrow("this project's crossbind/app exports \"default\", which a preview cannot pass on");
        expect(() => previewModuleSource({ ...projectApi, 'a-b': 1 })).toThrow('exports "a-b"');
    });
});
