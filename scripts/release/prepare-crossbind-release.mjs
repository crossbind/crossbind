#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendGitHubOutput, buildReleasePlan, MANIFEST_ASSET_NAME, renderGitHubReleaseBody, writeJson } from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const dryRun = process.argv.includes('--dry-run');
const manifestOutput = valueOf('--output');
const bodyOutput = valueOf('--body-output');
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const publishResultPath = valueOf('--publish-result');
const schemaSource = valueOf('--schema');

if (!dryRun && !publishResultPath) {
    throw new Error('prepare-crossbind-release: use --dry-run, or provide --publish-result after npm registry verification.');
}

const gitCommit = valueOf('--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
let publishedAt = valueOf('--published-at');
let publishResult;
if (publishResultPath) {
    publishResult = JSON.parse(fs.readFileSync(path.resolve(publishResultPath), 'utf8'));
    publishedAt = publishResult.publishedAt;
}

const npmMetadata = publishResult
    ? {
          integrity: publishResult.integrity,
          tarball: publishResult.tarball,
          provenance: publishResult.provenance,
      }
    : undefined;
const plan = buildReleasePlan({ root, gitCommit, publishedAt, npmMetadata, schemaSource });
if (
    publishResult &&
    (publishResult.package !== plan.package ||
        publishResult.version !== plan.version ||
        publishResult.distTag !== plan.policy.npmDistTag ||
        publishResult.npmUrl !== plan.manifest.npm.url ||
        publishResult.integrity !== plan.manifest.npm.integrity ||
        publishResult.tarball !== plan.manifest.npm.tarball ||
        publishResult.provenance?.url !== plan.manifest.npm.provenance.url ||
        publishResult.provenance?.predicateType !== plan.manifest.npm.provenance.predicateType)
) {
    throw new Error(`${publishResultPath}: npm publish result does not match the canonical release plan.`);
}
const output = {
    version: plan.version,
    channel: plan.policy.channel,
    prerelease: plan.policy.prerelease,
    npmUrl: plan.manifest.npm.url,
    gitTag: plan.policy.gitTag,
    gitCommit,
    publishedAt: publishedAt ?? '',
    releaseNotesSource: plan.notes.source,
    releaseTitle: plan.notes.metadata.title,
    digestTableSource: plan.manifest.toolchainDigestTable.source,
    digestTableSha256: plan.digestSha256,
    promotionRequired: plan.policy.promotionRequired,
};

if (dryRun) {
    process.stdout.write(`Crossbind release dry run\n`);
    process.stdout.write(`package: ${plan.package}\n`);
    process.stdout.write(`version: ${plan.version}\n`);
    process.stdout.write(`release channel: ${plan.policy.channel}\n`);
    process.stdout.write(`npm dist-tag: ${plan.policy.npmDistTag}\n`);
    process.stdout.write(`classification: ${plan.policy.prerelease ? 'prerelease' : 'stable'}\n`);
    process.stdout.write(`git tag: ${plan.policy.gitTag}\n`);
    process.stdout.write(`release notes: ${plan.notes.source}\n`);
    process.stdout.write(`toolchain digest table: ${plan.manifest.toolchainDigestTable.source}\n`);
    process.stdout.write(`toolchain digest SHA-256: ${plan.digestSha256}\n`);
    process.stdout.write(`GitHub Release: ${plan.policy.githubRelease}\n`);
    process.stdout.write(`separate npm dist-tag promotion required: ${plan.policy.promotionRequired ? 'yes' : 'no'}\n`);
    process.stdout.write(`release manifest preview:\n${JSON.stringify(plan.manifest, null, 2)}\n`);
    process.stdout.write('No npm, git, GitHub or dist-tag writes were performed.\n');
} else {
    if (!manifestOutput || !bodyOutput) {
        throw new Error('prepare-crossbind-release: --output and --body-output are required outside dry-run mode.');
    }
    writeJson(path.resolve(manifestOutput), plan.manifest);
    const bodyFile = path.resolve(bodyOutput);
    fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
    fs.writeFileSync(bodyFile, renderGitHubReleaseBody(plan));
    process.stdout.write(`Prepared ${MANIFEST_ASSET_NAME} for ${plan.policy.gitTag}.\n`);
}

appendGitHubOutput(githubOutput, output);
