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

    if (apply) {
        const writes = changes.map((change) => {
            const target = path.join(root, change.manifestPath);
            const source = fs.readFileSync(target, 'utf8');
            return { target, source: replaceTopLevelVersion(source, version, change.manifestPath) };
        });
        for (const write of writes) fs.writeFileSync(write.target, write.source);
        fs.writeFileSync(path.join(root, TRAIN_VERSION_SOURCE), `${version}\n`);
    }
    return { version, previousTrainVersion: currentTrainVersion, channel: policy.channel, packageCount: changes.length, applied: apply, changes };
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
