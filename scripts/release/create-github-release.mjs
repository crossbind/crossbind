#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GitHubCliRelease, ensureGitHubRelease, ensureGitTag } from './github-release.mjs';
import {
    appendGitHubOutput,
    buildReleasePlan,
    MANIFEST_ASSET_NAME,
    readJson,
    renderGitHubReleaseBody,
    TOOLCHAIN_DIGEST_SOURCE,
    validateReleaseManifest,
    writeJson,
} from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const manifestPath = path.resolve(valueOf('--manifest') ?? path.join(root, 'release-artifacts', MANIFEST_ASSET_NAME));
const bodyPath = path.resolve(valueOf('--body') ?? path.join(root, 'release-artifacts', 'github-release-body.md'));
const outputPath = path.resolve(valueOf('--output') ?? path.join(root, 'release-artifacts', 'crossbind-release-output.json'));
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const apply = process.argv.includes('--apply');
if (!apply) throw new Error('create-github-release: refusing GitHub writes without --apply.');

const manifest = readJson(manifestPath);
validateReleaseManifest(manifest, { root });
const plan = buildReleasePlan({
    root,
    gitCommit: manifest.git.commit,
    publishedAt: manifest.publishedAt,
    npmMetadata: manifest.npm,
});
const expectedBody = renderGitHubReleaseBody(plan);
if (fs.readFileSync(bodyPath, 'utf8') !== expectedBody) {
    throw new Error(`${bodyPath} does not match the body rendered from ${plan.notes.source}.`);
}

const github = new GitHubCliRelease({ cwd: root });
await ensureGitTag({ github, tag: manifest.git.tag, commit: manifest.git.commit, apply: true });
const completed = await ensureGitHubRelease({
    github,
    tag: manifest.git.tag,
    title: plan.notes.metadata.title,
    body: expectedBody,
    bodyFile: bodyPath,
    prerelease: manifest.prerelease,
    assets: [
        { name: MANIFEST_ASSET_NAME, file: manifestPath },
        { name: path.basename(TOOLCHAIN_DIGEST_SOURCE), file: path.resolve(root, TOOLCHAIN_DIGEST_SOURCE) },
    ],
    apply: true,
});
const releaseManifestAssetUrl = completed.assets[MANIFEST_ASSET_NAME];
if (!releaseManifestAssetUrl) throw new Error(`${MANIFEST_ASSET_NAME} has no exact-tag release asset URL.`);

const output = {
    version: manifest.version,
    channel: manifest.channel,
    prerelease: manifest.prerelease,
    npmUrl: manifest.npm.url,
    gitTag: manifest.git.tag,
    gitCommit: manifest.git.commit,
    publishedAt: manifest.publishedAt,
    releaseManifestAssetUrl,
    releaseNotesSource: manifest.releaseNotes.source,
};
writeJson(outputPath, output);
appendGitHubOutput(githubOutput, output);
process.stdout.write(`${outputPath}: exact-tag release outputs persisted for site consumption.\n`);
