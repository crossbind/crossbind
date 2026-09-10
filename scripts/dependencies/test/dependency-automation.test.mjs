import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, decodeProposal, encodeProposal } from '../dependency-lib.mjs';
import { changedDependencyUnits } from '../changed-units.mjs';
import { createDependencyPlan, dockerFrom, nativeTag, parseAndroidRepository, parseRustStableToml } from '../plan-dependency-updates.mjs';
import { pullRequestMetadata } from '../render-dependency-pr.mjs';
import { dependencyPathAllowed } from '../validate-dependency-update.mjs';
import { nativeDependencyBuildOrder } from '../validate-native-family.mjs';
import gdalBuild from '../../../ports/gdal/base/build.mjs';
import opensslBuild from '../../../ports/openssl/base/build.mjs';
import sqliteBuild from '../../../ports/sqlite3/base/build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('native validation builds the workspace dependency closure in topological order', () => {
    const entry = (name, dependencies = {}) => ({ directory: name, manifest: { name, dependencies } });
    const packages = new Map([
        ['@crossbind/root', entry('@crossbind/root', { '@crossbind/middle': 'workspace:^', crossbind: 'workspace:^', external: '^1.0.0' })],
        ['@crossbind/middle', entry('@crossbind/middle', { '@crossbind/leaf': 'workspace:^' })],
        ['@crossbind/leaf', entry('@crossbind/leaf')],
    ]);
    assert.deepEqual(
        nativeDependencyBuildOrder('@crossbind/root', packages).map((candidate) => candidate.manifest.name),
        ['@crossbind/leaf', '@crossbind/middle', '@crossbind/root'],
    );
});

test('native recipes use portable configure entrypoints and the container WASI SDK fallback', () => {
    const configuredSdk = process.env.CROSSBIND_WASI_SDK_PATH;
    try {
        delete process.env.CROSSBIND_WASI_SDK_PATH;
        assert.equal(opensslBuild.configureProgram, './Configure');
        assert.ok(sqliteBuild.getBuildParams({ platform: 'wasi', runtime: 'st' }).includes('--with-wasi-sdk=/opt/wasi-sdk'));
    } finally {
        if (configuredSdk === undefined) delete process.env.CROSSBIND_WASI_SDK_PATH;
        else process.env.CROSSBIND_WASI_SDK_PATH = configuredSdk;
    }
});

test('the GDAL iOS cross-build does not discover unused host Python bindings', () => {
    const params = gdalBuild.getBuildParams({ platform: 'ios' }, {});
    assert.ok(params.includes('-DCMAKE_DISABLE_FIND_PACKAGE_Python=ON'));
    assert.ok(params.includes('-DBUILD_PYTHON_BINDINGS=OFF'));
});

test('version comparison orders patch, minor, major and prerelease values', () => {
    assert.equal(compareVersions('1.2.4', '1.2.3'), 1);
    assert.equal(compareVersions('1.3.0', '1.2.9'), 1);
    assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
    assert.equal(compareVersions('2.0.0', '2.0.0-rc.1'), 1);
});

test('Docker FROM parsing keeps a tag and immutable digest together', () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    assert.deepEqual(dockerFrom(`FROM node:24.20.0-trixie-slim@${digest} AS node\n`, 'node', 'node'), {
        tag: '24.20.0-trixie-slim',
        digest,
        full: `FROM node:24.20.0-trixie-slim@${digest} AS node`,
    });
});

test('Rust stable parsing is scoped to pkg.rust instead of another component', () => {
    const toml = '[pkg.cargo]\nversion = "1.99.0 (x)"\n[pkg.rust]\nversion = "1.98.1 (abc 2026-09-01)"\n';
    assert.equal(parseRustStableToml(toml), '1.98.1');
});

test('Android repository parsing selects stable Linux tools and orders NDKs', () => {
    const xml = `
      <remotePackage path="cmdline-tools;19.0">
        <revision><major>19</major><minor>0</minor><micro>0</micro></revision>
        <archives><archive><host-os>linux</host-os><complete>
          <checksum type="sha-1">${'a'.repeat(40)}</checksum>
          <url>commandlinetools-linux-20000000_latest.zip</url>
        </complete></archive></archives>
      </remotePackage>
      <remotePackage path="ndk;27.3.13750724"><revision><major>27</major><minor>3</minor><micro>13750724</micro></revision></remotePackage>
      <remotePackage path="ndk;29.0.14206865"><revision><major>29</major><minor>0</minor><micro>14206865</micro></revision></remotePackage>`;
    const parsed = parseAndroidRepository(xml);
    assert.equal(parsed.commandLineTools.build, '20000000');
    assert.equal(parsed.commandLineTools.sha1, 'a'.repeat(40));
    assert.deepEqual(
        parsed.ndks.map((entry) => entry.version),
        ['29.0.14206865', '27.3.13750724'],
    );
});

test('proposal encoding rejects identities that cannot become branch names', () => {
    const proposal = { id: 'native-zlib-1.3.3', kind: 'native', unit: 'zlib', current: '1.3.2', target: '1.3.3' };
    assert.deepEqual(decodeProposal(encodeProposal(proposal)), proposal);
    assert.throws(() => decodeProposal(Buffer.from(JSON.stringify({ ...proposal, id: '../escape' })).toString('base64url')), /not safe/);
});

test('proposal decoding validates every kind-specific field before any script trusts it', () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const native = { id: 'native-zlib-1.3.3', kind: 'native', current: '1.3.2', target: '1.3.3' };
    assert.throws(() => decodeProposal(encode({ ...native, unit: '../escape' })), /native family is not safe/);
    assert.throws(() => decodeProposal(encode(native)), /native family/);
    assert.throws(() => decodeProposal(encode({ ...native, kind: 'plugin', unit: 'zlib' })), /unsupported proposal kind/);

    const toolchain = { id: 'toolchain-rust-1.98.1', kind: 'toolchain', component: 'rust', current: '1.98.0', target: '1.98.1' };
    assert.deepEqual(decodeProposal(encodeProposal(toolchain)), toolchain);
    assert.throws(() => decodeProposal(encode({ ...toolchain, component: 'android-ndk-major' })), /unsupported toolchain component/);
    assert.throws(() => decodeProposal(encode({ ...toolchain, component: undefined })), /unsupported toolchain component/);

    const androidTools = {
        ...toolchain,
        id: 'toolchain-android-command-line-tools-2',
        component: 'android-command-line-tools',
        current: '1',
        target: '2',
    };
    assert.throws(() => decodeProposal(encode({ ...androidTools, archive: 'evil.zip', sha1: 'a'.repeat(40) })), /archive metadata/);
    assert.throws(
        () => decodeProposal(encode({ ...androidTools, archive: 'commandlinetools-linux-2_latest.zip', sha1: 'nope' })),
        /archive metadata/,
    );
    const validTools = { ...androidTools, archive: 'commandlinetools-linux-2_latest.zip', sha1: 'a'.repeat(40) };
    assert.deepEqual(decodeProposal(encodeProposal(validTools)), validTools);

    const emscripten = { ...toolchain, id: 'toolchain-emscripten-6.0.10', component: 'emscripten', current: '6.0.9', target: '6.0.10' };
    assert.throws(() => decodeProposal(encode({ ...emscripten, forkRevision: 'main', embindSha256: 'b'.repeat(64) })), /fork revision/);
    const validEmscripten = { ...emscripten, forkRevision: 'c'.repeat(40), embindSha256: 'b'.repeat(64) };
    assert.deepEqual(decodeProposal(encodeProposal(validEmscripten)), validEmscripten);
});

test('native tags are derived from a reviewed identity without duplicating versions', () => {
    assert.equal(nativeTag({ tag: 'curl-{versionUnderscore}' }, '8.22.0'), 'curl-8_22_0');
    assert.equal(nativeTag({ tag: 'v{version}' }, '1.3.2'), 'v1.3.2');
});

test('the SWIG watcher follows the reviewed fork branch rather than an assumed default', () => {
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/dependencies/update-policy.json'), 'utf8'));
    assert.equal(policy.toolchains.swig.repository, 'crossbind/swig');
    assert.equal(policy.toolchains.swig.branch, 'add-embind-support');
});

test('native planning selects one coherent PR per outdated family', async () => {
    const plan = await createDependencyPlan({
        dependencies: {
            skipNativeSecurity: true,
            skipToolchains: true,
            nativeInventory: {
                rows: [
                    {
                        package: '@crossbind/port-zlib',
                        library: 'zlib',
                        nativeVersion: '1.3.2',
                        latestVersion: '1.3.3',
                        status: 'outdated',
                        path: 'ports/zlib/base/package.json',
                        homepage: 'https://zlib.net/',
                    },
                    {
                        package: '@crossbind/port-zlib-ios',
                        library: 'zlib',
                        nativeVersion: '1.3.2',
                        latestVersion: '1.3.3',
                        status: 'outdated',
                        path: 'ports/zlib/ios/package.json',
                        homepage: 'https://zlib.net/',
                    },
                ],
            },
        },
    });
    assert.equal(plan.selected.length, 1);
    assert.equal(plan.selected[0].unit, 'zlib');
    assert.equal(plan.selected[0].macos, true);
});

test('native security priority requires an affected current commit and a checked clean target', async () => {
    const currentCommit = 'a'.repeat(40);
    const targetCommit = 'b'.repeat(40);
    const plan = await createDependencyPlan({
        dependencies: {
            skipToolchains: true,
            nativeInventory: {
                rows: [
                    {
                        package: '@crossbind/port-curl',
                        library: 'curl',
                        nativeVersion: '8.21.0',
                        latestVersion: '8.22.0',
                        status: 'outdated',
                        path: 'ports/curl/base/package.json',
                        homepage: 'https://curl.se/',
                    },
                ],
            },
            githubCommitForRef: async (repository, ref) => {
                assert.equal(repository, 'curl/curl');
                return ref.endsWith('curl-8_21_0') ? currentCommit : targetCommit;
            },
            osvCommitVulnerabilities: async (commit) => (commit === currentCommit ? [{ id: 'OSV-TEST-1' }] : []),
        },
    });
    assert.equal(plan.selected.length, 1);
    assert.equal(plan.selected[0].risk, 'security');
    assert.deepEqual(plan.selected[0].advisories, ['OSV-TEST-1']);
});

test('native security fails closed when the proposed target commit is also affected', async () => {
    const plan = await createDependencyPlan({
        dependencies: {
            skipToolchains: true,
            nativeInventory: {
                rows: [
                    {
                        package: '@crossbind/port-curl',
                        library: 'curl',
                        nativeVersion: '8.21.0',
                        latestVersion: '8.22.0',
                        status: 'outdated',
                        path: 'ports/curl/base/package.json',
                        homepage: 'https://curl.se/',
                    },
                ],
            },
            githubCommitForRef: async (repository, ref) => (ref.endsWith('curl-8_21_0') ? 'a'.repeat(40) : 'b'.repeat(40)),
            osvCommitVulnerabilities: async () => [{ id: 'OSV-TEST-2' }],
        },
    });
    assert.equal(plan.selected.length, 0);
    assert.match(plan.blockers[0].reason, /No checked clean target is available/);
});

test('native updates with no reviewed commit identity require manual review', async () => {
    const plan = await createDependencyPlan({
        dependencies: {
            skipToolchains: true,
            nativeInventory: {
                rows: [
                    {
                        package: '@crossbind/port-iconv',
                        library: 'iconv',
                        nativeVersion: '1.19',
                        latestVersion: '1.20',
                        status: 'outdated',
                        path: 'ports/iconv/base/package.json',
                        homepage: 'https://www.gnu.org/software/libiconv/',
                    },
                ],
            },
        },
    });
    assert.equal(plan.selected.length, 0);
    assert.equal(plan.blockers[0].component, 'native-security-iconv');
});

test('proposal changed-file policies reject unrelated files', () => {
    const node = { kind: 'toolchain', component: 'node', current: '24.20.0', target: '24.20.1' };
    assert.equal(dependencyPathAllowed(node, '.nvmrc'), true);
    assert.equal(dependencyPathAllowed(node, 'core/crossbind/src/bin.js'), false);
    assert.equal(dependencyPathAllowed(node, 'core/crossbind/package.json'), false);

    const nodeMajor = { ...node, target: '26.0.0' };
    assert.equal(dependencyPathAllowed(nodeMajor, 'core/crossbind/package.json'), true);
    assert.equal(dependencyPathAllowed(nodeMajor, 'core/crossbind/src/bin.js'), false);

    assert.equal(dependencyPathAllowed({ kind: 'native', unit: 'zlib' }, 'ports/zlib/ios/package.json'), true);
    assert.equal(dependencyPathAllowed({ kind: 'native', unit: 'zlib' }, 'ports/curl/base/package.json'), false);
});

test('a Node digest-only proposal updates only the exact Docker base reference', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-digest-'));
    const currentDigest = `sha256:${'a'.repeat(64)}`;
    const targetDigest = `sha256:${'b'.repeat(64)}`;
    try {
        fs.mkdirSync(path.join(root, 'tooling/docker'), { recursive: true });
        fs.mkdirSync(path.join(root, 'docs/playbooks'), { recursive: true });
        fs.writeFileSync(path.join(root, '.nvmrc'), '24.20.0\n');
        fs.writeFileSync(path.join(root, 'tooling/docker/base.Dockerfile'), `FROM node:24.20.0-trixie-slim@${currentDigest} AS node\n`);
        fs.writeFileSync(path.join(root, 'tooling/docker/licenses-README.md'), 'node:24.20.0-trixie-slim\n');
        fs.writeFileSync(path.join(root, 'docs/playbooks/releasing-crossbind.md'), 'Node 24.20.0 LTS\n');
        const proposal = encodeProposal({
            id: 'toolchain-node-24.20.0-digest',
            kind: 'toolchain',
            component: 'node',
            current: '24.20.0',
            target: '24.20.0',
            currentDigest,
            targetDigest,
            targetTag: '24.20.0-trixie-slim',
        });
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/dependencies/apply-dependency-update.mjs'), '--proposal', proposal], {
            cwd: root,
            env: { ...process.env, CROSSBIND_DEPENDENCY_ROOT: root },
        });
        assert.match(fs.readFileSync(path.join(root, 'tooling/docker/base.Dockerfile'), 'utf8'), new RegExp(targetDigest));
        assert.equal(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8'), '24.20.0\n');
        assert.equal(fs.readFileSync(path.join(root, 'tooling/docker/licenses-README.md'), 'utf8'), 'node:24.20.0-trixie-slim\n');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('generated dependency PRs are draft-reviewable release-neutral changes', () => {
    const metadata = pullRequestMetadata({
        id: 'native-zlib-1.3.3',
        kind: 'native',
        unit: 'zlib',
        current: '1.3.2',
        target: '1.3.3',
        risk: 'patch',
        reason: 'new-upstream-stable',
        macos: true,
    });
    assert.equal(metadata.branch, 'chore/port-zlib/update-zlib-to-1.3.3');
    assert.match(metadata.title, /^chore\(port-zlib\):/);
    assert.match(metadata.body, /does not publish packages or images/);
});

test('pull-request validation derives native families and toolchain impact from paths', () => {
    const units = changedDependencyUnits(['ports/zlib/base/build.mjs', 'ports/zlib/wasm/package.json', 'tooling/docker/base.Dockerfile']);
    assert.equal(units.toolchain, true);
    assert.deepEqual(
        units.families.include.map((entry) => entry.family),
        ['zlib'],
    );
    assert.equal(units.families.include[0].macos, true);
});

test('daily workflows keep write authority after validation and pin every action', () => {
    const watch = fs.readFileSync(path.join(ROOT, '.github/workflows/dependency-watch.yml'), 'utf8');
    const candidate = fs.readFileSync(path.join(ROOT, '.github/workflows/dependency-update-candidate.yml'), 'utf8');
    const scan = fs.readFileSync(path.join(ROOT, '.github/workflows/scan-toolchain-images.yml'), 'utf8');
    const pullRequestValidation = fs.readFileSync(path.join(ROOT, '.github/workflows/validate-dependency-pr.yml'), 'utf8');
    const dependabot = fs.readFileSync(path.join(ROOT, '.github/dependabot.yml'), 'utf8');
    assert.match(watch, /schedule:[\s\S]*cron: '43 2 \* \* \*'/);
    assert.match(watch, /dry_run:[\s\S]*default: true/);
    assert.match(watch, /max-parallel: 2/);
    assert.ok(candidate.indexOf('validate-linux:') < candidate.indexOf('id: app-token'));
    assert.match(candidate, /actions\/create-github-app-token@[0-9a-f]{40}/);
    assert.match(candidate, /existing_tree.*expected_tree/s);
    assert.doesNotMatch(candidate, /npm publish|docker push|gh release create/);
    assert.doesNotMatch(watch, /secrets: inherit/);
    assert.match(scan, /published toolchain image scan failed/);
    assert.match(pullRequestValidation, /validate-native-family\.mjs/);
    assert.match(pullRequestValidation, /pnpm --dir tooling\/docker build:family/);
    assert.match(pullRequestValidation, /CROSSBIND_IMAGE_WEB: crossbind\/web:dev-amd64/);
    assert.match(pullRequestValidation, /pnpm run check:release:web/);
    assert.match(dependabot, /package-ecosystem: npm/);
    assert.match(dependabot, /package-ecosystem: github-actions/);
    assert.match(dependabot, /package-ecosystem: docker/);
    assert.match(dependabot, /groups:\n\s+(#[^\n]*\n\s+)*vitest:\n\s+applies-to: version-updates\n\s+patterns:\n\s+- vitest\n\s+- '@vitest\/\*'/);
    assert.match(
        dependabot,
        /react-native:\n\s+applies-to: version-updates\n\s+patterns:\n\s+- react-native\n\s+- '@react-native\/\*'\n\s+- '@react-native-community\/\*'/,
    );
    assert.match(dependabot, /directory: \/examples\/mobile-reactnative-expo\n(?:.*\n){1,6}?\s+open-pull-requests-limit: 0/);
    assert.match(dependabot, /dependency-name: 'expo-\*'/);
});

test('native updater changes every nested nativeVersion field together', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/check-native-versions.js'), 'utf8');
    assert.match(source, /nativeVersion.*\)\(\[\^"\]\*\)\(.*\/g/);
    const validator = fs.readFileSync(path.join(ROOT, 'scripts/dependencies/validate-native-family.mjs'), 'utf8');
    assert.match(validator, /\['base', 'wasm', 'wasi', 'bin-wasi', 'android'\]/);
});
