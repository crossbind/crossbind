#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureGitTag, GitHubCliRelease } from './github-release.mjs';
import { NpmCliRegistry, publishPackage, trustedPublishingEnvironment, verifyPublishedPackage } from './npm-registry.mjs';
import { inspectWorkspaceTarball } from './package-artifact.mjs';
import { appendGitHubOutput, writeJson } from './release-lib.mjs';
import { validateWorkspaceReleasePlan } from './workspace-release.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
if (!process.argv.includes('--apply')) {
    throw new Error('publish-workspace-release: refusing to publish without --apply. Dispatch the protected workflow after a dry-run.');
}
trustedPublishingEnvironment();
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const planPath = path.resolve(valueOf('--plan') ?? 'workspace-release-plan.json');
const artifactRoot = path.resolve(valueOf('--artifact-dir') ?? 'workspace-release-artifacts');
const outputRoot = path.resolve(valueOf('--output-dir') ?? path.join(artifactRoot, 'results'));
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const plan = validateWorkspaceReleasePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')), { root });
const artifactManifest = JSON.parse(fs.readFileSync(path.join(artifactRoot, 'workspace-release-artifacts.json'), 'utf8'));
const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (gitCommit !== plan.gitCommit || artifactManifest.gitCommit !== plan.gitCommit) {
    throw new Error(`Release plan, artifact manifest and checkout must all identify ${plan.gitCommit}; checkout is ${gitCommit}.`);
}
const candidateByName = new Map(plan.packages.map((candidate) => [candidate.name, candidate]));
const artifactByName = new Map(artifactManifest.artifacts.map((artifact) => [artifact.package, artifact]));
const github = new GitHubCliRelease({ cwd: root });
if (artifactManifest.schemaVersion !== 1 || artifactManifest.artifacts.length !== artifactByName.size) {
    throw new Error('Assembled release artifact manifest is malformed or contains duplicate packages.');
}
const approvedArtifacts = new Map();

for (const name of plan.publishOrder) {
    const candidate = candidateByName.get(name);
    const artifact = artifactByName.get(name);
    if (!artifact) throw new Error(`No approved tarball exists for ${name}.`);
    const inspected = inspectWorkspaceTarball({
        tarball: path.join(artifactRoot, 'tarballs', artifact.filename),
        expectedName: candidate.name,
        expectedVersion: candidate.version,
    });
    if (inspected.integrity !== artifact.integrity) throw new Error(`${artifact.filename}: integrity conflicts with the assembled manifest.`);
    approvedArtifacts.set(name, inspected);
}
if (artifactByName.size !== approvedArtifacts.size) throw new Error('Assembled release artifact manifest contains an unexpected package.');

for (const name of plan.publishOrder) {
    const candidate = candidateByName.get(name);
    const existingTagCommit = await github.tagCommit(candidate.gitTag);
    if (existingTagCommit && existingTagCommit !== gitCommit) {
        throw new Error(`${candidate.gitTag} points to ${existingTagCommit}, expected ${gitCommit}. Refusing npm publication.`);
    }
}

const results = [];
const registryFor = (name) => new NpmCliRegistry({ cwd: root, packageName: candidateByName.get(name).name });

// The train publishes in dependency order, then verifies in a second pass. npm accepts a publish
// minutes before it exposes it, so waiting for each package in turn cost the beta 58 train about
// a hundred seconds per package; publishing first lets that indexing run while the next tarballs
// upload. The first package is still published AND verified on its own: a systemic problem (a
// missing trusted publisher, a provenance mismatch) then stops the train before anything else is
// exposed, which is the fail-fast the per-package gate used to provide.
const publishOne = async (name) => {
    const candidate = candidateByName.get(name);
    const inspected = approvedArtifacts.get(name);
    const { action } = await publishPackage({
        registry: registryFor(name),
        version: candidate.version,
        distTag: candidate.npmDistTag,
        integrity: inspected.integrity,
        tarball: inspected.tarball,
        apply: true,
    });
    return action;
};

const verifyOne = async (name, action) => {
    const candidate = candidateByName.get(name);
    const artifact = artifactByName.get(name);
    const inspected = approvedArtifacts.get(name);
    const verified = await verifyPublishedPackage({
        registry: registryFor(name),
        version: candidate.version,
        distTag: candidate.npmDistTag,
        integrity: inspected.integrity,
        gitCommit,
        action,
    });
    results.push({
        package: candidate.name,
        version: candidate.version,
        channel: candidate.channel,
        distTag: candidate.npmDistTag,
        integrity: verified.integrity,
        publishedAt: verified.publishedAt,
        npmUrl: `https://www.npmjs.com/package/${candidate.name}/v/${candidate.version}`,
        tarball: verified.tarball,
        provenance: verified.provenance,
        gitTag: candidate.gitTag,
        gitCommit,
        action: verified.action,
        propagationAttempts: verified.attempts,
        localTarball: `tarballs/${artifact.filename}`,
    });
    process.stdout.write(`${candidate.name}@${candidate.version}: ${verified.action}, integrity and provenance verified.\n`);
};

const [canary, ...rest] = plan.publishOrder;
const actions = new Map();
actions.set(canary, await publishOne(canary));
await verifyOne(canary, actions.get(canary));

for (const name of rest) {
    actions.set(name, await publishOne(name));
}
process.stdout.write(`npm accepted ${rest.length} further package(s); verifying every one of them.\n`);
for (const name of rest) {
    await verifyOne(name, actions.get(name));
}

for (const name of plan.publishOrder) {
    const candidate = candidateByName.get(name);
    await ensureGitTag({ github, tag: candidate.gitTag, commit: gitCommit, apply: true });
}

fs.mkdirSync(outputRoot, { recursive: true });
const releaseResult = { schemaVersion: 1, gitCommit, channel: plan.channel, packages: results };
const resultPath = path.join(outputRoot, 'workspace-release-result.json');
writeJson(resultPath, releaseResult);
const crossbind = results.find((result) => result.package === 'crossbind');
if (crossbind) writeJson(path.join(outputRoot, 'npm-publish-result.json'), crossbind);
appendGitHubOutput(githubOutput, {
    resultPath,
    crossbindResultPath: crossbind ? path.join(outputRoot, 'npm-publish-result.json') : '',
    publishedCount: results.filter((result) => result.action === 'published').length,
    reusedCount: results.filter((result) => result.action === 'reused').length,
});
process.stdout.write(`${resultPath}: ${results.length} package(s) verified and exact tags completed.\n`);
