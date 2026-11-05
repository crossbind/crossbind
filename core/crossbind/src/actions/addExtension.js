import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { configFileOf, writeExtension } from '../utils/configWriter.js';
import { isUnderBase } from '../utils/replaceBasePathForDocker.js';

// The lockfiles by which a project names the package manager it is installed with.
const LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
];
const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];
// A package as a registry names it, with a version, tag or range after an @; a tarball's file name is none.
const REGISTRY_SPEC = /^((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)(?:@.+)?$/;
const TARBALL = /\.(tgz|tar|tar\.gz)$/;
// What a package may be given as on Windows, which runs npm, pnpm and yarn in a shell: nothing the shell reads more into.
const WINDOWS_SPEC = /^[\w@/\\.~:+=#-]+$/;
// What a package's crossbind.extension may name: a module of its own, as ./crossbind.extension.js.
const EXTENSION_ENTRY = /^\.\/(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.m?js$/;
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'];
// The words module code keeps, which can name no import.
const RESERVED = new Set(('arguments await break case catch class const continue debugger default delete do else enum eval '
    + 'export extends false finally for function if implements import in instanceof interface let new null package private '
    + 'protected public return static super switch this throw true try typeof var void while with yield').split(' '));

const foldersUp = (dir) => (path.dirname(dir) === dir ? [dir] : [dir, ...foldersUp(path.dirname(dir))]);

// The package manager a project is installed with: the one its nearest lockfile names, else the one that runs
// crossbind, else npm.
export function packageManagerOf(project, userAgent) {
    for (const dir of foldersUp(project)) {
        const lockfile = LOCKFILES.find(([file]) => fs.existsSync(path.join(dir, file)));
        if (lockfile) return lockfile[1];
    }
    const launcher = userAgent?.split('/')[0];
    return MANAGERS.includes(launcher) ? launcher : 'npm';
}

// The package a spec names on a registry, or null where it is a path, a tarball or a repository.
export function registryName(spec) {
    return TARBALL.test(spec) ? null : (REGISTRY_SPEC.exec(spec)?.[1] ?? null);
}

// The name a config imports an extension under: its package's, without the scope and an extension- prefix, in
// camelCase, with Extension after a word module code keeps.
export function importNameOf(packageName) {
    const words = packageName.replace(/^@[^/]+\//, '').replace(/^(crossbind-)?extension-/, '').split(/[^a-zA-Z0-9]+/).filter(Boolean);
    const camel = words.map((word, i) => (i === 0 ? word : `${word[0].toUpperCase()}${word.slice(1)}`)).join('');
    if (!/^[a-zA-Z]/.test(camel)) return `extension${camel}`;
    return RESERVED.has(camel) ? `${camel}Extension` : camel;
}

const dependencyNames = (manifest) => {
    const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    return new Set(DEPENDENCY_FIELDS.flatMap((field) => Object.keys(pkg[field] ?? {})));
};

// The folder of an installed package, as Node finds it from the project: in the nearest node_modules that has it.
const packageDir = (project, name) => foldersUp(project).map((dir) => path.join(dir, 'node_modules', name))
    .find((dir) => fs.existsSync(path.join(dir, 'package.json')));

const commonFolder = (a, b) => {
    const [partsA, partsB] = [a.split(path.sep), b.split(path.sep)];
    const length = partsA.findIndex((part, i) => part !== partsB[i]);
    return partsA.slice(0, length === -1 ? partsA.length : length).join(path.sep) || path.sep;
};

// Installs the spec into the project with its package manager, as its owner would at a terminal.
function install(manager, spec, project, platform, spawn) {
    const args = [manager === 'npm' ? 'install' : 'add', spec];
    const command = [manager, ...args].join(' ');
    console.log(`crossbind: ${command}`);
    // On Windows npm, pnpm and yarn are .cmd files, which a shell alone runs; WINDOWS_SPEC keeps what it reads out of the
    // spec.
    const result = platform === 'win32'
        ? spawn(command, { cwd: project, stdio: 'inherit', shell: true })
        : spawn(manager, args, { cwd: project, stdio: 'inherit' });
    if (result.error) {
        throw new Error(`crossbind: ${manager} did not start (${result.error.message}): install it, or install ${spec} with the package manager you use and run crossbind add with its name.`);
    }
    if (result.status !== 0) {
        throw new Error(`crossbind: ${command} failed, so crossbind.config.js lists nothing new: install ${spec} yourself, then run crossbind add with its name.`);
    }
}

// The spec as a package manager would take it, or why not: a spec that opens with a dash is an option to it.
function assertSpec(spec, platform) {
    if (spec.startsWith('-')) throw new Error(`crossbind: crossbind add takes a package, and ${spec} is an option to a package manager.`);
    if (platform === 'win32' && !WINDOWS_SPEC.test(spec)) {
        throw new Error(`crossbind: on Windows crossbind add takes a package's name, with a version or tag after an @, or its path, without spaces, quotes or ^&|<>%!() for the shell its package manager runs in to read: install ${spec} yourself, then run crossbind add with its name.`);
    }
}

// The installed package the spec named: the one the install added to package.json, as a spec's own text names no package
// for every package manager, else the one a registry spec names, which package.json had already.
function installedName(spec, before, after, manifest) {
    const added = [...after].filter((name) => !before.has(name));
    const registry = registryName(spec);
    const name = added.length === 1 ? added[0] : (added.length === 0 && after.has(registry) && registry);
    if (!name) {
        throw new Error(`crossbind: crossbind add cannot tell which package ${spec} is, as ${manifest} gained ${added.length === 0 ? 'none' : 'more than one'}: run crossbind add with its name once this project's package.json lists it.`);
    }
    return { name, isAdded: added.length === 1 };
}

// Installs an extension's package into an app and lists it in crossbind.config.js's extensions; a package that
// package.json has already, given by its name alone, is listed without installing it again.
export default function addExtension(spec, {
    config, env = process.env, platform = process.platform, spawn = spawnSync,
}) {
    if (config.target.runtimeEnv !== 'app') {
        throw new Error("crossbind: an extension builds into an app, which this project is not: set target: { runtimeEnv: 'app' } in crossbind.config.js, as the desktop-app template does.");
    }
    assertSpec(spec, platform);
    const { project, base } = config.paths;
    const manifest = path.join(project, 'package.json');
    if (!fs.existsSync(manifest)) throw new Error(`crossbind: crossbind add installs into the project's package.json, which ${project} has none of.`);
    const manager = packageManagerOf(project, env.npm_config_user_agent);
    const before = dependencyNames(manifest);
    if (registryName(spec) === spec && before.has(spec)) console.log(`crossbind: package.json has ${spec} already.`);
    else install(manager, spec, project, platform, spawn);
    const { name, isAdded } = installedName(spec, before, dependencyNames(manifest), manifest);
    const dir = packageDir(project, name);
    if (!dir) throw new Error(`crossbind: ${name} is in package.json, but not installed: run ${manager} install.`);
    const removal = isAdded ? ` ${manager} ${manager === 'npm' ? 'uninstall' : 'remove'} ${name} removes it.` : '';
    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).crossbind?.extension;
    if (typeof entry !== 'string') {
        throw new Error(`crossbind: ${name} is installed, but it is no crossbind extension: its package.json has no crossbind.extension.${removal}`);
    }
    if (!EXTENSION_ENTRY.test(entry)) {
        throw new Error(`crossbind: ${name}'s crossbind.extension, ${JSON.stringify(entry)}, is no module of its own as ./crossbind.extension.js is, so crossbind.config.js lists nothing new.${removal}`);
    }
    // A build sees paths.base alone, and an extension's root is where its files are, links followed.
    const real = fs.realpathSync(dir);
    if (!isUnderBase(real, base)) {
        const above = path.relative(project, commonFolder(project, real)).split(path.sep).join('/') || '.';
        throw new Error(`crossbind: ${name} is in ${real}, outside paths.base, ${base}, which is all a build sees, so crossbind.config.js lists nothing new: set paths: { base: '${above}' } in it, a folder above both, and run crossbind add ${name} again.`);
    }
    const specifier = `${name}/${entry.slice(2)}`;
    const identifier = importNameOf(name);
    const written = writeExtension(project, specifier, identifier);
    if (!written) {
        throw new Error(`crossbind: ${name} is installed, but ${path.basename(configFileOf(project) ?? 'crossbind.config.js')} is no config crossbind can list it in safely: write import ${identifier} from '${specifier}' and extensions: [${identifier}()] into it yourself.`);
    }
    const file = path.basename(written.file);
    console.log(written.isListed
        ? `crossbind: ${file} lists ${name} already, as ${written.identifier}().`
        : `crossbind: listed ${name} in ${file} as ${written.identifier}(), which crossbind app build builds in.`);
    return { name, ...written };
}
