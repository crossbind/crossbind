#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { semverChannelPolicy } from './release-lib.mjs';
import { commonWorkspaceVersion, compareSupportedVersions, discoverPublishablePackages } from './workspace-release.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};

function replaceTopLevelVersion(source, version, manifestPath) {
    const pattern = /^(\s*"version"\s*:\s*")([^"]+)(")/m;
    if (!pattern.test(source)) throw new Error(`${manifestPath}: top-level version field is missing.`);
    return source.replace(pattern, `$1${version}$3`);
}

export function setWorkspaceVersion({ root = REPOSITORY_ROOT, version, apply = false, log = () => {} } = {}) {
    if (!version) throw new Error('Pass the exact common train version with --version <version>.');
    const policy = semverChannelPolicy(version);
    const packages = discoverPublishablePackages(root);
    const highestVersion = packages.reduce(
        (highest, candidate) => (compareSupportedVersions(candidate.version, highest) > 0 ? candidate.version : highest),
        packages[0].version,
    );
    if (compareSupportedVersions(version, highestVersion) <= 0) {
        throw new Error(
            `Target ${version} must be newer than the highest local public package version ${highestVersion}; ` +
                'npm package versions are immutable.',
        );
    }

    const changes = packages.map((candidate) => ({
        name: candidate.name,
        manifestPath: candidate.manifestPath,
        from: candidate.version,
        to: version,
    }));
    log(`${apply ? 'Applying' : 'Would apply'} common ${policy.channel} version ${version} to ${changes.length} public packages.`);
    for (const change of changes) log(`- ${change.name}: ${change.from} -> ${change.to}`);

    if (apply) {
        for (const change of changes) {
            const target = path.join(root, change.manifestPath);
            const source = fs.readFileSync(target, 'utf8');
            fs.writeFileSync(target, replaceTopLevelVersion(source, version, change.manifestPath));
        }
        const updated = discoverPublishablePackages(root);
        if (commonWorkspaceVersion(updated) !== version) throw new Error('Common workspace version verification failed after writing manifests.');
    }
    return { version, channel: policy.channel, packageCount: changes.length, applied: apply, changes };
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
    const result = setWorkspaceVersion({
        version: valueOf('--version'),
        apply: process.argv.includes('--apply'),
        log: (message) => process.stdout.write(`${message}\n`),
    });
    if (!result.applied) process.stdout.write('Dry-run only; pass --apply to update package manifests.\n');
}
