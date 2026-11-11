import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGES } from '../compiler/packages.js';

// The node_modules a playground project builds with. The compiler image and the site's prebuilt samples both build on
// these, so an unedited sample's module is the one a compile would make.

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI_DIR = path.join(REPO_DIR, 'core', 'crossbind');
const EMBIND_RUST_DIR = path.join(REPO_DIR, 'core', 'embind-rust');
// The lockfile and the settings it was resolved under: the overrides and the release-age policy.
const WORKSPACE_FILES = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
// What pnpm records of an install, with timestamps: nothing needs it, and the image hash must not move with it.
const PNPM_STATE = ['.modules.yaml', '.pnpm-workspace-state-v1.json'];
// The compiler image's: linux on either CPU. Without them a deploy is for the machine it runs on.
export const IMAGE_PLATFORMS = Object.freeze(['--os', 'linux', '--cpu', 'x64', '--cpu', 'arm64']);
// crossbind's optional dependency on the workspace's bridge-tools, which a deploy from the lockfile takes only injected.
const BRIDGE_TOOLS = '@crossbind/bridge-tools';
const BRIDGE_TOOLS_DIR = path.join(REPO_DIR, 'tooling', 'bridge-tools');
const BRIDGE_TOOLS_LOCK = `    optionalDependencies:\n      '${BRIDGE_TOOLS}':\n        specifier: workspace:*\n        version: link:../../tooling/bridge-tools\n`;
// crossbind's dependencies on its own extensions, as the package source conan, which are packages of the workspace too.
const OWN_EXTENSION = /^@crossbind\/extension-(.+)$/;
const CLI_IMPORTER = '\n  core/crossbind:\n';

// The copy leaves bridge-tools out: the compiler image runs on Linux, where crossbind has no use for it.
function withoutBridgeTools(workspace, cli) {
    const lockfile = path.join(workspace, 'pnpm-lock.yaml');
    const lock = fs.readFileSync(lockfile, 'utf8');
    if (!lock.includes(BRIDGE_TOOLS_LOCK)) throw new Error(`crossbind: pnpm-lock.yaml lists ${BRIDGE_TOOLS} for crossbind otherwise than node-modules.mjs expects.`);
    fs.writeFileSync(lockfile, lock.replace(BRIDGE_TOOLS_LOCK, ''));
    const manifestFile = path.join(cli, 'package.json');
    const { optionalDependencies, ...manifest } = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const optional = Object.fromEntries(Object.entries(optionalDependencies).filter(([name]) => name !== BRIDGE_TOOLS));
    fs.writeFileSync(manifestFile, JSON.stringify(Object.keys(optional).length ? { ...manifest, optionalDependencies: optional } : manifest, null, 4));
}

// Each with its folder, and what the lockfile says of it for crossbind.
function ownExtensions() {
    const { dependencies = {} } = JSON.parse(fs.readFileSync(path.join(CLI_DIR, 'package.json'), 'utf8'));
    return Object.entries(dependencies).filter(([, range]) => String(range).startsWith('workspace:')).map(([name, range]) => {
        const extension = OWN_EXTENSION.exec(name);
        if (!extension) throw new Error(`crossbind: crossbind depends on ${name} of the workspace, whose folder node-modules.mjs does not know.`);
        const folder = `extensions/${extension[1]}`;
        return { name, folder, lock: `      '${name}':\n        specifier: ${range}\n        version: link:../../${folder}\n` };
    });
}

// Nor its own extensions: a deploy takes a workspace package injected, and then records the folder it came from, which
// is another for every deploy.
function withoutOwnExtensions(workspace, cli, extensions) {
    const lockfile = path.join(workspace, 'pnpm-lock.yaml');
    const lock = extensions.reduce((text, { name, lock: entry }) => {
        const at = text.indexOf(entry, text.indexOf(CLI_IMPORTER));
        if (at === -1) throw new Error(`crossbind: pnpm-lock.yaml lists ${name} for crossbind otherwise than node-modules.mjs expects.`);
        return `${text.slice(0, at)}${text.slice(at + entry.length)}`;
    }, fs.readFileSync(lockfile, 'utf8'));
    fs.writeFileSync(lockfile, lock);
    const names = extensions.map(({ name }) => name);
    const manifestFile = path.join(cli, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => !names.includes(name)));
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, dependencies }, null, 4));
}

// One of them in the deployed crossbind, as npm would lay out what its package publishes, with its version.
function addOwnExtension(target, { name, folder }) {
    const source = path.join(REPO_DIR, folder);
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
    if (Object.keys(manifest.dependencies ?? {}).length) throw new Error(`crossbind: ${name} has dependencies of its own, which node-modules.mjs installs none of.`);
    ['package.json', 'LICENSE', 'README.md', ...(manifest.files ?? [])].filter((entry) => fs.existsSync(path.join(source, entry)))
        .forEach((entry) => fs.cpSync(path.join(source, entry), path.join(target, 'node_modules', name, entry), { recursive: true }));
    return [name, manifest.version];
}

// crossbind from this repository with every version the workspace lockfile pins; hoisted lays the packages out as npm
// does, and no install script runs. pnpm deploys from a lockfile only with injected workspace packages, of which
// the copy leaves crossbind none. It records its settings as the install state of the workspace it runs in, after which
// pnpm would reinstall that workspace before running a script, so it runs in a copy holding the lockfile, its settings
// and crossbind alone.
export function deployCli(target, platforms = []) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cli-'));
    const cli = path.join(workspace, path.relative(REPO_DIR, CLI_DIR));
    const extensions = ownExtensions();
    try {
        WORKSPACE_FILES.forEach((file) => fs.copyFileSync(path.join(REPO_DIR, file), path.join(workspace, file)));
        fs.cpSync(CLI_DIR, cli, { recursive: true, filter: (source) => path.basename(source) !== 'node_modules' });
        withoutBridgeTools(workspace, cli);
        withoutOwnExtensions(workspace, cli, extensions);
        execFileSync('pnpm', [
            '--silent', '--filter', 'crossbind', 'deploy', '--prod', '--frozen-lockfile', '--ignore-scripts',
            '--config.inject-workspace-packages=true', '--config.node-linker=hoisted', ...platforms, target,
        ], { cwd: cli, stdio: 'inherit' });
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
    PNPM_STATE.forEach((file) => fs.rmSync(path.join(target, 'node_modules', file), { force: true }));
    // crossbind finds its own extensions by its manifest's dependencies, so each is named there again, by its version.
    const added = extensions.map((extension) => addOwnExtension(target, extension));
    const manifestFile = path.join(target, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const dependencies = Object.fromEntries(Object.entries({ ...manifest.dependencies, ...Object.fromEntries(added) }).sort(([a], [b]) => (a < b ? -1 : 1)));
    fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, dependencies }, null, 4));
    // On a Mac crossbind makes every bridge with bridge-tools, so a deploy for this Mac takes the workspace's.
    if (!platforms.length && process.platform === 'darwin') {
        ['package.json', 'index.js', 'dist'].filter((entry) => fs.existsSync(path.join(BRIDGE_TOOLS_DIR, entry))).forEach((entry) => {
            fs.cpSync(path.join(BRIDGE_TOOLS_DIR, entry), path.join(target, 'node_modules', BRIDGE_TOOLS, entry), { recursive: true });
        });
    }
}

// The ports among `packages` (compiler/packages.js), packed from npm at their pinned version and refused unless npm's
// integrity is the one the catalog pins, and @crossbind/core-embind-rust from this repository, which a build without a
// bundler needs for Rust.
export function packModules(target, packages = PACKAGES) {
    const packs = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-packs-'));
    const pack = (args, cwd) => JSON.parse(execFileSync('npm', ['pack', ...args, '--json', '--ignore-scripts', '--pack-destination', packs], { cwd, encoding: 'utf8' }))[0];
    const unpack = (tarball, name) => {
        const dir = path.join(target, name);
        fs.mkdirSync(dir, { recursive: true });
        execFileSync('tar', ['-xzf', path.join(packs, tarball), '-C', dir, '--strip-components=1']);
    };
    try {
        const tarballs = packages.flatMap(({ version, tarballs: own = [] }) => own.map((tarball) => ({ ...tarball, version })));
        tarballs.forEach(({ name, version, integrity }) => {
            const packed = pack([`${name}@${version}`]);
            if (packed.integrity !== integrity) throw new Error(`${name}@${version} is ${packed.integrity}; compiler/packages.js pins ${integrity}.`);
            unpack(packed.filename, name);
        });
        // A port's config imports the configs of the ports it depends on.
        const packed = new Set(tarballs.map(({ name }) => name));
        const missing = [...packed]
            .flatMap((name) => Object.keys(JSON.parse(fs.readFileSync(path.join(target, name, 'package.json'), 'utf8')).dependencies ?? {}))
            .filter((dependency) => dependency.startsWith('@crossbind/port-') && !packed.has(dependency));
        if (missing.length) throw new Error(`compiler/packages.js lacks ${[...new Set(missing)].join(', ')}, which a port it lists depends on.`);
        unpack(pack([], EMBIND_RUST_DIR).filename, '@crossbind/core-embind-rust');
    } finally {
        fs.rmSync(packs, { recursive: true, force: true });
    }
}
