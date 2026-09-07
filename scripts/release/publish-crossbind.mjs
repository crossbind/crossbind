#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendGitHubOutput, buildReleasePlan, writeJson } from './release-lib.mjs';
import { ensurePackagePublished, NpmCliRegistry } from './npm-registry.mjs';
import { inspectCrossbindTarball, packCrossbind, smokeTestCrossbindTarball } from './package-artifact.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const artifactDirectory = path.resolve(valueOf('--artifact-dir') ?? path.join(root, 'release-artifacts'));
const suppliedTarball = valueOf('--tarball');
const expectedIntegrity = valueOf('--expected-integrity');
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
if (!process.argv.includes('--apply')) {
    throw new Error('publish-crossbind: refusing to publish without --apply. Use release:dry-run for a write-free preview.');
}

const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const plan = buildReleasePlan({ root, gitCommit });
fs.mkdirSync(artifactDirectory, { recursive: true });

const { tarball, integrity } = suppliedTarball ? inspectCrossbindTarball(path.resolve(suppliedTarball)) : packCrossbind({ root, artifactDirectory });
if (expectedIntegrity && integrity !== expectedIntegrity) {
    throw new Error(`Transferred release tarball integrity is ${integrity}, expected ${expectedIntegrity}.`);
}
smokeTestCrossbindTarball({ tarball, expectedVersion: plan.version });
const registry = new NpmCliRegistry({ cwd: root });
const verified = await ensurePackagePublished({
    registry,
    version: plan.version,
    distTag: plan.policy.npmDistTag,
    integrity,
    tarball,
    gitCommit,
    apply: true,
});

const result = {
    package: plan.package,
    version: plan.version,
    distTag: plan.policy.npmDistTag,
    integrity: verified.integrity,
    publishedAt: verified.publishedAt,
    npmUrl: plan.manifest.npm.url,
    tarball: verified.tarball,
    provenance: verified.provenance,
    action: verified.action,
    propagationAttempts: verified.attempts,
    localTarball: path.relative(root, tarball),
};
const resultPath = path.join(artifactDirectory, 'npm-publish-result.json');
writeJson(resultPath, result);
appendGitHubOutput(githubOutput, { publishedAt: result.publishedAt, integrity, action: result.action, resultPath });
process.stdout.write(`${resultPath}: npm release ${result.action} and registry verification succeeded.\n`);
