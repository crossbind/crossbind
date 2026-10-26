import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, decodeProposal, encodeProposal } from '../dependency-lib.mjs';
import { changedDependencyUnits } from '../changed-units.mjs';
import {
    createDependencyPlan,
    dockerFrom,
    nativeTag,
    parseAndroidRepository,
    parseRustStableToml,
    planAndroid,
    planDebian,
} from '../plan-dependency-updates.mjs';
import { pullRequestMetadata } from '../render-dependency-pr.mjs';
import { dependencyPathAllowed } from '../validate-dependency-update.mjs';
import {
    TARGET_GROUPS,
    nativeDependencyBuildOrder,
    nativeValidationSteps,
    validateNativeFamily,
    validateNativeTargets,
} from '../validate-native-family.mjs';
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

test('a target group builds each native package once, dependencies first, and packs only the changed families', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-native-group-'));
    const write = (directory, manifest) => {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
        fs.writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify(manifest));
    };
    const scripts = { prepublishOnly: 'crossbind build -p wasm' };
    write('ports/zlib/base', { name: '@crossbind/port-zlib' });
    write('ports/zlib/wasm', { name: '@crossbind/port-zlib-wasm', scripts, dependencies: { '@crossbind/port-zlib': 'workspace:^' } });
    write('ports/curl/base', { name: '@crossbind/port-curl' });
    write('ports/curl/wasm', {
        name: '@crossbind/port-curl-wasm',
        scripts,
        dependencies: { '@crossbind/port-curl': 'workspace:^', '@crossbind/port-zlib-wasm': 'workspace:^' },
    });
    write('ports/gdal/base', { name: '@crossbind/port-gdal' });
    write('ports/gdal/wasm', {
        name: '@crossbind/port-gdal-wasm',
        scripts,
        dependencies: {
            '@crossbind/port-gdal': 'workspace:^',
            '@crossbind/port-curl-wasm': 'workspace:^',
            '@crossbind/port-zlib-wasm': 'workspace:^',
        },
    });
    const steps = (families, targets) =>
        nativeValidationSteps(families, targets, root).map((step) => `${step.type} ${path.relative(root, step.directory)}`);
    try {
        assert.deepEqual(steps(['curl', 'gdal', 'zlib'], ['wasm']), [
            'build ports/zlib/wasm',
            'build ports/curl/wasm',
            'pack ports/curl/wasm',
            'build ports/gdal/wasm',
            'pack ports/gdal/wasm',
            'pack ports/zlib/wasm',
        ]);
        // A dependency that did not change is built for its dependents but not packed.
        assert.deepEqual(steps(['gdal'], ['base', 'wasm']), [
            'pack ports/gdal/base',
            'build ports/zlib/wasm',
            'build ports/curl/wasm',
            'build ports/gdal/wasm',
            'pack ports/gdal/wasm',
        ]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("the win32 group builds a port's Windows addons with their build script, after the port they link", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-native-addons-'));
    const write = (directory, manifest) => {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
        fs.writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify(manifest));
    };
    const port = (platform) => ({
        name: `@crossbind/port-zlib-${platform}`,
        scripts: { prepublishOnly: `crossbind build -p ${platform}` },
        dependencies: { '@crossbind/port-zlib': 'workspace:^' },
    });
    const addon = (arch) => ({
        name: `@crossbind/port-zlib-standalone-napi-win32-${arch}`,
        scripts: { build: `crossbind build -p win32 -a ${arch} -e node -b release` },
        devDependencies: { '@crossbind/port-zlib-darwin': 'workspace:^', '@crossbind/port-zlib-win32': 'workspace:^' },
    });
    write('ports/zlib/base', { name: '@crossbind/port-zlib' });
    write('ports/zlib/darwin', port('darwin'));
    write('ports/zlib/win32', port('win32'));
    write('ports/zlib/standalone-napi-win32-x64', addon('x64'));
    write('ports/zlib/standalone-napi-win32-arm64', addon('arm64'));
    try {
        const steps = nativeValidationSteps(['zlib'], TARGET_GROUPS.linux.win32, root);
        assert.deepEqual(
            steps.map((step) => [step.type, step.script, path.relative(root, step.directory)].filter(Boolean).join(' ')),
            [
                'build prepublishOnly ports/zlib/win32',
                'pack ports/zlib/win32',
                'build build ports/zlib/standalone-napi-win32-x64',
                'pack ports/zlib/standalone-napi-win32-x64',
                'build build ports/zlib/standalone-napi-win32-arm64',
                'pack ports/zlib/standalone-napi-win32-arm64',
            ],
        );
        // Its ports are dev dependencies: it waits for the one this group builds, so a failed port skips its addons.
        for (const step of steps.filter((candidate) => candidate.type === 'build' && candidate.script === 'build')) {
            assert.deepEqual(step.requires, ['@crossbind/port-zlib-win32']);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

// A throwaway ports tree (zlib: base wasm linux; curl on zlib: base wasm; zstd: base wasm ios; empty: no
// packages) and a pnpm stand-in that logs "<directory> <subcommand>" and fails inside PNPM_FAIL_IN.
function nativeFixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-native-fixture-')));
    const write = (directory, manifest) => {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
        fs.writeFileSync(path.join(root, directory, 'package.json'), JSON.stringify(manifest));
    };
    const scripts = { prepublishOnly: 'crossbind build' };
    const on = (...names) => Object.fromEntries(names.map((name) => [name, 'workspace:^']));
    write('ports/zlib/base', { name: '@crossbind/port-zlib' });
    write('ports/zlib/wasm', { name: '@crossbind/port-zlib-wasm', scripts, dependencies: on('@crossbind/port-zlib') });
    write('ports/zlib/linux', { name: '@crossbind/port-zlib-linux', scripts, dependencies: on('@crossbind/port-zlib') });
    write('ports/curl/base', { name: '@crossbind/port-curl' });
    write('ports/curl/wasm', { name: '@crossbind/port-curl-wasm', scripts, dependencies: on('@crossbind/port-curl', '@crossbind/port-zlib-wasm') });
    write('ports/zstd/base', { name: '@crossbind/port-zstd' });
    write('ports/zstd/wasm', { name: '@crossbind/port-zstd-wasm', scripts, dependencies: on('@crossbind/port-zstd') });
    write('ports/zstd/ios', { name: '@crossbind/port-zstd-ios', scripts, dependencies: on('@crossbind/port-zstd') });
    fs.writeFileSync(path.join(root, 'ports/README.md'), '');
    fs.mkdirSync(path.join(root, 'ports/empty'));
    fs.writeFileSync(path.join(root, 'ports/empty/README.md'), '');
    const bin = path.join(root, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
        path.join(bin, 'pnpm'),
        '#!/bin/sh\ndir=$(pwd -P)\ndir=${dir#"$FIXTURE_ROOT"/}\necho "$dir $1" >> "$PNPM_LOG"\n[ "$dir" != "$PNPM_FAIL_IN" ]\n',
        { mode: 0o755 },
    );
    const log = path.join(root, 'pnpm.log');
    return {
        root,
        env: { PATH: `${bin}${path.delimiter}${process.env.PATH}`, FIXTURE_ROOT: root, PNPM_LOG: log, PNPM_FAIL_IN: '' },
        calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []),
        resetCalls: () => fs.rmSync(log, { force: true }),
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    };
}

test('the target groups follow the packages the changed families actually have', () => {
    const fixture = nativeFixture();
    const groups = (files) => {
        const units = changedDependencyUnits(files, fixture.root);
        return [units.linuxGroups.include.map((entry) => entry.group), units.macosGroups.include.map((entry) => entry.group)];
    };
    try {
        assert.deepEqual(groups(['ports/zlib/base/build.mjs']), [['wasm', 'linux', 'base'], []]);
        assert.deepEqual(groups(['ports/zstd/wasm/package.json']), [['wasm', 'base'], ['ios']]);
        assert.deepEqual(groups(['ports/empty/README.md', 'ports/README.md']), [[], []]);
    } finally {
        fixture.cleanup();
    }
});

test('the bot gate runs every group for its family, and a failed build stops only what depends on it', () => {
    const fixture = nativeFixture();
    const saved = Object.fromEntries(Object.keys(fixture.env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, fixture.env);
    try {
        validateNativeFamily('curl', 'linux', fixture.root);
        assert.deepEqual(fixture.calls(), ['ports/zlib/wasm run', 'ports/curl/wasm run', 'ports/curl/wasm pack', 'ports/curl/base pack']);

        fixture.resetCalls();
        process.env.PNPM_FAIL_IN = 'ports/zlib/wasm';
        assert.throws(() => validateNativeTargets(['curl', 'zlib', 'zstd'], ['wasm'], fixture.root), /@crossbind\/port-zlib-wasm/);
        // curl needs the failed zlib build, zstd does not: zstd still builds and packs.
        assert.deepEqual(fixture.calls(), ['ports/zlib/wasm run', 'ports/zstd/wasm run', 'ports/zstd/wasm pack']);

        assert.throws(() => validateNativeFamily('empty', 'linux', fixture.root), /no Linux native package/);
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
        fixture.cleanup();
    }
});

test('the native validation CLI runs one target group and refuses unknown, unsafe or empty work before running pnpm', () => {
    const fixture = nativeFixture();
    const cli = (...args) =>
        spawnSync(process.execPath, [path.join(ROOT, 'scripts/dependencies/validate-native-family.mjs'), ...args], {
            encoding: 'utf8',
            env: { ...process.env, ...fixture.env, CROSSBIND_DEPENDENCY_ROOT: fixture.root },
        });
    try {
        assert.equal(cli('--families', 'zlib,zstd', '--platform', 'linux', '--group', 'wasm').status, 0);
        assert.deepEqual(fixture.calls(), ['ports/zlib/wasm run', 'ports/zlib/wasm pack', 'ports/zstd/wasm run', 'ports/zstd/wasm pack']);
        fixture.resetCalls();
        for (const [args, message] of [
            [['--families', 'zlib', '--platform', 'linux', '--group', '__proto__'], /Unknown linux target group: __proto__/],
            [['--families', 'zlib', '--platform', 'constructor', '--group', 'wasm'], /Unsupported native validation platform: constructor/],
            [['--families', '../ports/zlib', '--platform', 'linux', '--group', 'wasm'], /native family is not safe/],
            [['--families', 'zlib', '--platform', 'linux', '--group', 'android'], /no linux android package was found/],
            [['--family', 'zlib', '--platform', 'linux'], /Missing --group/],
        ]) {
            const result = cli(...args);
            assert.equal(result.status, 1, args.join(' '));
            assert.match(result.stderr, message, args.join(' '));
        }
        assert.deepEqual(fixture.calls(), []);
    } finally {
        fixture.cleanup();
    }
});

test('the dependency PR workflow hands changed-units outputs and target groups to the matching native jobs', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github/workflows/validate-dependency-pr.yml'), 'utf8');
    const units = fs.readFileSync(path.join(ROOT, 'scripts/dependencies/changed-units.mjs'), 'utf8');
    const job = (name) => workflow.split(/\n(?= {4}[a-z][a-z-]*:\n)/).find((block) => block.startsWith(`    ${name}:\n`)) ?? '';
    const written = [...units.matchAll(/GITHUB_OUTPUT, `([a-z_]+)=/g)].map((match) => match[1]).sort();
    const mapped = [...job('changes').matchAll(/\n {12}([a-z_]+): \$\{\{ steps\.units\.outputs\.([a-z_]+) \}\}/g)];
    assert.deepEqual(mapped.map((match) => match[1]).sort(), written);
    assert.ok(mapped.every((match) => match[1] === match[2]));
    for (const platform of ['linux', 'macos']) {
        const block = job(`native-${platform}`);
        assert.match(block, new RegExp(`\\n {8}if: \\$\\{\\{ needs\\.changes\\.outputs\\.${platform}_group_count != '0' \\}\\}\\n`));
        assert.match(block, new RegExp(`\\n {12}matrix: \\$\\{\\{ fromJSON\\(needs\\.changes\\.outputs\\.${platform}_groups\\) \\}\\}\\n`));
        assert.match(block, /\n {18}FAMILIES: \$\{\{ needs\.changes\.outputs\.families \}\}\n/);
        assert.match(block, /\n {18}GROUP: \$\{\{ matrix\.group \}\}\n/);
        assert.match(block, new RegExp(`--families "\\$FAMILIES" --platform ${platform} --group "\\$GROUP"\\n`));
    }
});

test('on the real ports tree every target group builds each package once, dependencies first, and no package twice across groups', () => {
    const families = fs
        .readdirSync(path.join(ROOT, 'ports'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const builtBy = new Map();
    for (const [platform, groups] of Object.entries(TARGET_GROUPS)) {
        for (const [group, targets] of Object.entries(groups)) {
            const builds = nativeValidationSteps(families, targets, ROOT).filter((step) => step.type === 'build');
            const position = new Map(builds.map((step, index) => [step.name, index]));
            assert.equal(position.size, builds.length, `${platform}/${group} builds a package twice`);
            for (const [index, step] of builds.entries()) {
                for (const required of step.requires) {
                    assert.ok(!position.has(required) || position.get(required) < index, `${platform}/${group}: ${step.name} before ${required}`);
                }
                assert.ok(!builtBy.has(step.name), `${step.name} is built by both ${builtBy.get(step.name)} and ${platform}/${group}`);
                builtBy.set(step.name, `${platform}/${group}`);
            }
        }
    }
    assert.ok(builtBy.size > 0);
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

test('Android repository parsing keeps each stable NDK beside its published archive and checksum', () => {
    const ndk = (path, revision, url, sha1) => `
      <remotePackage path="${path}">
        <revision><major>${revision[0]}</major><minor>${revision[1]}</minor><micro>${revision[2]}</micro></revision>
        <archives><archive><host-os>linux</host-os><complete>
          <checksum type="sha-1">${sha1}</checksum>
          <url>${url}</url>
        </complete></archive></archives>
      </remotePackage>`;
    const parsed = parseAndroidRepository(
        ndk('ndk;27.3.13750724', [27, 3, 13750724], 'android-ndk-r27d-linux.zip', 'a'.repeat(40)) +
            ndk('ndk;30.0.16248370', [30, 0, 16248370], 'android-ndk-r30-linux.zip', 'b'.repeat(40)),
    );
    assert.deepEqual(
        parsed.ndks.map((entry) => entry.version),
        ['30.0.16248370', '27.3.13750724'],
    );
    assert.equal(parsed.ndks[0].file, 'android-ndk-r30-linux.zip');
    assert.equal(parsed.ndks[0].archiveRoot, 'android-ndk-r30');
    assert.equal(parsed.ndks[0].sha1, 'b'.repeat(40));
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

    assert.throws(() => decodeProposal(encode({ ...toolchain, component: 'android-command-line-tools' })), /unsupported toolchain component/);

    const androidNdk = {
        ...toolchain,
        id: 'toolchain-android-ndk-30.0.16248370',
        component: 'android-ndk',
        current: '27.3.13750724',
        target: '30.0.16248370',
        archiveRoot: 'android-ndk-r30',
    };
    assert.throws(() => decodeProposal(encode({ ...androidNdk, archive: 'evil.zip', sha1: 'a'.repeat(40) })), /archive metadata/);
    assert.throws(() => decodeProposal(encode({ ...androidNdk, archive: 'android-ndk-r30-linux.zip', sha1: 'nope' })), /archive metadata/);
    assert.throws(
        () => decodeProposal(encode({ ...androidNdk, archive: 'android-ndk-r30-linux.zip', sha1: 'a'.repeat(40), archiveRoot: '../escape' })),
        /archive metadata/,
    );
    const validNdk = { ...androidNdk, archive: 'android-ndk-r30-linux.zip', sha1: 'a'.repeat(40) };
    assert.deepEqual(decodeProposal(encodeProposal(validNdk)), validNdk);

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

test('native security counts what the recipe patches fix, by id or alias, and blocks only on the rest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-plan-patches-'));
    const recipe = (library, advisories) => {
        fs.mkdirSync(path.join(root, 'ports', library, 'base'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'ports', library, 'base', 'build.mjs'),
            `export default { patches: [{ file: new URL('./patches/fix.patch', import.meta.url), advisories: ${JSON.stringify(advisories)} }] };\n`,
        );
    };
    const row = (library, nativeVersion) => ({
        package: `@crossbind/port-${library}`,
        library,
        nativeVersion,
        latestVersion: nativeVersion,
        status: 'up-to-date',
        path: `ports/${library}/base/package.json`,
        homepage: `https://example.invalid/${library}`,
    });
    try {
        recipe('zlib', ['CVE-TEST-1', 'GHSA-test']);
        recipe('expat', ['CVE-TEST-3']);
        const plan = await createDependencyPlan({
            root,
            dependencies: {
                skipToolchains: true,
                nativeInventory: { rows: [row('zlib', '1.3.2'), row('expat', '2.9.0')] },
                githubCommitForRef: async (repository) => (repository === 'madler/zlib' ? 'a'.repeat(40) : 'b'.repeat(40)),
                osvCommitVulnerabilities: async (commit) =>
                    commit === 'a'.repeat(40)
                        ? [{ id: 'CVE-TEST-1' }, { id: 'OSV-TEST-2', aliases: ['GHSA-test'] }]
                        : [{ id: 'CVE-TEST-3' }, { id: 'CVE-TEST-4' }],
            },
        });
        assert.deepEqual(plan.errors, []);
        assert.deepEqual(
            plan.notices.map((notice) => [notice.component, notice.target]),
            [['native-security-zlib', 'patched']],
        );
        assert.match(plan.notices[0].reason, /CVE-TEST-1, OSV-TEST-2/);
        assert.deepEqual(
            plan.blockers.map((blocker) => blocker.component),
            ['native-security-expat'],
        );
        assert.match(plan.blockers[0].reason, /affected: CVE-TEST-4\./);
        assert.match(plan.blockers[0].reason, /patches fix CVE-TEST-3/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a family whose recipe carries patches is updated by hand, since the gate cannot drop a patch the release includes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-plan-patched-update-'));
    const recipe = (library, advisories) => {
        fs.mkdirSync(path.join(root, 'ports', library, 'base'), { recursive: true });
        fs.writeFileSync(
            path.join(root, 'ports', library, 'base', 'build.mjs'),
            `export default { patches: [{ file: new URL('./patches/fix.patch', import.meta.url), advisories: ${JSON.stringify(advisories)} }] };\n`,
        );
    };
    const row = (library, nativeVersion, latestVersion) => ({
        package: `@crossbind/port-${library}`,
        library,
        nativeVersion,
        latestVersion,
        status: 'outdated',
        path: `ports/${library}/base/package.json`,
        homepage: `https://example.invalid/${library}`,
    });
    try {
        recipe('zlib', ['CVE-TEST-1']);
        recipe('expat', ['CVE-TEST-3']);
        const current = { 'tags/v1.3.2': 'a'.repeat(40), 'tags/R_2_9_0': 'b'.repeat(40) };
        const plan = await createDependencyPlan({
            root,
            dependencies: {
                skipToolchains: true,
                nativeInventory: { rows: [row('zlib', '1.3.2', '1.3.3'), row('expat', '2.9.0', '2.9.1')] },
                githubCommitForRef: async (repository, ref) => current[ref] ?? 'c'.repeat(40),
                osvCommitVulnerabilities: async (commit) => {
                    if (commit === 'a'.repeat(40)) return [{ id: 'CVE-TEST-1' }];
                    if (commit === 'b'.repeat(40)) return [{ id: 'CVE-TEST-3' }, { id: 'CVE-TEST-4' }];
                    return [];
                },
            },
        });
        assert.deepEqual(plan.errors, []);
        assert.deepEqual(plan.selected, []);
        const blockers = Object.fromEntries(plan.blockers.map((blocker) => [blocker.component, blocker]));
        assert.deepEqual(Object.keys(blockers).sort(), ['native-expat', 'native-security-expat', 'native-zlib']);
        assert.equal(blockers['native-zlib'].target, '1.3.3');
        assert.match(blockers['native-zlib'].reason, /patches.*manual/);
        assert.match(blockers['native-security-expat'].reason, /affected: CVE-TEST-4\. Updating to 2\.9\.1 is manual/);
        assert.deepEqual(
            plan.notices.map((notice) => [notice.component, notice.target, notice.sourceUrl]),
            [['native-security-zlib', 'patched', 'https://osv.dev/list?q=CVE-TEST-1']],
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a reviewed manual library stands as a notice instead of blocking every run', async () => {
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
    assert.deepEqual(plan.blockers, []);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.notices[0].component, 'native-security-iconv');
});

test('a library with no reviewed commit identity blocks until one is configured', async () => {
    const plan = await createDependencyPlan({
        dependencies: {
            skipToolchains: true,
            nativeInventory: {
                rows: [
                    {
                        package: '@crossbind/port-freetype',
                        library: 'freetype',
                        nativeVersion: '2.13.3',
                        latestVersion: '2.14.0',
                        status: 'outdated',
                        path: 'ports/freetype/base/package.json',
                        homepage: 'https://freetype.org/',
                    },
                ],
            },
        },
    });
    assert.equal(plan.selected.length, 0);
    assert.deepEqual(plan.notices, []);
    assert.equal(plan.blockers[0].component, 'native-security-freetype');
});

test('an unreviewed NDK major stands as a notice instead of blocking every run', async () => {
    const ndk = (path, revision, url, sha1) => `
      <remotePackage path="${path}">
        <revision><major>${revision[0]}</major><minor>${revision[1]}</minor><micro>${revision[2]}</micro></revision>
        <archives><archive><host-os>linux</host-os><complete>
          <checksum type="sha-1">${sha1}</checksum>
          <url>${url}</url>
        </complete></archive></archives>
      </remotePackage>`;
    const xml =
        ndk('ndk;27.3.13750724', [27, 3, 13750724], 'android-ndk-r27d-linux.zip', 'a'.repeat(40)) +
        ndk('ndk;30.0.16248370', [30, 0, 16248370], 'android-ndk-r30-linux.zip', 'b'.repeat(40));
    const proposals = [];
    const notices = [];
    await planAndroid(ROOT, { repositoryXml: 'https://example.invalid/repository2-3.xml', ndkTrackMajor: 27 }, proposals, notices, {
        fetchText: async () => xml,
    });
    assert.equal(notices[0].component, 'android-ndk-major');
    assert.equal(notices[0].target, '30.0.16248370');
});

test('an NDK bump may touch every file that records the NDK version', () => {
    const ndk = { kind: 'toolchain', component: 'android-ndk', current: '27.3.13750724', target: '30.0.16248370' };
    for (const file of [
        'tooling/docker/android.Dockerfile',
        'docs/api/build-state.md',
        'docs/api/performance.md',
        'agents/skills/crossbind/references/api/build-state.md',
        'agents/skills/crossbind/references/api/performance.md',
        'agents/skills/crossbind/references/manifest.json',
    ]) {
        assert.equal(dependencyPathAllowed(ndk, file), true, file);
    }
    assert.equal(dependencyPathAllowed(ndk, 'core/crossbind/src/bin.js'), false);
    // The CLI names ndk/current, so a bump has no reason to touch it.
    assert.equal(dependencyPathAllowed(ndk, 'core/crossbind/src/actions/run.js'), false);
});

test('the Debian base moves by digest because its tag never does', async () => {
    const target = `sha256:${'b'.repeat(64)}`;
    const proposals = [];
    await planDebian(ROOT, { dockerImage: 'debian' }, proposals, { dockerHubDigest: async () => target });
    assert.equal(proposals[0].component, 'debian');
    assert.equal(proposals[0].valueType, 'digest');
    assert.equal(proposals[0].target, target);
    assert.equal(proposals[0].risk, 'digest');
    assert.match(proposals[0].current, /^sha256:[0-9a-f]{64}$/);
});

test('an unchanged Debian digest proposes nothing', async () => {
    const proposals = [];
    const current = /^FROM debian:[^@]+@(sha256:[0-9a-f]{64})/m.exec(fs.readFileSync(path.join(ROOT, 'tooling/docker/base.Dockerfile'), 'utf8'))[1];
    await planDebian(ROOT, { dockerImage: 'debian' }, proposals, { dockerHubDigest: async () => current });
    assert.deepEqual(proposals, []);
});

test('a digest proposal is rejected unless both ends are real digests', () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const debian = {
        id: 'toolchain-debian-abc123',
        kind: 'toolchain',
        component: 'debian',
        valueType: 'digest',
        current: `sha256:${'a'.repeat(64)}`,
        target: `sha256:${'b'.repeat(64)}`,
    };
    assert.deepEqual(decodeProposal(encodeProposal(debian)), debian);
    assert.throws(() => decodeProposal(encode({ ...debian, target: 'trixie-slim' })), /image digests/);
    assert.throws(() => decodeProposal(encode({ ...debian, current: 'latest' })), /image digests/);
});

test('a Debian refresh may touch only the files that pin it', () => {
    const debian = { kind: 'toolchain', component: 'debian', current: 'a', target: 'b' };
    assert.equal(dependencyPathAllowed(debian, 'tooling/docker/base.Dockerfile'), true);
    assert.equal(dependencyPathAllowed(debian, 'tooling/docker/linux.Dockerfile'), true);
    assert.equal(dependencyPathAllowed(debian, 'tooling/docker/web.Dockerfile'), false);
    assert.equal(dependencyPathAllowed(debian, '.nvmrc'), false);
});

test('a Debian refresh moves every Dockerfile that pins the digest', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-debian-digest-'));
    const currentDigest = `sha256:${'a'.repeat(64)}`;
    const targetDigest = `sha256:${'b'.repeat(64)}`;
    try {
        fs.mkdirSync(path.join(root, 'tooling/docker'), { recursive: true });
        fs.writeFileSync(path.join(root, 'tooling/docker/base.Dockerfile'), `FROM debian:trixie-slim@${currentDigest} AS os\n`);
        fs.writeFileSync(
            path.join(root, 'tooling/docker/linux.Dockerfile'),
            `FROM --platform=$BUILDPLATFORM debian:trixie-slim@${currentDigest} AS sysroots\n`,
        );
        const proposal = encodeProposal({
            id: 'toolchain-debian-bbbbbbbbbbbb',
            kind: 'toolchain',
            component: 'debian',
            valueType: 'digest',
            current: currentDigest,
            target: targetDigest,
        });
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/dependencies/apply-dependency-update.mjs'), '--proposal', proposal], {
            cwd: root,
            env: { ...process.env, CROSSBIND_DEPENDENCY_ROOT: root },
        });
        for (const file of ['base.Dockerfile', 'linux.Dockerfile']) {
            const text = fs.readFileSync(path.join(root, 'tooling/docker', file), 'utf8');
            assert.match(text, new RegExp(targetDigest), file);
            assert.doesNotMatch(text, new RegExp(currentDigest), file);
        }
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
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
    assert.equal(dependencyPathAllowed({ kind: 'native', unit: 'zlib' }, 'agents/skills/crossbind/references/ports.json'), true);
    assert.equal(dependencyPathAllowed({ kind: 'native', unit: 'zlib' }, 'agents/skills/crossbind/references/manifest.json'), true);
    assert.equal(dependencyPathAllowed({ kind: 'native', unit: 'zlib' }, 'agents/skills/crossbind/references/api/build-state.md'), false);
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
    assert.deepEqual(units.families, ['zlib']);
    assert.deepEqual(
        units.linuxGroups.include.map((entry) => entry.group),
        Object.keys(TARGET_GROUPS.linux),
    );
    assert.deepEqual(
        units.macosGroups.include.map((entry) => entry.group),
        ['ios', 'darwin'],
    );
    const toolchainOnly = changedDependencyUnits(['tooling/docker/base.Dockerfile']);
    assert.deepEqual(toolchainOnly.families, []);
    assert.deepEqual(toolchainOnly.linuxGroups.include, []);
    assert.deepEqual(toolchainOnly.macosGroups.include, []);
});

test("the linux and windows images' toolchain paths the CLI names are a toolchain change", () => {
    assert.equal(changedDependencyUnits(['core/crossbind/src/utils/linuxToolchain.js']).toolchain, true);
    assert.equal(changedDependencyUnits(['core/crossbind/src/utils/windowsToolchain.js']).toolchain, true);
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
    // The bot proposes and never merges: draft is the mechanical half of that contract.
    assert.match(candidate, /gh pr create --draft --base main/);
    assert.match(candidate, /--label dependencies --label automated-dependency-update/);
    assert.doesNotMatch(candidate, /npm publish|docker push|gh release create/);
    assert.doesNotMatch(watch, /secrets: inherit/);
    assert.match(watch, /report\.notices/);
    assert.match(scan, /published toolchain image scan failed/);
    assert.match(pullRequestValidation, /validate-native-family\.mjs/);
    assert.match(pullRequestValidation, /pnpm --dir tooling\/docker build:family/);
    assert.match(pullRequestValidation, /CROSSBIND_IMAGE_WEB: crossbind\/web:dev-amd64/);
    assert.match(pullRequestValidation, /pnpm run check:release:web/);
    assert.match(pullRequestValidation, /native-linux:[\s\S]*?max-parallel: 4\n[\s\S]*?native-macos:[\s\S]*?max-parallel: 2\n/);
    assert.match(dependabot, /package-ecosystem: npm/);
    assert.match(dependabot, /package-ecosystem: github-actions/);
    assert.match(dependabot, /package-ecosystem: docker/);
    assert.match(dependabot, /groups:\n\s+(#[^\n]*\n\s+)*vitest:\n\s+applies-to: version-updates\n\s+patterns:\n\s+- vitest\n\s+- '@vitest\/\*'/);
    assert.match(
        dependabot,
        /react-native:\n\s+applies-to: version-updates\n\s+patterns:\n\s+- react-native\n\s+- '@react-native\/\*'\n\s+- '@react-native-community\/\*'/,
    );
    assert.match(dependabot, /exclude-paths:\n\s+- examples\/mobile-reactnative-expo\/\*\*/);
    assert.match(dependabot, /cooldown:\n\s+default-days: 1\n/);
});

test('a rejected candidate becomes a reported finding instead of a failed watch', () => {
    const watch = fs.readFileSync(path.join(ROOT, '.github/workflows/dependency-watch.yml'), 'utf8');
    const candidate = fs.readFileSync(path.join(ROOT, '.github/workflows/dependency-update-candidate.yml'), 'utf8');
    assert.equal(candidate.match(/continue-on-error: true/g).length, 4);
    assert.match(candidate, /ready: \$\{\{ steps\.verdict\.outputs\.ready \}\}/);
    assert.match(candidate, /passed: \$\{\{ steps\.verdict\.outputs\.passed \}\}/);
    assert.match(candidate, /opened: \$\{\{ steps\.verdict\.outputs\.opened \}\}/);
    // A continue-on-error job reports success through `needs`, so the gate has to be an explicit verdict.
    assert.match(candidate, /needs\.validate-linux\.outputs\.passed == 'true'/);
    assert.doesNotMatch(candidate, /needs\.validate-linux\.result == 'success'/);
    assert.match(candidate, /name: dependency-rejection-/);
    assert.match(watch, /pattern: dependency-rejection-\*/);
    assert.match(watch, /process\.stdout\.write\("open"\)/);
    assert.match(watch, /process\.stdout\.write\("close"\)/);
});

test('native updater changes every nested nativeVersion field together', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/check-native-versions.js'), 'utf8');
    assert.match(source, /nativeVersion.*\)\(\[\^"\]\*\)\(.*\/g/);
    // Every target is validated in exactly one group, and standalone-wasi shares a runner with the wasi packages it wraps,
    // a Windows addon with the win32 port it links.
    const linuxTargets = Object.values(TARGET_GROUPS.linux).flat();
    assert.deepEqual([...linuxTargets].sort(), [
        'android',
        'base',
        'linux',
        'linuxmusl',
        'standalone-napi-win32-arm64',
        'standalone-napi-win32-x64',
        'standalone-wasi',
        'wasi',
        'wasm',
        'win32',
    ]);
    assert.ok(Object.values(TARGET_GROUPS.linux).some((targets) => targets.includes('wasi') && targets.includes('standalone-wasi')));
    assert.deepEqual(TARGET_GROUPS.linux.win32, ['win32', 'standalone-napi-win32-x64', 'standalone-napi-win32-arm64']);
    assert.deepEqual(Object.values(TARGET_GROUPS.macos).flat(), ['ios', 'darwin']);
});
