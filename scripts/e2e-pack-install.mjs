#!/usr/bin/env node
// What an app's developer gets from npm, which the workspace's links hide: packs crossbind's packages as a publish does,
// installs them with pnpm and with npm in a project outside the repository, whose resolving no workspace helps, and checks
// the commands of crossbind's own extensions, their licenses, a page's types and a build for this machine.
//
//   node scripts/e2e-pack-install.mjs [linux|windows|ios|android ...] [--keep]
//
// Names the platforms to build for as well, with pnpm; --keep leaves the projects to look at, as a failure does.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPOSITORY = path.resolve(import.meta.dirname, '..');
const NAME = 'pack-install';
const WHERE_PACKAGES_ARE = ['core', 'plugins', 'extensions'];
const WHAT_AN_APP_INSTALLS = ['crossbind', '@crossbind/core-app-host', '@crossbind/plugin-vite'];
const STORES = ['app-store', 'github', 'google-play'];
// Three of the host's extensions, each by a text of its own code too long for a string held in place, which a compiler
// keeps whole: a short name, as dialog.open, it may build in registers, as Linux x64's build does.
const BUILD_MARKERS = {
    dialog: 'crossbind: another dialog is open',
    menu: 'crossbind: notification.show takes a title',
    shell: 'crossbind: openExternal opens http, https and mailto addresses alone',
};
// What a build of this machine's platform makes, as app-outputs.json lists it.
const MACHINE = { darwin: { key: 'macos', installers: ['dmg'] }, linux: { key: 'linux', installers: ['deb', 'tar-gz'] } }[process.platform];

if (!MACHINE) throw new Error(`crossbind: e2e-pack-install runs on macOS and Linux, not ${process.platform}.`);

const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !['CROSSBIND_APP_PLATFORM', 'npm_config_user_agent', 'NODE_PATH', 'INIT_CWD', 'PNPM_SCRIPT_SRC_DIR'].includes(key)));
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'crossbind-pack-install-'));
const failures = [];

function run(command, args, cwd) {
    const { status, stdout, stderr } = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 30 });
    return { isOk: status === 0, text: `${stdout}${stderr}` };
}

function report(what, isOk, detail = '') {
    console.log(`  ${isOk ? 'ok' : 'FAIL'}: ${what}`);
    if (!isOk) {
        failures.push(what);
        if (detail) console.log(detail.split('\n').slice(-40).join('\n'));
    }
}

// The folders of the workspace's packages by their names.
function workspacePackages() {
    const folders = WHERE_PACKAGES_ARE.flatMap((parent) => fs.readdirSync(path.join(REPOSITORY, parent)).map((name) => path.join(REPOSITORY, parent, name)));
    return new Map(folders.filter((folder) => fs.existsSync(path.join(folder, 'package.json')))
        .map((folder) => [JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).name, folder]));
}

// What an app installs, with each package of the workspace those depend on.
function packagesOfAnApp(workspace) {
    const found = new Set();
    const visit = (name) => {
        if (found.has(name) || !workspace.has(name)) return;
        found.add(name);
        const { dependencies = {}, peerDependencies = {} } = JSON.parse(fs.readFileSync(path.join(workspace.get(name), 'package.json'), 'utf8'));
        Object.keys({ ...dependencies, ...peerDependencies }).forEach(visit);
    };
    WHAT_AN_APP_INSTALLS.forEach(visit);
    return [...found];
}

function pack() {
    const tarballs = path.join(root, 'tarballs');
    fs.mkdirSync(tarballs);
    const workspace = workspacePackages();
    const packed = {};
    for (const name of packagesOfAnApp(workspace)) {
        const before = new Set(fs.readdirSync(tarballs));
        const { isOk, text } = run('pnpm', ['pack', '--pack-destination', tarballs], workspace.get(name));
        if (!isOk) throw new Error(`crossbind: pnpm pack of ${name} failed:\n${text}`);
        const file = path.join(tarballs, fs.readdirSync(tarballs).find((entry) => !before.has(entry)));
        const manifest = JSON.parse(run('tar', ['-xOzf', file, 'package/package.json'], root).text);
        const left = ['dependencies', 'peerDependencies', 'optionalDependencies']
            .flatMap((field) => Object.entries(manifest[field] ?? {})).filter(([, spec]) => spec.startsWith('workspace:'));
        if (left.length > 0) throw new Error(`crossbind: ${name} packs with workspace: ranges: ${left.map(([dep]) => dep).join(', ')}.`);
        packed[name] = `file:${file}`;
    }
    console.log(`packed ${Object.keys(packed).length} packages, ${Object.keys(packed).filter((name) => name.startsWith('@crossbind/extension-')).length} of them crossbind's own extensions; the page ${canBind ? 'binds a header' : 'binds none, without Docker'}`);
    return packed;
}

// A bound header takes SWIG, which runs in Docker, which a macOS runner has not: there the page goes without.
const canBind = run('docker', ['info'], root).isOk;

const FILES = {
    'crossbind.config.js': `export default {
    general: { name: '${NAME}' },
    target: { runtimeEnv: 'app' },
    app: { id: 'dev.crossbind.packinstall' },
    paths: { config: import.meta.url },
};
`,
    'vite.config.js': `import { defineConfig } from 'vite';
import viteCrossbindPlugin from '@crossbind/plugin-vite';

export default defineConfig({ plugins: [viteCrossbindPlugin()] });
`,
    'index.html': `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${NAME}</title></head>
<body><p id="message">loading</p><button id="open">open</button><button id="site">site</button>
<script type="module" src="/src/main.js"></script></body>
</html>
`,
    'src/main.js': `import { app, dialog, shell } from 'crossbind/app';
${canBind ? "import { initNative, Native } from './native/native.h';" : "import '/crossbind.js';"}

document.querySelector('#open').addEventListener('click', () => dialog.open());
document.querySelector('#site').addEventListener('click', () => shell.openExternal('https://crossbind.dev/'));
${canBind ? 'initNative()' : 'globalThis.Crossbind.initNative()'}.then(async () => {
    const message = \`${canBind ? '\${await Native.sample()} in ' : ''}\${(await app.paths()).data}\`;
    document.querySelector('#message').textContent = message;
    console.log(\`PACK INSTALL \${message}\`);
});
`,
    ...(canBind ? {
        'src/native/native.h': `#ifndef NATIVE_H
#define NATIVE_H

#include <string>

class Native {
public:
    static std::string sample() { return "from c++"; }
};

#endif
`,
    } : {}),
    'src/types.ts': `/// <reference types="@crossbind/core-app-host/app" />
import { app, dialog, events, updater, type FileFilter, type MenuClick } from 'crossbind/app';

const filters: FileFilter[] = [{ name: 'Text', extensions: ['txt'] }];

export async function page(): Promise<(string[] | null | string)[]> {
    events.on('menu', (click: MenuClick) => click.id);
    events.on('open-url', ({ url }) => url);
    events.on('suspend', () => {});
    // @ts-expect-error dialog.open takes no such option
    await dialog.open({ nope: true });
    await updater.check();
    return [await dialog.open({ filters }), (await app.paths()).data, ...(await app.launchUrls())];
}
`,
    'tsconfig.json': `${JSON.stringify({
        compilerOptions: {
            noEmit: true, strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', types: [], lib: ['es2022', 'dom'],
        },
        files: ['src/types.ts'],
    })}\n`,
};

function makeProject(manager, packed) {
    const project = path.join(root, `${manager}-app`);
    const manifest = {
        name: NAME,
        version: '1.0.0',
        private: true,
        type: 'module',
        devDependencies: {
            ...Object.fromEntries(WHAT_AN_APP_INSTALLS.map((name) => [name, packed[name]])),
            typescript: '^7.0.2',
            vite: '^8.2.1',
        },
        ...(manager === 'npm' ? { overrides: packed } : {}),
    };
    const files = {
        ...FILES,
        'package.json': `${JSON.stringify(manifest, null, 2)}\n`,
        ...(manager === 'pnpm' ? { 'pnpm-workspace.yaml': `overrides:\n${Object.entries(packed).map(([name, spec]) => `  "${name}": "${spec}"\n`).join('')}` } : {}),
    };
    Object.entries(files).forEach(([file, text]) => {
        fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
        fs.writeFileSync(path.join(project, file), text);
    });
    return project;
}

// The file of a name under a folder, which a build puts where its platform does.
function findFile(dir, name) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const at = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === name) return at;
        const found = entry.isDirectory() ? findFile(at, name) : null;
        if (found) return found;
    }
    return null;
}

const outputsOf = (project) => {
    const file = path.join(project, '.crossbind', 'build', 'app-outputs.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
};

function checkProject(manager, project) {
    console.log(`${manager}:`);
    const exec = manager === 'pnpm' ? ['pnpm', ['exec']] : ['npx', ['--no-install']];
    const inProject = (...args) => run(exec[0], [...exec[1], ...args], project);
    const install = manager === 'pnpm' ? run('pnpm', ['install'], project) : run('npm', ['install', '--no-audit', '--no-fund'], project);
    report('installs', install.isOk, install.text);
    if (!install.isOk) return;

    // pnpm shows the host's dependencies to the host alone, which crossbind finds them through.
    const isHoisted = fs.existsSync(path.join(project, 'node_modules', '@crossbind', 'extension-dialog'));
    report(`lays out the host's extensions as ${manager} does`, isHoisted === (manager === 'npm'));

    const key = inProject('crossbind', 'app', 'updater-key');
    report("runs an extension's command", key.isOk && key.text.includes('CROSSBIND_UPDATER_PRIVATE_KEY'), key.text);
    const help = inProject('crossbind', 'app', 'publish', '--help');
    report("lists crossbind's own stores", help.isOk && STORES.every((store) => help.text.includes(`  ${store}: `)), help.text);
    const add = inProject('crossbind', 'add', '@crossbind/extension-dialog');
    report('refuses to add what the host brings', !add.isOk && add.text.includes('there is nothing to add'), add.text);

    const json = path.join(project, 'licenses.json');
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
    const licenses = inProject('crossbind', 'licenses', '--platform', platform, '-e', 'app', '--check', '--json', json);
    const rows = fs.existsSync(json) ? JSON.parse(fs.readFileSync(json, 'utf8')) : [];
    const own = (Array.isArray(rows) ? rows : rows.rows ?? rows.packages ?? []).filter(({ name }) => String(name).startsWith('@crossbind/extension-'));
    report('lists the licenses of the extensions an app has, with their texts', licenses.isOk && own.length > 5 && own.every(({ licenseText }) => licenseText), licenses.text);

    const types = inProject('tsc', '-p', 'tsconfig.json');
    report("gives a page crossbind/app's types", types.isOk, types.text);

    const build = inProject('crossbind', 'app', 'build');
    const binary = fs.existsSync(path.join(project, 'dist')) ? findFile(path.join(project, 'dist'), NAME) : null;
    const code = binary ? fs.readFileSync(binary) : Buffer.alloc(0);
    const lacking = Object.entries(BUILD_MARKERS).filter(([, marker]) => !code.includes(marker)).map(([name]) => name);
    const made = (outputsOf(project)[MACHINE.key] ?? []).flatMap(({ installers }) => installers.map(({ name }) => name));
    const unmade = MACHINE.installers.filter((name) => !made.includes(name));
    const why = [
        binary ? '' : `no ${NAME} in dist`,
        lacking.length > 0 ? `the app has no code of ${lacking.join(', ')}` : '',
        unmade.length > 0 ? `no ${unmade.join(', ')} was made` : '',
    ].filter(Boolean).join('; ');
    report(`builds for this machine, with the code of the host's extensions and ${MACHINE.installers.join(' and ')}`, build.isOk && !why, why ? `${build.text}\n${why}` : build.text);
}

function buildFor(platform, project) {
    const build = run('pnpm', ['exec', 'crossbind', 'app', 'build', '-p', platform], project);
    report(`builds for ${platform}`, build.isOk && Boolean(outputsOf(project)[platform]), build.text);
    if (platform === 'ios' && build.isOk) {
        const link = run('xcodebuild', [
            '-project', path.join(project, 'dist', `${NAME}-ios`, `${NAME}.xcodeproj`), '-sdk', 'iphonesimulator', '-configuration', 'Release',
            'CODE_SIGNING_ALLOWED=NO', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=NO', 'build',
        ], path.join(project, 'dist', `${NAME}-ios`));
        report('links for the Simulator', link.isOk && link.text.includes('BUILD SUCCEEDED'), link.text);
    }
}

const isKept = process.argv.includes('--keep');
const packed = pack();
const pnpmProject = makeProject('pnpm', packed);
checkProject('pnpm', pnpmProject);
process.argv.slice(2).filter((arg) => arg !== '--keep').forEach((platform) => buildFor(platform, pnpmProject));
checkProject('npm', makeProject('npm', packed));

if (failures.length > 0) {
    console.log(`\n${failures.length} failed, in ${root}: ${failures.join('; ')}`);
    process.exit(1);
}
if (isKept) console.log(`\nthe projects are in ${root}`);
else fs.rmSync(root, { recursive: true, force: true });
console.log('\nall passed');
