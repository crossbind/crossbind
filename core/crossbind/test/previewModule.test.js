import { afterAll, describe, expect, test } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import upath from 'upath';
import { PREVIEW_MODULE_ID, previewModuleSource } from '../src/utils/previewModule.js';

const dir = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-preview-module-')));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// A stand-in of the page API a device's crossbind app answers at /__crossbind/app.js: older than the project's crossbind,
// it lacks haptics, and app.setBadge.
const APP_API = `export const app = { paths: async () => 'paths' };
export const device = Object.freeze({ get platform() { return 'ios'; } });
export const invoke = async (name) => name;
`;
// The project's own crossbind/app, as Node imports it: one name and one member more.
const projectApi = {
    app: { paths: async () => {}, setBadge: async () => {} },
    device: Object.freeze({ get platform() { return 'never read'; } }),
    haptics: { impact: async () => {} },
    invoke: async () => {},
};
// What a page that imports the module gets of it, read where Node links modules as a web view does.
const PAGE = `import * as module from 'MODULE';
import * as app from 'APP';
const failure = (promise) => promise.then(() => 'answered', (error) => error.message);
console.log(JSON.stringify({
    names: Object.keys(module).sort(),
    isAppsInvoke: module.invoke === app.invoke,
    isAppsPaths: module.app.paths === app.app.paths,
    paths: await module.app.paths(),
    platform: module.device.platform,
    impact: await failure(module.haptics.impact()),
    haptics: await failure(module.haptics()),
    setBadge: await failure(module.app.setBadge(1)),
    notThere: typeof module.app.notThere,
    then: typeof module.haptics.then,
}));
`;

// The module as a page loads it, its import of /__crossbind/app.js taking the stand-in.
function pageOf(source, name) {
    const api = pathToFileURL(upath.join(dir, `${name}-app.mjs`)).href;
    const module = pathToFileURL(upath.join(dir, `${name}.mjs`)).href;
    fs.writeFileSync(new URL(api), APP_API);
    fs.writeFileSync(new URL(module), source.replaceAll('from "/__crossbind/app.js"', `from ${JSON.stringify(api)}`));
    const page = upath.join(dir, `${name}-page.mjs`);
    fs.writeFileSync(page, PAGE.replace('MODULE', module).replace('APP', api));
    return spawnSync(process.execPath, [page], { encoding: 'utf8' });
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
            names: ['app', 'device', 'haptics', 'invoke'],
            isAppsInvoke: true,
            isAppsPaths: true,
            paths: 'paths',
            platform: 'ios',
            impact: `${older}haptics.impact`,
            haptics: `${older}haptics`,
            setBadge: `${older}app.setBadge`,
            // A name the project's crossbind does not have either is what the app gives.
            notThere: 'undefined',
            // Awaited, a stand-in is no promise.
            then: 'undefined',
        });
    });

    test("passes on no name it cannot write as one of a module's own", () => {
        expect(() => previewModuleSource({ ...projectApi, default: {} })).toThrow("this project's crossbind/app exports \"default\", which a preview cannot pass on");
        expect(() => previewModuleSource({ ...projectApi, 'a-b': 1 })).toThrow('exports "a-b"');
    });
});
