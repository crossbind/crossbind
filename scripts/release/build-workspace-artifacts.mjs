#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packCrossbind, packWorkspacePackage, smokeTestCrossbindTarball } from './package-artifact.mjs';
import { MULTI_PLATFORM_BUILDS, RUNNERS, findBuildManifests, multiPlatformBuildArgs, validateWorkspaceReleasePlan } from './workspace-release.mjs';
import {
    NODE_RUNNER_BUILDS,
    bridgeStateDigest,
    changedBridgeState,
    mergeStagedMulti,
    missingDists,
    packBridgeState,
    restoreBridgeState,
    stageNodeOutputs,
    unpackDists,
    variantTarballs,
} from './node-packages.mjs';
import { writeJson } from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const runner = valueOf('--runner');
if (!RUNNERS.includes(runner)) {
    throw new Error(`--runner must be one of ${RUNNERS.join(', ')}.`);
}
const planPath = path.resolve(valueOf('--plan') ?? 'workspace-release-plan.json');
const artifactRoot = path.resolve(valueOf('--artifact-dir') ?? path.join(root, `workspace-release-${runner}`));
const plan = validateWorkspaceReleasePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')), { root });
const workspace = plan.workspacePackages;
const candidates = new Set(plan.packages.map((candidate) => candidate.name));
const buildOrder = plan.buildOrderByRunner[runner];

fs.mkdirSync(path.join(artifactRoot, 'tarballs'), { recursive: true });

for (const name of buildOrder) {
    const candidate = workspace[name];
    if (!candidate) throw new Error(`Release plan refers to unknown workspace package ${name}.`);
    if (candidate.prepublishOnly) {
        process.stdout.write(`[${runner}] build ${name}@${candidate.version}: ${candidate.prepublishOnly}\n`);
        execFileSync('pnpm', ['--dir', path.join(root, candidate.path), 'run', 'prepublishOnly'], { cwd: root, stdio: 'inherit' });
    }
}

for (const name of plan.multiPlatform) {
    const candidate = workspace[name];
    const platforms = MULTI_PLATFORM_BUILDS[runner] ?? [];
    for (const platform of platforms) {
        process.stdout.write(`[${runner}] build ${name}@${candidate.version} for ${platform}\n`);
        execFileSync('pnpm', ['--dir', path.join(root, candidate.path), 'exec', 'crossbind', ...multiPlatformBuildArgs(platform)], {
            cwd: root,
            stdio: 'inherit',
        });
    }
    if (platforms.length) {
        const stagingRoot = path.join(artifactRoot, 'multi', runner, candidate.path);
        const packageRoot = path.join(root, candidate.path);
        for (const entry of fs.readdirSync(packageRoot, { withFileTypes: true })) {
            if (entry.name !== 'dist' && !entry.name.endsWith('.xcframework')) continue;
            fs.cpSync(path.join(packageRoot, entry.name), path.join(stagingRoot, entry.name), { recursive: true });
        }
    }
}

const nodeBuild = NODE_RUNNER_BUILDS[runner];
if (nodeBuild) {
    const inputRoot = valueOf('--input-root');
    const inputs = (inputRoot ? findBuildManifests(path.resolve(inputRoot)) : []).map(({ runner: from, directory }) => {
        const { artifacts, stagedMultiPlatform } = JSON.parse(fs.readFileSync(path.join(directory, `build-${from}.json`), 'utf8'));
        return { directory, runner: from, artifacts, stagedMultiPlatform };
    });
    // Each standalone package builds itself: an addon package its addon, the package of the bindings their loader.
    const packagePaths = buildOrder.map((name) => workspace[name].path);
    // A macOS addon package compiles the bridges the Linux job generates, which a darwin build there does without linking.
    const bridgeOnlyPaths = runner === 'node' ? plan.buildOrderByRunner['node-macos'].map((name) => workspace[name].path) : [];
    // The multi-platform library ships its own addons, whose bridges travel to the macOS runner like a package's.
    const multiPaths = plan.multiPlatform.map((name) => workspace[name].path);
    const bridgePaths = [...packagePaths, ...bridgeOnlyPaths, ...multiPaths];
    unpackDists({ root, tarballs: variantTarballs(inputs, workspace, nodeBuild.dists) });
    mergeStagedMulti({ root, inputs, workspace });
    const missing = missingDists(root, packagePaths, nodeBuild.dists, (name) => workspace[name]?.path);
    if (missing.length) throw new Error(`[${runner}] no package of this train brought the archives for ${missing.join(', ')}.`);
    if (valueOf('--bridges')) restoreBridgeState({ root, inputDir: path.resolve(valueOf('--bridges')) });
    const handedOver = valueOf('--bridges') ? bridgeStateDigest(root, bridgePaths) : null;
    const run = (dir, args) => {
        process.stdout.write(`[${runner}] ${path.relative(root, dir)}: ${args.join(' ')}\n`);
        execFileSync('pnpm', ['--dir', dir, ...args], { cwd: root, stdio: 'inherit' });
    };
    for (const packagePath of packagePaths) run(path.join(root, packagePath), ['run', 'build']);
    for (const packagePath of bridgeOnlyPaths) {
        const { cpu } = JSON.parse(fs.readFileSync(path.join(root, packagePath, 'package.json'), 'utf8'));
        run(path.join(root, packagePath), ['exec', 'crossbind', 'build', '-p', 'darwin', '-a', cpu[0], '-e', 'node', '-b', 'release']);
    }
    for (const packagePath of multiPaths) {
        run(path.join(root, packagePath), ['exec', 'crossbind', 'build', '-p', nodeBuild.platforms.join(','), '-e', 'node', '-b', 'release']);
        stageNodeOutputs({
            packageRoot: path.join(root, packagePath),
            stagingRoot: path.join(artifactRoot, 'multi', runner, packagePath),
            withEntry: runner === 'node',
        });
    }
    // A dependency bridge crossbind cannot generate is only warned about and left out, so any change shows a
    // bridge this runner did not take from the Linux job.
    const changed = handedOver ? changedBridgeState(handedOver, bridgeStateDigest(root, bridgePaths)) : [];
    if (changed.length) throw new Error(`[${runner}] the build changed bridges handed over by the Linux job: ${changed.slice(0, 5).join(', ')}`);
    if (valueOf('--bridges-out')) packBridgeState({ root, projectPaths: bridgePaths, outputDir: path.resolve(valueOf('--bridges-out')) });
}

const artifacts = [];
for (const name of plan.publishOrder) {
    const candidate = workspace[name];
    if (!candidates.has(name) || candidate.buildKind === 'multi-platform') continue;
    if (candidate.buildKind !== runner) continue;
    const packed =
        candidate.name === 'crossbind'
            ? packCrossbind({ root, artifactDirectory: path.join(artifactRoot, 'tarballs') })
            : packWorkspacePackage({
                  root,
                  packagePath: candidate.path,
                  expectedName: candidate.name,
                  expectedVersion: candidate.version,
                  artifactDirectory: path.join(artifactRoot, 'tarballs'),
              });
    if (candidate.name === 'crossbind') {
        smokeTestCrossbindTarball({ tarball: packed.tarball, expectedVersion: candidate.version });
    }
    artifacts.push({
        package: candidate.name,
        version: candidate.version,
        filename: path.basename(packed.tarball),
        integrity: packed.integrity,
        runner,
    });
    process.stdout.write(`[${runner}] packed ${candidate.name}@${candidate.version} as ${path.basename(packed.tarball)}\n`);
}

const result = {
    schemaVersion: 1,
    runner,
    gitCommit: plan.gitCommit,
    artifacts,
    stagedMultiPlatform: plan.multiPlatform,
};
writeJson(path.join(artifactRoot, `build-${runner}.json`), result);
process.stdout.write(`${runner}: built ${buildOrder.length} package(s), packed ${artifacts.length} exact tarball(s).\n`);
