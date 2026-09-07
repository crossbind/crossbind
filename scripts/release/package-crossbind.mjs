#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendGitHubOutput, PACKAGE_JSON_SOURCE, readJson } from './release-lib.mjs';
import { inspectCrossbindTarball, packCrossbind, smokeTestCrossbindTarball } from './package-artifact.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const explicitArtifactDirectory = valueOf('--artifact-dir');
const artifactDirectory = explicitArtifactDirectory
    ? path.resolve(explicitArtifactDirectory)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-release-package-'));
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const suppliedTarball = valueOf('--tarball');
const packageJson = readJson(path.resolve(root, PACKAGE_JSON_SOURCE));

try {
    const artifact = suppliedTarball ? inspectCrossbindTarball(path.resolve(suppliedTarball)) : packCrossbind({ root, artifactDirectory });
    smokeTestCrossbindTarball({ tarball: artifact.tarball, expectedVersion: packageJson.version });
    appendGitHubOutput(githubOutput, {
        tarball: artifact.tarball,
        tarballName: path.basename(artifact.tarball),
        integrity: artifact.integrity,
    });
    process.stdout.write(
        `Exact tarball smoke passed for crossbind@${packageJson.version}: ${path.basename(artifact.tarball)} (${artifact.integrity}).\n`,
    );
} finally {
    if (!explicitArtifactDirectory) fs.rmSync(artifactDirectory, { recursive: true, force: true });
}
