import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectWorkspaceTarball } from '../package-artifact.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMMIT = '1234567890abcdef1234567890abcdef12345678';

test('Linux build and assembly preserve one exact pnpm workspace tarball', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-workspace-artifacts-'));
    const packagePath = 'core/fixture';
    const packageRoot = path.join(fixture, packagePath);
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify(
            {
                name: '@crossbind/fixture',
                version: '9.9.9-beta.1',
                repository: 'https://github.com/crossbind/crossbind.git',
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(path.join(packageRoot, 'index.js'), 'export const fixture = true;\n');
    const candidate = {
        name: '@crossbind/fixture',
        version: '9.9.9-beta.1',
        path: packagePath,
        manifestPath: `${packagePath}/package.json`,
        channel: 'beta',
        npmDistTag: 'beta',
        prerelease: true,
        gitTag: '@crossbind/fixture@9.9.9-beta.1',
        buildKind: 'linux',
        prepublishOnly: null,
        localDependencies: {},
        runtimeLocalDependencies: [],
        reason: 'version-bump',
    };
    const plan = {
        schemaVersion: 1,
        gitCommit: COMMIT,
        channel: 'beta',
        workspaceVersion: '9.9.9-beta.1',
        packageCount: 1,
        publishOrder: [candidate.name],
        buildOrderByRunner: { linux: [candidate.name], wasm: [], android: [], wasi: [], macos: [] },
        linuxShards: ['linux'],
        multiPlatform: [],
        packages: [candidate],
        workspacePackages: { [candidate.name]: candidate },
    };
    const planPath = path.join(fixture, 'plan.json');
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const linux = path.join(fixture, 'linux');
    const assembled = path.join(fixture, 'assembled');
    execFileSync(
        process.execPath,
        [
            path.join(ROOT, 'scripts/release/build-workspace-artifacts.mjs'),
            '--root',
            fixture,
            '--runner',
            'linux',
            '--plan',
            planPath,
            '--artifact-dir',
            linux,
        ],
        { cwd: ROOT, encoding: 'utf8' },
    );
    execFileSync(
        process.execPath,
        [
            path.join(ROOT, 'scripts/release/assemble-workspace-artifacts.mjs'),
            '--root',
            fixture,
            '--plan',
            planPath,
            '--linux-dir',
            linux,
            '--artifact-dir',
            assembled,
        ],
        { cwd: ROOT, encoding: 'utf8' },
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(assembled, 'workspace-release-artifacts.json'), 'utf8'));
    assert.equal(manifest.artifacts.length, 1);
    const artifact = manifest.artifacts[0];
    const inspected = inspectWorkspaceTarball({
        tarball: path.join(assembled, 'tarballs', artifact.filename),
        expectedName: candidate.name,
        expectedVersion: candidate.version,
    });
    assert.equal(inspected.integrity, artifact.integrity);
    assert.equal(inspected.manifest.name, candidate.name);
});

test('multi-platform assembly merges exact outputs and regenerates one deterministic CMake host list', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-workspace-multi-'));
    const packagePath = 'examples/lib-prebuilt-matrix';
    const packageRoot = path.join(fixture, packagePath);
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.writeFileSync(path.join(fixture, 'README.md'), '# Fixture\n');
    fs.writeFileSync(
        path.join(packageRoot, 'package.json'),
        `${JSON.stringify(
            {
                name: '@crossbind/example-lib-prebuilt-matrix',
                version: '9.9.9-beta.1',
                repository: 'https://github.com/crossbind/crossbind.git',
                scripts: { prepublishOnly: 'crossbind build' },
            },
            null,
            2,
        )}\n`,
    );
    const candidate = {
        name: '@crossbind/example-lib-prebuilt-matrix',
        version: '9.9.9-beta.1',
        path: packagePath,
        manifestPath: `${packagePath}/package.json`,
        channel: 'beta',
        npmDistTag: 'beta',
        prerelease: true,
        gitTag: '@crossbind/example-lib-prebuilt-matrix@9.9.9-beta.1',
        buildKind: 'multi-platform',
        prepublishOnly: 'crossbind build',
        localDependencies: {},
        runtimeLocalDependencies: [],
        reason: 'version-bump',
    };
    const plan = {
        schemaVersion: 1,
        gitCommit: COMMIT,
        channel: 'beta',
        workspaceVersion: '9.9.9-beta.1',
        packageCount: 1,
        publishOrder: [candidate.name],
        buildOrderByRunner: { linux: [], wasm: [], android: [], wasi: [], macos: [] },
        linuxShards: ['wasm', 'android', 'wasi'],
        multiPlatform: [candidate.name],
        packages: [candidate],
        workspacePackages: { [candidate.name]: { ...candidate, reason: null } },
    };
    const planPath = path.join(fixture, 'plan.json');
    fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
    const inputs = path.join(fixture, 'inputs');
    const targets = {
        wasm: 'wasm-wasm32-st-release',
        android: 'android-arm64-v8a-mt-release',
        wasi: 'wasi-wasm32-st-release',
        macos: 'ios-iphoneos-mt-release',
    };
    for (const [runner, target] of Object.entries(targets)) {
        const runnerRoot = path.join(inputs, runner);
        fs.mkdirSync(runnerRoot, { recursive: true });
        fs.writeFileSync(
            path.join(runnerRoot, `build-${runner}.json`),
            `${JSON.stringify({ schemaVersion: 1, runner, gitCommit: COMMIT, artifacts: [], stagedMultiPlatform: [candidate.name] })}\n`,
        );
        const prebuilt = path.join(runnerRoot, 'multi', runner, packagePath, 'dist', 'prebuilt');
        fs.mkdirSync(path.join(prebuilt, target, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(prebuilt, target, 'lib', 'libfixture.a'), runner);
        fs.writeFileSync(path.join(prebuilt, 'CMakeLists.txt'), `set(MY_LIST "${target}")\nset(FIXTURE true)\n`);
    }
    const assembled = path.join(fixture, 'assembled');
    execFileSync(
        process.execPath,
        [
            path.join(ROOT, 'scripts/release/assemble-workspace-artifacts.mjs'),
            '--root',
            fixture,
            '--plan',
            planPath,
            '--input-root',
            inputs,
            '--artifact-dir',
            assembled,
        ],
        { cwd: ROOT, encoding: 'utf8' },
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(assembled, 'workspace-release-artifacts.json'), 'utf8'));
    const tarball = path.join(assembled, 'tarballs', manifest.artifacts[0].filename);
    const cmake = execFileSync('tar', ['-xOf', tarball, 'package/dist/prebuilt/CMakeLists.txt'], { encoding: 'utf8' });
    assert.equal(
        cmake.split('\n')[0],
        'set(MY_LIST "android-arm64-v8a-mt-release;ios-iphoneos-mt-release;wasi-wasm32-st-release;wasm-wasm32-st-release")',
    );
});
