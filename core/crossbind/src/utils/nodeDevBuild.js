import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import loadJson from './loadJson.js';
import { computeInputStamp } from './inputStamp.js';
import { findHeaderImportsIn } from './headerImports.js';
import { findNativeImportsIn, nativeSpecifierTest } from './nativeImports.js';

// Set on the build a dev start runs: that build is a Node process too, which NODE_OPTIONS may hand the dev hooks again.
export const DEV_BUILD_ENV = 'CROSSBIND_DEV_BUILD';

const CLI = fileURLToPath(new URL('../bin.js', import.meta.url));
const CONFIG_EXTENSIONS = ['json', 'js', 'mjs', 'cjs', 'ts'];
// This machine's binary, built the way the Node.js playbook builds it.
const BUILD_ARGS = {
    napi: ['-p', 'host', '-a', process.arch, '-e', 'node', '-b', 'release'],
    wasm: ['-p', 'wasm', '-a', 'wasm32', '-r', 'st', '-e', 'node', '-b', 'release'],
};

const hasConfig = (dir) => CONFIG_EXTENSIONS.some((ext) => fs.existsSync(`${dir}/crossbind.config.${ext}`));
const hasNapiRuntime = (dir) => fs.existsSync(`${dir}/node_modules/@crossbind/core-embind-napi/package.json`);

function dirAbove(start, test) {
    let dir = upath.resolve(start);
    while (!test(dir)) {
        const parent = upath.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
    return dir;
}

// The nearest directory with a crossbind.config above the app's main module, else above the working directory.
export function projectDirOf(main, cwd = process.cwd()) {
    const project = (main && dirAbove(upath.dirname(main), hasConfig)) ?? dirAbove(cwd, hasConfig);
    if (!project) throw new Error(`crossbind: no crossbind.config above ${main ?? cwd}; start Node in the app, or leave out --import crossbind/node/dev.`);
    return project;
}

// A project that installs the Node-API runtime runs its addon, any other its wasm build. Looked up through the
// node_modules above the project only: pnpm's bin shims set NODE_PATH to the whole workspace.
export function devFormatOf(project) {
    return dirAbove(project, hasNapiRuntime) ? 'napi' : 'wasm';
}

// What decides whether a build is still current: the project's native sources, the files its relative native imports
// name, its config and manifest, and which native files and names its JavaScript imports - not the rest of its code.
export function nativeInputsFingerprint(config) {
    const { project, native, header, module: modules } = config.paths;
    const relativeTo = (importer) => upath.relative(project, importer);
    const imports = findNativeImportsIn(project, nativeSpecifierTest(config.ext))
        .map(({ importer, specifier }) => ({ importer: relativeTo(importer), specifier }));
    const names = findHeaderImportsIn(project, config.ext.header)
        .map(({ importer, specifier, names: taken }) => JSON.stringify([relativeTo(importer), specifier, taken]));
    const importedFiles = imports.filter(({ specifier }) => specifier.startsWith('.'))
        .map(({ importer, specifier }) => upath.resolve(project, upath.dirname(importer), specifier));
    const projectFiles = [...CONFIG_EXTENSIONS.flatMap((ext) => [`crossbind.config.${ext}`, `crossbind.overrides.${ext}`]), 'package.json']
        .map((file) => `${project}/${file}`);
    const salt = JSON.stringify({ imports: imports.map((entry) => JSON.stringify(entry)).sort(), names: names.sort() });
    return computeInputStamp(
        [...native, ...header, ...modules],
        [...config.ext.header, ...config.ext.source, ...config.ext.module, 'rs'],
        [...projectFiles, ...importedFiles],
        salt,
    );
}

function runBuild(project, args) {
    const command = `crossbind build ${args.join(' ')}`;
    console.error(`crossbind: native sources changed since the last build - ${command}`);
    const { status, error } = spawnSync(process.execPath, [CLI, 'build', ...args], {
        cwd: project, stdio: ['ignore', 2, 2], env: { ...process.env, [DEV_BUILD_ENV]: '1' },
    });
    if (error || status !== 0) throw new Error(`crossbind: ${command} failed; fix what it reports and start the app again.`, { cause: error });
}

// Builds this machine's binary when the native inputs changed since the last build a dev start ran, or when its output
// is gone, and returns the hooks that build wrote, or null for an app that imports nothing native.
export function ensureDevBuild(config, { run = runBuild } = {}) {
    const { project, cache, output } = config.paths;
    const format = devFormatOf(project);
    const stamp = `${cache}/node-dev/${format}.json`;
    const fingerprint = nativeInputsFingerprint(config);
    if (!fs.existsSync(`${output}/node/${format}.mjs`) || loadJson(stamp)?.fingerprint !== fingerprint) {
        run(project, BUILD_ARGS[format]);
        fs.mkdirSync(upath.dirname(stamp), { recursive: true });
        fs.writeFileSync(stamp, JSON.stringify({ fingerprint }));
    }
    const hooks = `${output}/node/${format}.register.mjs`;
    return fs.existsSync(hooks) ? hooks : null;
}
