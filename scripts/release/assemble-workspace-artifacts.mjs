#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceTarball, packWorkspacePackage } from './package-artifact.mjs';
import { MULTI_PLATFORM_RUNNERS, findBuildManifests, validateWorkspaceReleasePlan, writeAggregateDistCMake } from './workspace-release.mjs';
import { NODE_RUNNER_BUILDS, differentBridges } from './node-packages.mjs';
import { appendGitHubOutput, writeJson } from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const planPath = path.resolve(valueOf('--plan') ?? 'workspace-release-plan.json');
const artifactRoot = path.resolve(valueOf('--artifact-dir') ?? path.join(root, 'workspace-release-artifacts'));
const githubOutput = valueOf('--github-output') ?? process.env.GITHUB_OUTPUT;
const plan = validateWorkspaceReleasePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')), { root });
const explicitInputs = ['linux', 'macos']
    .map((runner) => ({ runner, directory: valueOf(`--${runner}-dir`) }))
    .filter((input) => input.directory)
    .map((input) => ({ ...input, directory: path.resolve(input.directory) }));
const inputRoot = valueOf('--input-root');
const workspace = plan.workspacePackages;
fs.mkdirSync(path.join(artifactRoot, 'tarballs'), { recursive: true });

const inputs = [...explicitInputs, ...(inputRoot ? findBuildManifests(path.resolve(inputRoot)) : [])];
// The node runner may build in a job per platform, which together build every platform once.
const duplicateRunners = inputs.map((input) => input.runner).filter((runner, index, all) => runner !== 'node' && all.indexOf(runner) !== index);
const nodePlatforms = inputs
    .filter((input) => input.runner === 'node')
    .map((input) => JSON.parse(fs.readFileSync(path.join(input.directory, 'build-node.json'), 'utf8')).platform);
if (nodePlatforms.length > 1 || nodePlatforms.some(Boolean)) {
    const built = nodePlatforms.map((platform) => platform ?? '(all)').sort();
    const expected = [...NODE_RUNNER_BUILDS.node.platforms].sort();
    if (built.join() !== expected.join()) throw new Error(`The node jobs built ${built.join(', ')} instead of ${expected.join(', ')}.`);
}
if (duplicateRunners.length) throw new Error(`Duplicate build manifests for runner(s): ${[...new Set(duplicateRunners)].join(', ')}.`);
const requiredRunners = new Set(
    Object.entries(plan.buildOrderByRunner)
        .filter(([, order]) => order.length > 0)
        .map(([runner]) => runner),
);
if (plan.multiPlatform.length) for (const runner of MULTI_PLATFORM_RUNNERS) requiredRunners.add(runner);
const missingRunners = [...requiredRunners].filter((runner) => !inputs.some((input) => input.runner === runner));
if (missingRunners.length) throw new Error(`Missing required platform build manifest(s): ${missingRunners.join(', ')}.`);
if (valueOf('--node-bridges') || valueOf('--node-macos-bridges')) {
    if (!valueOf('--node-bridges') || !valueOf('--node-macos-bridges')) throw new Error('--node-bridges and --node-macos-bridges go together.');
    const projects = [...plan.buildOrderByRunner['node-macos'], ...plan.multiPlatform].map((name) => workspace[name].path);
    const different = differentBridges(path.resolve(valueOf('--node-bridges')), path.resolve(valueOf('--node-macos-bridges')), projects);
    if (different.length) throw new Error(`The macOS addons bound bridges other than the Linux job's: ${different.slice(0, 5).join(', ')}`);
}

function sameFile(left, right) {
    const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return fs.statSync(left).size === fs.statSync(right).size && hash(left) === hash(right);
}

function mergeTree(source, target, aggregateCMakeFiles = []) {
    if (!fs.existsSync(source)) return;
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name);
        const to = path.join(target, entry.name);
        if (entry.isDirectory()) mergeTree(from, to, aggregateCMakeFiles);
        else {
            if (entry.name === 'CMakeLists.txt' && path.basename(path.dirname(to)) === 'prebuilt') {
                aggregateCMakeFiles.push(from);
                continue;
            }
            fs.mkdirSync(path.dirname(to), { recursive: true });
            if (fs.existsSync(to) && !sameFile(from, to)) throw new Error(`Platform build outputs conflict: ${from} and ${to}.`);
            if (!fs.existsSync(to)) fs.copyFileSync(from, to);
        }
    }
}

const artifacts = [];
for (const input of inputs) {
    const manifestPath = path.join(input.directory, `build-${input.runner}.json`);
    if (!fs.existsSync(manifestPath)) throw new Error(`Missing ${input.runner} build manifest: ${manifestPath}.`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.gitCommit !== plan.gitCommit || manifest.runner !== input.runner) {
        throw new Error(`${manifestPath}: build identity does not match the approved release plan.`);
    }
    for (const artifact of manifest.artifacts) {
        const source = path.join(input.directory, 'tarballs', artifact.filename);
        const inspected = inspectWorkspaceTarball({
            tarball: source,
            expectedName: artifact.package,
            expectedVersion: artifact.version,
        });
        if (inspected.integrity !== artifact.integrity) throw new Error(`${source}: SHA-512 integrity changed during artifact transfer.`);
        const target = path.join(artifactRoot, 'tarballs', artifact.filename);
        if (fs.existsSync(target) && !sameFile(source, target)) throw new Error(`${target}: duplicate tarball name has conflicting bytes.`);
        if (!fs.existsSync(target)) fs.copyFileSync(source, target);
        artifacts.push({ ...artifact, filename: path.basename(target) });
    }
}

for (const name of plan.multiPlatform) {
    const candidate = workspace[name];
    const packageRoot = path.join(root, candidate.path);
    const aggregateCMakeFiles = [];
    // A runner that builds in a job per platform stages the library from one of them.
    for (const runner of MULTI_PLATFORM_RUNNERS) {
        const sources = inputs
            .filter((input) => input.runner === runner)
            .map((input) => path.join(input.directory, 'multi', input.runner, candidate.path))
            .filter((source) => fs.existsSync(source));
        if (!sources.length) throw new Error(`${candidate.name}: ${runner} build did not stage its multi-platform output.`);
        sources.forEach((source) => mergeTree(source, packageRoot, aggregateCMakeFiles));
    }
    writeAggregateDistCMake(packageRoot, aggregateCMakeFiles);
    const packed = packWorkspacePackage({
        root,
        packagePath: candidate.path,
        expectedName: candidate.name,
        expectedVersion: candidate.version,
        artifactDirectory: path.join(artifactRoot, 'tarballs'),
    });
    artifacts.push({
        package: candidate.name,
        version: candidate.version,
        filename: path.basename(packed.tarball),
        integrity: packed.integrity,
        runner: 'assembled',
    });
}

const byName = new Map();
for (const artifact of artifacts) {
    if (byName.has(artifact.package)) throw new Error(`Multiple release tarballs were produced for ${artifact.package}.`);
    byName.set(artifact.package, artifact);
}
const missing = plan.publishOrder.filter((name) => !byName.has(name));
const unexpected = [...byName.keys()].filter((name) => !plan.publishOrder.includes(name));
if (missing.length || unexpected.length) {
    throw new Error(
        `Release tarball coverage mismatch; missing: ${missing.join(', ') || '(none)'}; unexpected: ${unexpected.join(', ') || '(none)'}.`,
    );
}

const result = {
    schemaVersion: 1,
    gitCommit: plan.gitCommit,
    artifacts: plan.publishOrder.map((name) => byName.get(name)),
};
writeJson(path.join(artifactRoot, 'workspace-release-artifacts.json'), result);
appendGitHubOutput(githubOutput, {
    artifactManifest: path.join(artifactRoot, 'workspace-release-artifacts.json'),
    crossbindTarball: result.artifacts.find((artifact) => artifact.package === 'crossbind')?.filename ?? '',
});
process.stdout.write(`${artifactRoot}: assembled ${result.artifacts.length} exact tarball(s); npm publication may now begin.\n`);
