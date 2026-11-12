import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { androidAppId, appDisplayName, appId } from '../../../core/crossbind/src/utils/appOptions.js';
import { makeFilter } from '../scripts/build-templates.js';
import {
    appName, nameDesktopApp, nameElectronApp, nameExpoApp,
} from '../src/app-name.js';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));

// A project copied from a template as create-crossbind copies one, with the sample's dependencies beside it.
function scaffold(t, key) {
    const entry = MANIFEST.find((m) => m.key === key);
    const project = fs.mkdtempSync(path.join(os.tmpdir(), `create-crossbind-${key}-`));
    t.after(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.cpSync(path.join(REPO_ROOT, entry.source), project, { recursive: true, filter: makeFilter(entry) });
    fs.symlinkSync(path.join(REPO_ROOT, entry.source, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    return project;
}

const read = (project, file) => fs.readFileSync(path.join(project, file), 'utf8');
// The project's own files: node_modules links to the sample's, which link back.
const filesOf = (dir, root = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesOf(file, root) : [path.relative(root, file)];
});
const filesHolding = (project, word) => filesOf(project).filter((file) => read(project, file).includes(word));
// The project's config as crossbind reads it.
const configOf = async (project) => ({ app: {}, ...(await import(pathToFileURL(path.join(project, 'crossbind.config.js')).href)).default });

test('an app is named after its project folder', () => {
    assert.equal(appName('my-app'), 'my-app');
    assert.equal(appName('./apps/my-app/'), 'my-app');
    assert.equal(appName('@me/my-app'), 'my-app');
    assert.equal(appName('My App'), 'My App');
});

test('the scaffolded desktop app shows its project\'s name and takes its id from it', async (t) => {
    const project = scaffold(t, 'desktop-app');

    await nameDesktopApp(project, 'my-app');

    const config = await configOf(project);
    assert.equal(config.general.name, 'my-app');
    assert.equal(appDisplayName(config), 'my-app');
    assert.equal(appId(config), 'dev.crossbind.my-app');
    assert.equal(androidAppId(config), 'dev.crossbind.my_app');
    assert.match(read(project, 'README.md'), /`dist\/my-app\.app`/);
    assert.deepEqual(filesHolding(project, 'crossbind-example-desktop-app'), []);
});

test('a desktop app name with a quotation mark of its own stays a string of the config', async (t) => {
    const project = scaffold(t, 'desktop-app');

    await nameDesktopApp(project, "Bob's App");

    assert.equal(appDisplayName(await configOf(project)), "Bob's App");
});

test('the scaffolded Expo app shows its project\'s name and takes one id from it on iOS and Android', async (t) => {
    const project = scaffold(t, 'mobile-reactnative-expo');
    const { expo: template } = JSON.parse(read(project, 'app.json'));

    await nameExpoApp(project, 'My App');

    const { expo } = JSON.parse(read(project, 'app.json'));
    assert.deepEqual(expo, {
        ...template,
        name: 'My App',
        slug: 'my-app',
        scheme: 'myapp',
        ios: { ...template.ios, bundleIdentifier: 'dev.crossbind.myapp' },
        android: { ...template.android, package: 'dev.crossbind.myapp' },
    });
    assert.match(read(project, 'maestro.yaml'), /^appId: dev\.crossbind\.myapp$/m);
    assert.deepEqual(filesHolding(project, 'sampleReactNativeExpo'), []);
    assert.deepEqual(filesHolding(project, 'crossbind-example-mobile-reactnative-expo'), []);
});

test('an Expo app whose name starts with no letter takes an id that does', async (t) => {
    const project = scaffold(t, 'mobile-reactnative-expo');

    await nameExpoApp(project, '2fa');

    const { expo } = JSON.parse(read(project, 'app.json'));
    assert.equal(expo.slug, '2fa');
    assert.equal(expo.scheme, 'app2fa');
    assert.equal(expo.ios.bundleIdentifier, 'dev.crossbind.app2fa');
    assert.equal(expo.android.package, 'dev.crossbind.app2fa');
    assert.equal(androidAppId({ app: { id: expo.android.package } }), 'dev.crossbind.app2fa');
});

test('the scaffolded Electron app shows its project\'s name on its file, its menus and its window', async (t) => {
    const project = scaffold(t, 'desktop-electron');

    await nameElectronApp(project, 'my-app');

    assert.match(read(project, 'electron-builder.yml'), /^productName: "my-app"$/m);
    assert.match(read(project, 'src/index.html'), /<title>my-app<\/title>/);
});

test('an Electron app name that YAML or HTML would take apart stays whole', async (t) => {
    const project = scaffold(t, 'desktop-electron');

    await nameElectronApp(project, 'Tom & Jerry: <Pro>');

    const [, productName] = read(project, 'electron-builder.yml').match(/^productName: (.*)$/m);
    assert.equal(JSON.parse(productName), 'Tom & Jerry: <Pro>');
    assert.match(read(project, 'src/index.html'), /<title>Tom &amp; Jerry: &lt;Pro&gt;<\/title>/);
});
