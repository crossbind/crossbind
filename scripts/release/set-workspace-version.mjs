#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semverChannelPolicy } from './release-lib.mjs';
import { compareSupportedVersions, discoverPublishablePackages, readTrainVersion, TRAIN_VERSION_SOURCE } from './workspace-release.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const valuesOf = (name) => process.argv.flatMap((argument, index) => (argument === name ? [process.argv[index + 1]] : [])).filter(Boolean);

// A sample that is deliberately outside the pnpm workspace installs the published packages by
// exact version, which is what makes it a real consumer of a release. Those pins are not package
// versions, so nothing else in this tool touches them, and they silently fell a train behind.
const REGISTRY_PINNED_ROOTS = ['examples'];
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function registryPinnedManifests(root, workspacePaths) {
    return REGISTRY_PINNED_ROOTS.flatMap((directory) => {
        const parent = path.join(root, directory);
        if (!fs.existsSync(parent)) return [];
        return fs
            .readdirSync(parent, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
            .map((entry) => path.join(directory, entry.name, 'package.json').split(path.sep).join('/'))
            .filter((manifestPath) => fs.existsSync(path.join(root, manifestPath)) && !workspacePaths.has(manifestPath));
    });
}

// Only a package this train publishes may be repinned: naming a version npm will never carry
// would leave the sample uninstallable.
function registryPinChanges(root, manifestPath, selected, version) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
    return DEPENDENCY_FIELDS.flatMap((field) =>
        Object.entries(manifest[field] ?? {})
            .filter(([name, spec]) => selected.has(name) && EXACT_VERSION.test(spec) && spec !== version)
            .map(([name, spec]) => ({ manifestPath, name, from: spec, to: version })),
    );
}

function replaceRegistryPin(source, name, version) {
    const pattern = new RegExp(`("${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*")[^"]+(")`);
    if (!pattern.test(source)) throw new Error(`${name}: pinned dependency vanished while rewriting it.`);
    return source.replace(pattern, `$1${version}$2`);
}

function replaceTopLevelVersion(source, version, manifestPath) {
    const pattern = /^(\s*"version"\s*:\s*")([^"]+)(")/m;
    if (!pattern.test(source)) throw new Error(`${manifestPath}: top-level version field is missing.`);
    return source.replace(pattern, `$1${version}$3`);
}

export function setWorkspaceVersion({ root = REPOSITORY_ROOT, version, packageNames = [], all = false, apply = false, log = () => {} } = {}) {
    if (!version) throw new Error('Pass the exact common train version with --version <version>.');
    if (all && packageNames.length) throw new Error('Use either --all or one or more --package selectors, not both.');
    if (!all && !packageNames.length) throw new Error('Select changed packages with --package <name>, or explicitly use --all.');
    const policy = semverChannelPolicy(version);
    const packages = discoverPublishablePackages(root);
    const currentTrainVersion = readTrainVersion(root);
    if (compareSupportedVersions(version, currentTrainVersion) <= 0) {
        throw new Error(`Target ${version} must be newer than the current train version ${currentTrainVersion}; npm train versions are immutable.`);
    }
    const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
    const selectedNames = all ? packages.map((candidate) => candidate.name) : [...new Set(packageNames)];
    const unknown = selectedNames.filter((name) => !byName.has(name));
    if (unknown.length) throw new Error(`Unknown public workspace package(s): ${unknown.join(', ')}.`);

    const changes = selectedNames
        .map((name) => byName.get(name))
        .map((candidate) => ({
            name: candidate.name,
            manifestPath: candidate.manifestPath,
            from: candidate.version,
            to: version,
        }));
    for (const change of changes) {
        if (compareSupportedVersions(version, change.from) <= 0) {
            throw new Error(`${change.name}: target ${version} must be newer than local package version ${change.from}.`);
        }
    }
    log(
        `${apply ? 'Preparing' : 'Would prepare'} ${policy.channel} train ${version} with ${changes.length}/${packages.length} public packages` +
            `${all ? ' (--all)' : ''}.`,
    );
    for (const change of changes) log(`- ${change.name}: ${change.from} -> ${change.to}`);

    const selected = new Set(selectedNames);
    const workspacePaths = new Set(packages.map((candidate) => candidate.manifestPath));
    const registryPins = registryPinnedManifests(root, workspacePaths).flatMap((manifestPath) =>
        registryPinChanges(root, manifestPath, selected, version),
    );
    for (const pin of registryPins) log(`- ${pin.manifestPath}: ${pin.name} ${pin.from} -> ${pin.to}`);
    if (registryPins.length) {
        log('The lockfile of each sample above resolves the previous train; refresh it once this one is published.');
    }

    if (apply) {
        const writes = changes.map((change) => {
            const target = path.join(root, change.manifestPath);
            const source = fs.readFileSync(target, 'utf8');
            return { target, source: replaceTopLevelVersion(source, version, change.manifestPath) };
        });
        for (const manifestPath of new Set(registryPins.map((pin) => pin.manifestPath))) {
            const target = path.join(root, manifestPath);
            const source = registryPins
                .filter((pin) => pin.manifestPath === manifestPath)
                .reduce((text, pin) => replaceRegistryPin(text, pin.name, version), fs.readFileSync(target, 'utf8'));
            writes.push({ target, source });
        }
        for (const write of writes) fs.writeFileSync(write.target, write.source);
        fs.writeFileSync(path.join(root, TRAIN_VERSION_SOURCE), `${version}\n`);
    }
    return {
        version,
        previousTrainVersion: currentTrainVersion,
        channel: policy.channel,
        packageCount: changes.length,
        applied: apply,
        changes,
        registryPins,
    };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    const result = setWorkspaceVersion({
        version: valueOf('--version'),
        packageNames: valuesOf('--package'),
        all: process.argv.includes('--all'),
        apply: process.argv.includes('--apply'),
        log: (message) => process.stdout.write(`${message}\n`),
    });
    if (!result.applied) process.stdout.write('Dry-run only; pass --apply to update package manifests.\n');
}
