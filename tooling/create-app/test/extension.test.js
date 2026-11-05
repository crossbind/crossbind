import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listedExtension, registrationSource } from '../../../core/crossbind/src/utils/appExtensions.js';
import { makeFilter } from '../scripts/build-templates.js';
import { extensionName, nameExtension, renamedText } from '../src/extension.js';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(PKG_DIR, '../..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));
const ENTRY = MANIFEST.find((entry) => entry.key === 'app-extension');

// The real path, as an extension's import.meta.dirname gives it: macOS's temp folder is behind a link.
function tempDir(t) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'create-crossbind-extension-')));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}

// The template as build-templates.js makes it, and a project copied from it as create-crossbind copies one.
function scaffold(t) {
    const dir = tempDir(t);
    const template = path.join(dir, 'template');
    const project = path.join(dir, 'project');
    fs.cpSync(path.join(REPO_ROOT, ENTRY.source), template, { recursive: true, filter: makeFilter(ENTRY) });
    fs.cpSync(template, project, { recursive: true });
    return { dir, template, project };
}

const read = (project, file) => fs.readFileSync(path.join(project, file), 'utf8');
const extensionOf = async (project) => (await import(pathToFileURL(path.join(project, 'crossbind.extension.js')).href)).default;
const filesHolding = (project, word) => fs.readdirSync(project, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(project, path.join(entry.parentPath, entry.name)))
    .filter((file) => read(project, file).includes(word));

test('a project folder makes the extension name crossbind takes', () => {
    assert.equal(extensionName('my-extension'), 'my-extension');
    assert.equal(extensionName('Wi Fi'), 'wi-fi');
    assert.equal(extensionName('./sub/dir/Share_Sheet2/'), 'share-sheet2');
    assert.equal(extensionName('/home/me/crossbind-extension-wi-fi'), 'wi-fi');
    assert.equal(extensionName('Crossbind_Extension_Foo'), 'foo');
});

test('a project folder that makes no extension name gives none', () => {
    assert.equal(extensionName('2fa'), null);
    assert.equal(extensionName('---'), null);
    assert.equal(extensionName('crossbind-extension-'), null);
});

test('a name that holds the template extension\'s is written whole', () => {
    const text = "export default function starter() { return { name: 'starter', sources: ['native/starter.cpp'] }; }";

    assert.equal(
        renamedText(text, 'starter-kit'),
        "export default function starterKit() { return { name: 'starter-kit', sources: ['native/starter-kit.cpp'] }; }",
    );
});

test('a name module code keeps stays the extension\'s, and its JavaScript name takes Extension after it', () => {
    const text = "export default function starter() { return { name: 'starter' }; }";

    assert.equal(renamedText(text, 'delete'), "export default function deleteExtension() { return { name: 'delete' }; }");
});

test('the scaffolded extension takes its name in its code, its file names, its package and its README', async (t) => {
    const { template, project } = scaffold(t);

    await nameExtension(template, project, 'wi-fi');

    assert.ok(fs.existsSync(path.join(project, 'native/wi-fi.cpp')));
    assert.ok(!fs.existsSync(path.join(project, 'native/starter.cpp')));
    assert.match(read(project, 'native/wi-fi.cpp'), /registry\.function\("wi-fi\.greet"/);
    assert.match(read(project, 'index.js'), /invoke\('wi-fi\.greet', \{ name \}\)/);
    const pkg = JSON.parse(read(project, 'package.json'));
    assert.equal(pkg.name, 'crossbind-extension-wi-fi');
    assert.equal(pkg.private, undefined);
    const readme = read(project, 'README.md');
    assert.match(readme, /^# crossbind-extension-wi-fi$/m);
    assert.match(readme, /import wiFi from 'crossbind-extension-wi-fi\/crossbind\.extension\.js';/);
    assert.match(readme, /extensions: \[wiFi\(\)\]/);
    assert.deepEqual(filesHolding(project, 'starter'), []);
    assert.deepEqual(filesHolding(project, 'example-app-extension'), []);
});

test('the scaffolded extension is one crossbind takes, with the C++ entry crossbind calls', async (t) => {
    const { dir, template, project } = scaffold(t);

    await nameExtension(template, project, 'wi-fi');

    const extension = await extensionOf(project);
    assert.equal(extension.name, 'wiFi');
    assert.deepEqual(listedExtension(extension(), 'extensions[0]', dir), { name: 'wi-fi', root: project, app: { sources: ['native/wi-fi.cpp'] } });
    const [, entry] = registrationSource([{ name: 'wi-fi', options: null }], []).match(/void (\w+)\(crossbind::Registry &registry\);/);
    assert.match(read(project, 'native/wi-fi.cpp'), new RegExp(`^void ${entry}\\(crossbind::Registry &registry\\) \\{$`, 'm'));
});

test('a name that holds the template\'s word stays whole in the package and the README', async (t) => {
    const { template, project } = scaffold(t);

    await nameExtension(template, project, 'starter-kit');

    assert.equal(JSON.parse(read(project, 'package.json')).name, 'crossbind-extension-starter-kit');
    assert.match(read(project, 'README.md'), /import starterKit from 'crossbind-extension-starter-kit\/crossbind\.extension\.js';/);
});

test('an extension named with a word module code keeps loads', async (t) => {
    const { template, project } = scaffold(t);

    await nameExtension(template, project, 'delete');

    const extension = await extensionOf(project);
    assert.equal(extension.name, 'deleteExtension');
    assert.equal(extension().name, 'delete');
    assert.match(read(project, 'README.md'), /import deleteExtension from 'crossbind-extension-delete\/crossbind\.extension\.js';/);
});

test('a file of the project folder\'s own keeps its text', async (t) => {
    const { template, project } = scaffold(t);
    fs.writeFileSync(path.join(project, 'NOTES.md'), 'A starter of my own.\n');

    await nameExtension(template, project, 'wi-fi');

    assert.equal(read(project, 'NOTES.md'), 'A starter of my own.\n');
});

test('a project folder that makes no extension name stops create-crossbind before a file is written', (t) => {
    const cwd = tempDir(t);

    const result = spawnSync(process.execPath, [path.join(PKG_DIR, 'src/index.js'), '2fa', 'Extension'], { cwd, encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /No extension name in 2fa: an extension's name is lowercase letters and digits/);
    assert.deepEqual(fs.readdirSync(cwd), []);
});
