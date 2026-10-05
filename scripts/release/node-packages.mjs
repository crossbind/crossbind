import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SBOM_FILE } from '../../core/crossbind/src/utils/packageLicense.js';
import { nodePackageKind } from '../lib/node-registry.mjs';
import { writeAggregateDistCMake } from './workspace-release.mjs';

export { SBOM_FILE };
// The exact Node.js versions the train verifies the packages with: the repository pin and the oldest
// supported major. The release workflow's verify_node matrix names the same files.
export const VERIFY_NODE_VERSION_FILES = ['.nvmrc', 'releases/npm/node-22.version'];

// The platforms each node runner builds addons for, and the platform packages it unpacks: the macOS
// runner takes the linux ones too, whose headers the bridges it compiles were read from.
export const NODE_RUNNER_BUILDS = {
    node: { platforms: ['linux', 'linuxmusl', 'win32'], dists: ['linux', 'linuxmusl', 'win32'] },
    'node-macos': { platforms: ['darwin'], dists: ['darwin', 'linux'] },
};

// The platforms a runner builds addons for that no package a family links brought a dist of: a port's
// platform package carries one platform, a multi-platform library all of them.
export function missingDists(root, projectPaths, platforms, pathOf) {
    const prebuiltTargets = (packagePath) => {
        const dir = path.join(root, packagePath, 'dist', 'prebuilt');
        return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    };
    return projectPaths.flatMap((projectPath) => {
        const { devDependencies = {} } = JSON.parse(fs.readFileSync(path.join(root, projectPath, 'package.json'), 'utf8'));
        const linked = Object.keys(devDependencies).map(pathOf).filter(Boolean).flatMap(prebuiltTargets);
        return platforms
            .filter((platform) => !linked.some((target) => target.startsWith(`${platform}-`)))
            .map((platform) => `${projectPath}: ${platform}`);
    });
}

// A multi-platform package is assembled only after every build, so the node runners take what the other
// runners staged of it (multi/<runner>/<path>) instead of a tarball.
export function mergeStagedMulti({ root, inputs, workspace }) {
    const staged = inputs.flatMap(({ directory, runner, stagedMultiPlatform = [] }) =>
        stagedMultiPlatform
            .map((name) => workspace[name]?.path)
            .filter((packagePath) => packagePath && fs.existsSync(path.join(directory, 'multi', runner, packagePath)))
            .map((packagePath) => ({ packagePath, source: path.join(directory, 'multi', runner, packagePath) })),
    );
    staged.forEach(({ packagePath, source }) => fs.cpSync(source, path.join(root, packagePath), { recursive: true }));
    new Set(staged.map(({ packagePath }) => packagePath)).forEach((packagePath) =>
        writeAggregateDistCMake(
            path.join(root, packagePath),
            staged
                .filter((entry) => entry.packagePath === packagePath)
                .map(({ source }) => path.join(source, 'dist', 'prebuilt', 'CMakeLists.txt'))
                .filter((file) => fs.existsSync(file)),
        ),
    );
}

// What a node runner adds to the multi-platform package: the addons it built and, from one runner only, their
// loader and the entry that boots it, so the assembled package does not hold two copies to compare.
export function stageNodeOutputs({ packageRoot, stagingRoot, withEntry }) {
    const dist = path.join(packageRoot, 'dist');
    const entries = fs.readdirSync(dist).filter((file) => file.endsWith('.node') || (withEntry && file.endsWith('.native.cjs')));
    if (!entries.some((file) => file.endsWith('.node'))) throw new Error(`${packageRoot}: the build left no addon in dist.`);
    [...entries, ...(withEntry ? ['node/napi.mjs', 'node/napi.d.mts'] : [])].forEach((entry) => {
        fs.mkdirSync(path.dirname(path.join(stagingRoot, 'dist', entry)), { recursive: true });
        fs.copyFileSync(path.join(dist, entry), path.join(stagingRoot, 'dist', entry));
    });
}

// inputs: the build manifests other runners wrote, each with the directory its tarballs/ is in.
export function variantTarballs(inputs, workspace, platforms) {
    const isVariant = new RegExp(`^ports/[^/]+/(${platforms.join('|')})$`);
    return inputs.flatMap(({ directory, artifacts }) =>
        artifacts
            .filter((artifact) => isVariant.test(workspace[artifact.package]?.path ?? ''))
            .map((artifact) => ({ file: path.join(directory, 'tarballs', artifact.filename), path: workspace[artifact.package].path })),
    );
}

const BRIDGE_STATE = ['cache.json', 'build/interface', 'build/bridge', 'build/swigview'];
const PACKED_ROOT = 'root.txt';
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true }).filter((file) => fs.statSync(path.join(dir, file)).isFile());

// crossbind keys its interface and bridge caches by the physical absolute path it ran in, and the two
// runners check out at different paths, so the packed state records its root and a restore moves every
// path to its own.
export function packBridgeState({ root, projectPaths, outputDir }) {
    projectPaths.forEach((projectPath) => {
        BRIDGE_STATE.map((entry) => path.join(projectPath, '.crossbind', entry))
            .filter((relative) => fs.existsSync(path.join(root, relative)))
            .forEach((relative) => fs.cpSync(path.join(root, relative), path.join(outputDir, relative), { recursive: true }));
    });
    fs.writeFileSync(path.join(outputDir, PACKED_ROOT), fs.realpathSync(root));
}

// Bytes are moved as latin1, which maps each byte to one character, so a file that is not UTF-8 keeps them.
export function restoreBridgeState({ root, inputDir }) {
    const asBytes = (text) => Buffer.from(text, 'utf8').toString('latin1');
    const packedRoot = asBytes(fs.readFileSync(path.join(inputDir, PACKED_ROOT), 'utf8'));
    const target = asBytes(fs.realpathSync(root));
    filesUnder(inputDir)
        .filter((file) => file !== PACKED_ROOT)
        .forEach((file) => {
            const destination = path.join(root, file);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            const content = fs.readFileSync(path.join(inputDir, file));
            const text = content.toString('latin1');
            fs.writeFileSync(destination, text.includes(packedRoot) ? Buffer.from(text.replaceAll(packedRoot, target), 'latin1') : content);
            if (path.basename(file) === 'cache.json') assertCacheMoved(destination, fs.realpathSync(root));
        });
}

// A key left under another root would make crossbind regenerate that bridge, which the macOS runner cannot.
function assertCacheMoved(file, root) {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    const stale = Object.values(cache)
        .flatMap((section) => (section && typeof section === 'object' ? Object.keys(section) : []))
        .filter((key) => path.isAbsolute(key) && !key.startsWith(`${root}${path.sep}`));
    if (stale.length) throw new Error(`${file}: cache keys outside ${root} after the restore: ${stale.slice(0, 3).join(', ')}`);
}

// Every bridge, interface and cache file of a build, by path and content, to tell what a later build changed.
export function bridgeStateDigest(root, projectPaths) {
    return new Map(
        projectPaths.flatMap((projectPath) =>
            ['build/bridge', 'build/interface', 'cache.json']
                .map((entry) => path.join(projectPath, '.crossbind', entry))
                .filter((relative) => fs.existsSync(path.join(root, relative)))
                .flatMap((relative) =>
                    fs.statSync(path.join(root, relative)).isFile()
                        ? [relative]
                        : filesUnder(path.join(root, relative)).map((file) => path.join(relative, file)),
                )
                .map((relative) => [
                    relative.split(path.sep).join('/'),
                    crypto
                        .createHash('sha256')
                        .update(fs.readFileSync(path.join(root, relative)))
                        .digest('hex'),
                ]),
        ),
    );
}

export function changedBridgeState(before, after) {
    return [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
}

// The packages an addon links come from the tarballs the other runners packed, so it links exactly what
// the train publishes.
export function unpackDists({ root, tarballs, run = execFileSync }) {
    tarballs.forEach(({ file, path: packagePath }) => {
        const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-unpack-'));
        try {
            run('tar', ['-xzf', file, '-C', staging]);
            const dist = path.join(staging, 'package', 'dist');
            if (!fs.existsSync(dist)) return;
            const target = path.join(root, packagePath, 'dist');
            fs.rmSync(target, { recursive: true, force: true });
            fs.cpSync(dist, target, { recursive: true });
        } finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
    });
}

const ELF_MACHINES = { 0x3e: 'x64', 0xb7: 'arm64' };
const MACHO_CPU_TYPES = { 0x01000007: 'x64', 0x0100000c: 'arm64' };
const PE_MACHINES = { 0x8664: 'x64', 0xaa64: 'arm64' };
export const FORMAT_OF_OS = { darwin: 'macho', linux: 'elf', win32: 'pe' };
const HEADER_BYTES = 4096;

export function binaryIdentity(buffer) {
    if (buffer.length >= 20 && buffer.readUInt32BE(0) === 0x7f454c46) {
        const machine = buffer.readUInt16LE(18);
        return { format: 'elf', arch: ELF_MACHINES[machine] ?? `machine 0x${machine.toString(16)}` };
    }
    if (buffer.length >= 8 && buffer.readUInt32LE(0) === 0xfeedfacf) {
        const cpu = buffer.readUInt32LE(4);
        return { format: 'macho', arch: MACHO_CPU_TYPES[cpu] ?? `cputype 0x${cpu.toString(16)}` };
    }
    if (buffer.length >= 0x40 && buffer.toString('latin1', 0, 2) === 'MZ') {
        const offset = buffer.readUInt32LE(0x3c);
        if (buffer.length >= offset + 6 && buffer.toString('latin1', offset, offset + 4) === 'PE\0\0') {
            const machine = buffer.readUInt16LE(offset + 4);
            return { format: 'pe', arch: PE_MACHINES[machine] ?? `machine 0x${machine.toString(16)}` };
        }
    }
    return { format: 'unknown', arch: 'unknown' };
}

function readHeader(file) {
    const descriptor = fs.openSync(file, 'r');
    try {
        const buffer = Buffer.alloc(HEADER_BYTES);
        return buffer.subarray(0, fs.readSync(descriptor, buffer, 0, HEADER_BYTES, 0));
    } finally {
        fs.closeSync(descriptor);
    }
}

function addonProblems(dir, { main, os: [platformOs], cpu: [arch] }) {
    const file = path.join(dir, main);
    if (!fs.existsSync(file)) return [`${main} is missing; the build did not stage an addon for this package`];
    const identity = binaryIdentity(readHeader(file));
    const expected = { format: FORMAT_OF_OS[platformOs], arch };
    return identity.format === expected.format && identity.arch === expected.arch
        ? []
        : [`${main} is a ${identity.format} ${identity.arch} binary; the package declares ${expected.format} ${expected.arch}`];
}

// The package root is the entry crossbind writes for the addons, which boots the loader beside it.
function bindingsProblems(dir) {
    const entry = path.join(dir, 'dist', 'node', 'napi.mjs');
    if (!fs.existsSync(entry)) return ['dist/node/napi.mjs is missing; the build did not write the bindings'];
    const loader = /createRequire\(import\.meta\.url\)\('([^']+)'\)/.exec(fs.readFileSync(entry, 'utf8'))?.[1];
    return [
        ...(fs.existsSync(path.join(dir, 'dist', 'node', 'napi.d.mts')) ? [] : ['dist/node/napi.d.mts is missing']),
        ...(loader && fs.existsSync(path.join(dir, 'dist', 'node', loader)) ? [] : [`dist/node/napi.mjs requires ${loader}, which is missing`]),
    ];
}

function licenseFileProblems(dir, { name, license }) {
    const problems = [];
    const licenseFile = path.join(dir, 'LICENSE');
    if (!fs.existsSync(licenseFile)) problems.push('LICENSE is missing; the build of the package writes it with crossbind licenses --package');
    else {
        const text = fs.readFileSync(licenseFile, 'utf8');
        if (!text.includes(license)) problems.push(`LICENSE does not state the license field ${license}`);
        if (text.includes('(missing:')) problems.push('LICENSE is missing the text of a component');
    }
    const sbomFile = path.join(dir, SBOM_FILE);
    if (!fs.existsSync(sbomFile)) problems.push(`${SBOM_FILE} is missing; the build of the package writes it with crossbind licenses --package`);
    else if (JSON.parse(fs.readFileSync(sbomFile, 'utf8')).metadata?.component?.name !== name)
        problems.push(`${SBOM_FILE} describes another package`);
    return problems;
}

// What keeps a standalone Node-API package from being packed: a build that did not fill it.
export function nodePackageProblems(dir) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!nodePackageKind({ name: manifest.name, manifest })) return [`${manifest.name} is not a standalone Node-API package`];
    return [...(manifest.os ? addonProblems(dir, manifest) : bindingsProblems(dir)), ...licenseFileProblems(dir, manifest)];
}
