#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendGitHubOutput, writeJson } from './release-lib.mjs';
import { buildWorkspaceReleasePlan, encodeWorkspacePlanOutput } from './workspace-release.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const channel = valueOf('--channel');
const output = path.resolve(valueOf('--output') ?? path.join(os.tmpdir(), 'crossbind-workspace-release-plan.json'));
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const gitCommit = valueOf('--commit') ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

const plan = await buildWorkspaceReleasePlan({ root, channel, gitCommit, log: (message) => process.stdout.write(`${message}\n`) });
if (process.argv.includes('--require-changes') && plan.packageCount === 0) {
    throw new Error(`No ${channel} package versions require publication; refusing an empty writing release.`);
}
writeJson(output, plan);
const encoded = encodeWorkspacePlanOutput(fs.readFileSync(output));
appendGitHubOutput(githubOutput, {
    planGzipBase64: encoded,
    packageCount: plan.packageCount,
    hasLinux: plan.linuxShards.length > 0,
    linuxShards: JSON.stringify(plan.linuxShards),
    hasMacos: plan.buildOrderByRunner.macos.length > 0 || plan.multiPlatform.length > 0,
    hasCrossbind: plan.packages.some((candidate) => candidate.name === 'crossbind'),
});
process.stdout.write(`${output}: ${plan.packageCount} package(s), publish order: ${plan.publishOrder.join(' -> ') || '(none)'}\n`);
process.stdout.write('No npm, git, GitHub Release, dist-tag or deployment writes were performed.\n');
