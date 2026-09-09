import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    buildWorkspaceReleasePlan,
    compareSupportedVersions,
    discoverPublishablePackages,
    provenanceCommitFromBundle,
    readTrainVersion,
    decodeWorkspacePlanOutput,
    encodeWorkspacePlanOutput,
} from '../workspace-release.mjs';
import { setWorkspaceVersion } from '../set-workspace-version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const COMMIT = '1234567890abcdef1234567890abcdef12345678';

function registryWith(overrides = {}) {
    return {
        status: async (candidate) =>
            overrides[candidate.name] ?? {
                exactVersion: candidate.version,
                channelVersion: candidate.version,
                provenanceCommit: null,
            },
    };
}

function fixtureRepository(packages, { trainVersion } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-workspace-release-'));
    fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
    for (const candidate of packages) {
        const directory = path.join(root, candidate.path);
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(
            path.join(directory, 'package.json'),
            `${JSON.stringify(
                {
                    name: candidate.name,
                    version: candidate.version,
                    repository: 'https://github.com/crossbind/crossbind.git',
                    ...candidate.manifest,
                },
                null,
                2,
            )}\n`,
        );
    }
    const version =
        trainVersion ??
        packages.reduce(
            (highest, candidate) => (compareSupportedVersions(candidate.version, highest) > 0 ? candidate.version : highest),
            packages[0].version,
        );
    const releaseDirectory = path.join(root, 'releases', 'npm');
    fs.mkdirSync(releaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(releaseDirectory, 'VERSION'), `${version}\n`);
    return root;
}

test('the real workspace is classified into publishable Linux, macOS and assembled packages', () => {
    const packages = discoverPublishablePackages(ROOT);
    assert.equal(packages.length, 107);
    assert.equal(readTrainVersion(ROOT), '2.0.0-beta.55');
    assert.ok(packages.filter((candidate) => candidate.buildKind === 'macos').length > 0);
    assert.ok(packages.filter((candidate) => candidate.buildKind === 'linux').length > 0);
    assert.deepEqual(
        packages.filter((candidate) => candidate.buildKind === 'multi-platform').map((candidate) => candidate.name),
        ['@crossbind/example-lib-prebuilt-matrix'],
    );
});

test('workspace version command updates only selected packages to one new train version', () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.1' },
        { path: 'plugins/consumer', name: '@crossbind/consumer', version: '2.0.0-beta.2' },
    ]);
    const preview = setWorkspaceVersion({ root, version: '2.0.0-beta.3', packageNames: ['@crossbind/base'] });
    assert.equal(preview.applied, false);
    assert.equal(discoverPublishablePackages(root)[0].version, '2.0.0-beta.1');
    const result = setWorkspaceVersion({ root, version: '2.0.0-beta.3', packageNames: ['@crossbind/base'], apply: true });
    assert.equal(result.packageCount, 1);
    assert.equal(readTrainVersion(root), '2.0.0-beta.3');
    assert.equal(discoverPublishablePackages(root).find((candidate) => candidate.name === '@crossbind/base').version, '2.0.0-beta.3');
    assert.equal(discoverPublishablePackages(root).find((candidate) => candidate.name === '@crossbind/consumer').version, '2.0.0-beta.2');
});

test('workspace version command refuses an already-used local version', () => {
    const root = fixtureRepository([{ path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' }]);
    assert.throws(() => setWorkspaceVersion({ root, version: '2.0.0-beta.2', packageNames: ['@crossbind/base'], apply: true }), /must be newer/);
});

test('workspace version command requires an explicit package selection or all', () => {
    const root = fixtureRepository([{ path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' }]);
    assert.throws(() => setWorkspaceVersion({ root, version: '2.0.0-beta.3' }), /--package.*--all/);
});

test('every configured stable product entry point is a real public workspace package', () => {
    const names = new Set(discoverPublishablePackages(ROOT).map((candidate) => candidate.name));
    const configuration = JSON.parse(fs.readFileSync(path.join(ROOT, 'releases', 'npm', 'stable-entrypoints.json'), 'utf8'));
    assert.equal(configuration.schemaVersion, 1);
    assert.ok(configuration.packages.length > 0);
    for (const name of configuration.packages) assert.ok(names.has(name), `${name} is not publishable`);
});

test('supported versions compare in beta, RC and stable order', () => {
    assert.equal(compareSupportedVersions('2.0.0-beta.54', '2.0.0-beta.53'), 1);
    assert.equal(compareSupportedVersions('2.0.0-rc.1', '2.0.0-beta.99'), 1);
    assert.equal(compareSupportedVersions('2.0.0', '2.0.0-rc.9'), 1);
    assert.equal(compareSupportedVersions('2.0.0-beta.53', '2.0.0-beta.53'), 0);
});

test('a beta train selects only version-bumped packages and keeps dependency order', async () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' },
        {
            path: 'plugins/consumer',
            name: '@crossbind/consumer',
            version: '2.0.0-beta.2',
            manifest: { dependencies: { '@crossbind/base': 'workspace:^' } },
        },
        { path: 'tooling/unchanged', name: '@crossbind/unchanged', version: '2.0.0-beta.1' },
    ]);
    const plan = await buildWorkspaceReleasePlan({
        root,
        channel: 'beta',
        gitCommit: COMMIT,
        registry: registryWith({
            '@crossbind/base': { exactVersion: null, channelVersion: '2.0.0-beta.1', provenanceCommit: null },
            '@crossbind/consumer': { exactVersion: null, channelVersion: '2.0.0-beta.1', provenanceCommit: null },
        }),
    });
    assert.deepEqual(plan.publishOrder, ['@crossbind/base', '@crossbind/consumer']);
    assert.equal(plan.packageCount, 2);
    assert.deepEqual(plan.buildOrderByRunner.linux, ['@crossbind/base', '@crossbind/consumer']);
});

test('one train cannot publish packages with different target versions', async () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' },
        { path: 'plugins/consumer', name: '@crossbind/consumer', version: '2.0.0-beta.3' },
    ]);
    await assert.rejects(
        buildWorkspaceReleasePlan({
            root,
            channel: 'beta',
            gitCommit: COMMIT,
            registry: registryWith({
                '@crossbind/base': { exactVersion: null, channelVersion: '2.0.0-beta.1', provenanceCommit: null },
                '@crossbind/consumer': { exactVersion: null, channelVersion: '2.0.0-beta.2', provenanceCommit: null },
            }),
        }),
        /Every package selected for one train must use its common target version/,
    );
});

test('a full common-version train preserves generated-template dependency order', async () => {
    const registry = {
        status: async (candidate) => ({
            exactVersion: null,
            channelVersion: '2.0.0-beta.54',
            provenanceCommit: null,
        }),
    };
    const plan = await buildWorkspaceReleasePlan({ root: ROOT, channel: 'beta', gitCommit: COMMIT, registry });
    assert.equal(plan.trainVersion, '2.0.0-beta.55');
    assert.equal(plan.packageCount, 107);
    assert.ok(plan.publishOrder.indexOf('@crossbind/plugin-vite') < plan.publishOrder.indexOf('create-crossbind'));
});

test('a train refuses to add packages after the common version belongs to another commit', async () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' },
        { path: 'plugins/consumer', name: '@crossbind/consumer', version: '2.0.0-beta.2' },
    ]);
    await assert.rejects(
        buildWorkspaceReleasePlan({
            root,
            channel: 'beta',
            gitCommit: COMMIT,
            registry: registryWith({
                '@crossbind/base': { exactVersion: null, channelVersion: '2.0.0-beta.1', provenanceCommit: null },
            }),
        }),
        /partially associated with another release commit/,
    );
});

test('a fully published historical train is a clean no-op', async () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' },
        { path: 'plugins/consumer', name: '@crossbind/consumer', version: '2.0.0-beta.2' },
    ]);
    const plan = await buildWorkspaceReleasePlan({ root, channel: 'beta', gitCommit: COMMIT, registry: registryWith() });
    assert.equal(plan.packageCount, 0);
    assert.deepEqual(plan.publishOrder, []);
});

test('a provenance-bound partial run is selected for idempotent resume', async () => {
    const root = fixtureRepository([{ path: 'plugins/resume', name: '@crossbind/resume', version: '2.0.0-beta.2' }]);
    const plan = await buildWorkspaceReleasePlan({
        root,
        channel: 'beta',
        gitCommit: COMMIT,
        registry: registryWith({
            '@crossbind/resume': { exactVersion: '2.0.0-beta.2', channelVersion: '2.0.0-beta.2', provenanceCommit: COMMIT },
        }),
    });
    assert.equal(plan.packages[0].name, '@crossbind/resume');
    assert.equal(plan.packages[0].reason, 'resume');
    assert.deepEqual(plan.publishOrder, ['@crossbind/resume']);
});

test('crossbind receives first priority among independent packages', async () => {
    const root = fixtureRepository([
        { path: 'core/crossbind', name: 'crossbind', version: '9.9.9-beta.2' },
        { path: 'tooling/create', name: 'create-crossbind-fixture', version: '9.9.9-beta.2' },
    ]);
    const notesDirectory = path.join(root, 'releases', 'crossbind');
    fs.mkdirSync(notesDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(notesDirectory, '9.9.9-beta.2.md'),
        '---\npackage: crossbind\nversion: 9.9.9-beta.2\ntitle: Fixture\nsummary: Fixture release.\n---\n\n## Fixes\n\n- Fixture.\n',
    );
    const plan = await buildWorkspaceReleasePlan({
        root,
        channel: 'beta',
        gitCommit: COMMIT,
        registry: registryWith({
            crossbind: { exactVersion: null, channelVersion: '9.9.9-beta.1', provenanceCommit: null },
            'create-crossbind-fixture': { exactVersion: null, channelVersion: '9.9.9-beta.1', provenanceCommit: null },
        }),
    });
    assert.deepEqual(plan.publishOrder, ['crossbind', 'create-crossbind-fixture']);
});

test('stable publication rejects prerelease workspace dependency closure', async () => {
    const root = fixtureRepository([
        { path: 'core/base', name: '@crossbind/base', version: '2.0.0-beta.2' },
        {
            path: 'plugins/consumer',
            name: '@crossbind/consumer',
            version: '2.0.0',
            manifest: { dependencies: { '@crossbind/base': 'workspace:^' } },
        },
    ]);
    const stableDirectory = path.join(root, 'releases', 'npm');
    fs.mkdirSync(stableDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(stableDirectory, 'stable-entrypoints.json'),
        `${JSON.stringify({ schemaVersion: 1, packages: ['@crossbind/consumer'] })}\n`,
    );
    await assert.rejects(
        buildWorkspaceReleasePlan({
            root,
            channel: 'stable',
            gitCommit: COMMIT,
            registry: registryWith({
                '@crossbind/consumer': { exactVersion: null, channelVersion: '1.0.0', provenanceCommit: null },
            }),
        }),
        /cannot depend on prerelease workspace package/,
    );
});

test('a train never moves an npm channel backwards', async () => {
    const root = fixtureRepository([{ path: 'plugins/stale', name: '@crossbind/stale', version: '2.0.0-beta.1' }]);
    await assert.rejects(
        buildWorkspaceReleasePlan({
            root,
            channel: 'beta',
            gitCommit: COMMIT,
            registry: registryWith({
                '@crossbind/stale': { exactVersion: '2.0.0-beta.1', channelVersion: '2.0.0-beta.2', provenanceCommit: null },
            }),
        }),
        /older than npm beta/,
    );
});

test('stable train fails while consumer install docs still require beta', async () => {
    const root = fixtureRepository([{ path: 'plugins/stable', name: '@crossbind/stable', version: '2.0.0' }]);
    fs.writeFileSync(path.join(root, 'README.md'), 'npm install @crossbind/stable@beta\n');
    const stableDirectory = path.join(root, 'releases', 'npm');
    fs.mkdirSync(stableDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(stableDirectory, 'stable-entrypoints.json'),
        `${JSON.stringify({ schemaVersion: 1, packages: ['@crossbind/stable'] })}\n`,
    );
    await assert.rejects(
        buildWorkspaceReleasePlan({
            root,
            channel: 'stable',
            gitCommit: COMMIT,
            registry: registryWith({
                '@crossbind/stable': { exactVersion: null, channelVersion: '1.0.0', provenanceCommit: null },
            }),
        }),
        /README\.md still requires the beta\/next npm channel/,
    );
});

test('scoped npm provenance resolves only the canonical workflow commit', () => {
    const statement = {
        predicateType: 'https://slsa.dev/provenance/v1',
        subject: [{ name: 'pkg:npm/%40crossbind/plugin-vite@2.0.0-beta.54', digest: { sha512: 'fixture' } }],
        predicate: {
            buildDefinition: {
                externalParameters: {
                    workflow: {
                        repository: 'https://github.com/crossbind/crossbind',
                        path: '.github/workflows/release-crossbind.yml',
                    },
                },
                resolvedDependencies: [{ digest: { gitCommit: COMMIT } }],
            },
        },
    };
    const bundle = {
        attestations: [{ bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } } }],
    };
    assert.equal(provenanceCommitFromBundle(bundle, '@crossbind/plugin-vite', '2.0.0-beta.54'), COMMIT);
    assert.equal(provenanceCommitFromBundle(bundle, '@crossbind/plugin-rollup', '2.0.0-beta.54'), null);
});

test('the plan travels between jobs compressed and stays far below the Linux environment limit', () => {
    const entry = {
        name: '@crossbind/port-example-android',
        version: '2.0.0-beta.55',
        path: 'ports/example/android',
        manifestPath: 'ports/example/android/package.json',
        channel: 'beta',
        npmDistTag: 'beta',
        prerelease: true,
        gitTag: '@crossbind/port-example-android@2.0.0-beta.55',
        buildKind: 'android',
        prepublishOnly: 'crossbind build -p android',
        localDependencies: { '@crossbind/port-example': 'workspace:^', crossbind: 'workspace:^' },
        runtimeLocalDependencies: ['@crossbind/port-example'],
        publishLocalDependencies: ['@crossbind/port-example', 'crossbind'],
        reason: 'version-bump',
    };
    const packages = Array.from({ length: 250 }, (_, index) => ({ ...entry, name: `${entry.name}-${index}` }));
    const plan = {
        schemaVersion: 1,
        packages,
        publishOrder: packages.map((item) => item.name),
        workspacePackages: Object.fromEntries(packages.map((item) => [item.name, item])),
    };
    const text = `${JSON.stringify(plan, null, 2)}\n`;

    const encoded = encodeWorkspacePlanOutput(text);

    assert.match(encoded, /^[A-Za-z0-9+/]+=*$/);
    assert.ok(encoded.length < 65536, `encoded plan is ${encoded.length} bytes`);
    assert.ok(text.length > 131072, 'the fixture must exceed the raw limit to prove the point');
    assert.equal(decodeWorkspacePlanOutput(encoded).toString('utf8'), text);
});

test('the restore script writes the exact plan bytes from the job output environment', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-plan-restore-'));
    const target = path.join(directory, 'workspace-release-plan.json');
    const text = '{\n  "schemaVersion": 1\n}\n';
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release', 'restore-workspace-plan.mjs'), target], {
        env: { ...process.env, RELEASE_PLAN_GZIP_BASE64: encodeWorkspacePlanOutput(text) },
    });
    assert.equal(fs.readFileSync(target, 'utf8'), text);
    assert.throws(
        () =>
            execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release', 'restore-workspace-plan.mjs'), target], {
                env: { ...process.env, RELEASE_PLAN_GZIP_BASE64: '' },
                stdio: 'pipe',
            }),
        /RELEASE_PLAN_GZIP_BASE64/,
    );
    fs.rmSync(directory, { recursive: true, force: true });
});
