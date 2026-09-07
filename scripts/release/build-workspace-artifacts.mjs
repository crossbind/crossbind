#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packCrossbind, packWorkspacePackage, smokeTestCrossbindTarball } from './package-artifact.mjs';
import { validateWorkspaceReleasePlan } from './workspace-release.mjs';
import { writeJson } from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const runner = valueOf('--runner');
if (!['linux', 'wasm', 'android', 'wasi', 'macos'].includes(runner)) {
    throw new Error('--runner must be linux, wasm, android, wasi or macos.');
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
    const platforms = { wasm: ['wasm'], android: ['android'], wasi: ['wasi'], macos: ['ios'], linux: [] }[runner];
    for (const platform of platforms) {
        process.stdout.write(`[${runner}] build ${name}@${candidate.version} for ${platform}\n`);
        execFileSync('pnpm', ['--dir', path.join(root, candidate.path), 'exec', 'crossbind', 'build', '-p', platform], {
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
