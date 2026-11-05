import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publishes the app to the probe's mirror, after the probe's store, as a store package's publishers would, and checks
// what each got: the probe its option, the build made with its changes to the config, and what the probe's installer
// alone, which those changes leave the build, made of the app; the mirror what the probe put out. Neither sends the app
// anywhere.
const project = resolve(import.meta.dirname, '..');
const workDir = (name) => join(project, '.crossbind', 'build', name);
const cli = fileURLToPath(import.meta.resolve('crossbind/src/cli.js'));
const failures = [];
const check = (isTrue, what) => {
    if (!isTrue) failures.push(what);
};

const run = spawnSync(process.execPath, [cli, 'app', 'publish', 'probe-mirror', '--note', 'from e2e'], { cwd: project, stdio: 'inherit' });
if (run.status !== 0) {
    console.error(`PUBLISH ERR: crossbind app publish probe-mirror ended with ${run.status ?? run.signal}`);
    process.exit(1);
}
const store = JSON.parse(readFileSync(join(workDir('probe'), 'received.json'), 'utf8'));
const mirror = JSON.parse(readFileSync(join(workDir('probe-mirror'), 'received.json'), 'utf8'));
const platform = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];

check(store.session.note === 'from e2e', `the store's --note: ${store.session.note}`);
check(store.session.platform === platform, `the store's platform: ${store.session.platform}`);
check(store.session.name === 'crossbind probe store' && store.name === 'crossbind probe store', `the app's name the store read: ${store.session.name}, ${store.name}`);
check(store.session.hasUpdater === false, 'the store read app.updater its build removes');
check(store.output.apps.length > 0 && store.output.apps.every(({ app, update }) => existsSync(app) && update === null), 'the apps the store got, each without an update');
const files = store.output.apps.flatMap(({ installers }) => installers.flatMap(({ files: made }) => made));
const kinds = store.output.apps.map(({ installers }) => installers.map(({ name }) => name).join(' '));
check(kinds.every((kind) => kind === 'probe'), `the installers the store got, the probe's alone: ${kinds.join(', ')}`);
check(files.length === store.output.apps.length && files.every((file) => existsSync(file)), `the files the store got: ${files.join(', ')}`);
const notes = files.filter((file) => existsSync(file)).map((file) => JSON.parse(readFileSync(file, 'utf8')));
check(notes.length === store.output.apps.length && notes.every((note, index) => note.platform === platform && note.arch === store.output.apps[index].arch
    && note.name === 'crossbind probe store'), `what the probe's installer was given: ${JSON.stringify(notes)}`);
check(JSON.stringify(mirror.published.files) === JSON.stringify(files), `what the mirror got of the store: ${JSON.stringify(mirror.published)}`);
if (process.platform === 'darwin') {
    const [{ app }] = store.output.apps;
    const shown = spawnSync('plutil', ['-extract', 'CFBundleDisplayName', 'raw', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).stdout.trim();
    check(shown === 'crossbind probe store', `the name the built app shows: ${shown}`);
}

if (failures.length > 0) {
    console.error(`PUBLISH ERR: ${failures.join('; ')}`);
    process.exit(1);
}
console.log(`PUBLISH OK: ${files.length} file(s) of the probe's installer through the probe's store and its mirror`);
