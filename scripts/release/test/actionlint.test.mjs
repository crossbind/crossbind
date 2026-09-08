import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pinnedRustVersion, runPinnedLocalSysrootGate } from '../../gate-pinned-local-sysroot.mjs';
import { ACTIONLINT_VERSION, actionlintArchive } from '../actionlint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE_ENGINE_PACKAGES = [
    'package.json',
    'core/crossbind/package.json',
    'tooling/create-app/package.json',
    'examples/mobile-reactnative-cli/package.json',
    'e2e/mobile-reactnative-cli/package.json',
];

test('actionlint archives are versioned and SHA-256 pinned', () => {
    const linux = actionlintArchive('linux', 'x64');
    assert.equal(linux.filename, `actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz`);
    assert.match(linux.sha256, /^[0-9a-f]{64}$/);
    assert.equal(linux.url, `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${linux.filename}`);
});

test('published sysroot validation selects the compiler recorded beside the immutable digest', () => {
    const tablePath = path.join(ROOT, 'core', 'crossbind', 'src', 'assets', 'toolchain-digests.json');
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    assert.match(pinnedRustVersion(table), /^\d+\.\d+\.\d+$/);
    assert.throws(() => pinnedRustVersion({ toolchains: { rust: 'stable' } }), /exact toolchains\.rust/);

    const calls = [];
    const status = runPinnedLocalSysrootGate({
        tablePath,
        args: ['--image', 'example.invalid/sysroot', '--index', `sha256:${'a'.repeat(64)}`],
        spawn(command, args) {
            calls.push([command, args]);
            return { status: 0 };
        },
    });
    assert.equal(status, 0);
    assert.deepEqual(calls[0], ['rustup', ['toolchain', 'install', table.toolchains.rust, '--profile', 'minimal', '--no-self-update']]);
    assert.equal(calls[1][0], 'rustup');
    assert.deepEqual(calls[1][1].slice(0, 3), ['run', table.toolchains.rust, 'node']);
    assert.deepEqual(calls[1][1].slice(-4), ['--image', 'example.invalid/sysroot', '--index', `sha256:${'a'.repeat(64)}`]);

    const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.match(rootPackage.scripts['check:release:toolchain'], /^pnpm run gate:pinned-local-sysroot/);
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'dependencies', 'validate-dependency-update.mjs'), 'utf8'), /gate:pinned-local-sysroot/);
    assert.match(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-images.yml'), 'utf8'), /toolchains: \{rust: \$rust\}/);
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'pin-docker-image.js'), 'utf8'), /toolchains: \{ rust: table\.toolchains\.rust \}/);
});

test('every Trivy scan uses a real reviewed scanner release', () => {
    const workflowDirectory = path.join(ROOT, '.github', 'workflows');
    let scanSteps = 0;
    let reviewedVersions = 0;
    for (const workflow of fs.readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml'))) {
        const source = fs.readFileSync(path.join(workflowDirectory, workflow), 'utf8');
        scanSteps += source.match(/uses:\s*aquasecurity\/trivy-action@/g)?.length ?? 0;
        reviewedVersions += source.match(/uses:\s*aquasecurity\/trivy-action@[^\n]+\n\s+with:\n\s+version:\s*v0\.74\.0/g)?.length ?? 0;
        assert.doesNotMatch(source, /version:\s*v0\.69\.0/);
    }
    assert.ok(scanSteps > 0);
    assert.equal(reviewedVersions, scanSteps);
});

test('the release workflow uses OIDC without stored npm credentials or post-publish dist-tag writes', () => {
    const source = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release-crossbind.yml'), 'utf8');
    assert.match(source, /id-token:\s*write/);
    assert.doesNotMatch(source, /NPM_TOKEN|NODE_AUTH_TOKEN|npm\s+dist-tag/);
    assert.doesNotMatch(source, /pnpm run release:(?:dry-run|manifest) --(?:\s|\\)/);
    assert.match(source, /node-version-file: \.nvmrc/);
    assert.match(source, /npm@12\.0\.2/);
    assert.doesNotMatch(source, /runs-on:\s*ubuntu-latest/);
    assert.match(source, /name: Release npm package train/);
    assert.match(source, /runs-on: macos-15/);
    assert.match(source, /build_linux:[\s\S]*build_macos:[\s\S]*assemble:[\s\S]*publish:/);
    assert.match(source, /npm-release/);
    assert.match(source, /plan-workspace-release\.mjs/);
    assert.match(source, /publish-workspace-release\.mjs --apply/);

    const registry = fs.readFileSync(path.join(ROOT, 'scripts', 'release', 'npm-registry.mjs'), 'utf8');
    assert.match(registry, /\['publish', tarball, '--tag', distTag, '--access', 'public', '--provenance'\]/);
});

test('every GitHub Actions Node job uses the exact repository pin', () => {
    assert.match(fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(), /^\d+\.\d+\.\d+$/);

    const workflowDirectory = path.join(ROOT, '.github', 'workflows');
    for (const workflow of fs.readdirSync(workflowDirectory).filter((name) => name.endsWith('.yml'))) {
        const source = fs.readFileSync(path.join(workflowDirectory, workflow), 'utf8');
        const setupNodeSteps = source.match(/uses:\s*actions\/setup-node@/g)?.length ?? 0;
        const repositoryPins = source.match(/node-version-file:\s*\.nvmrc/g)?.length ?? 0;

        assert.equal(repositoryPins, setupNodeSteps, `${workflow} must read every Node version from .nvmrc`);
        assert.doesNotMatch(source, /\bnode-version:/, `${workflow} must not carry a second Node version`);
    }
});

test('repository and Node-facing package engines match the exact Node LTS major', () => {
    const nodeVersion = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
    const nodeMajor = nodeVersion.split('.')[0];
    for (const packagePath of NODE_ENGINE_PACKAGES) {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, packagePath), 'utf8'));
        assert.equal(manifest.engines?.node, `>=${nodeMajor}`, `${packagePath} must require the pinned Node LTS major`);
    }

    const dockerfile = fs.readFileSync(path.join(ROOT, 'tooling', 'docker', 'base.Dockerfile'), 'utf8');
    assert.match(dockerfile, new RegExp(`^FROM node:${nodeVersion.replaceAll('.', '\\.')}\\-trixie-slim@sha256:[0-9a-f]{64} AS node$`, 'm'));
});

test('the unpublished toolchain image train uses the reviewed stable versions', () => {
    const dockerDirectory = path.join(ROOT, 'tooling', 'docker');
    const base = fs.readFileSync(path.join(dockerDirectory, 'base.Dockerfile'), 'utf8');
    const sysroot = fs.readFileSync(path.join(dockerDirectory, 'rust-sysroot.Dockerfile'), 'utf8');
    const web = fs.readFileSync(path.join(dockerDirectory, 'web.Dockerfile'), 'utf8');
    const android = fs.readFileSync(path.join(dockerDirectory, 'android.Dockerfile'), 'utf8');
    const linuxWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-linux.yml'), 'utf8');

    const rustVersion = /^ARG RUST_VERSION=(\d+\.\d+\.\d+)$/m.exec(base)?.[1];
    const emsdkVersion = /^ARG EMSDK_VERSION=(\d+\.\d+\.\d+)$/m.exec(web)?.[1];
    const wasiVersion = /^ARG WASI_SDK_VERSION=(\d+)$/m.exec(web)?.[1];
    const ndkVersion = /^ENV NDK_VERSION=(\d+\.\d+\.\d+)$/m.exec(android)?.[1];
    assert.ok(rustVersion);
    assert.ok(emsdkVersion);
    assert.ok(wasiVersion);
    assert.ok(ndkVersion);
    assert.match(sysroot, new RegExp(`^ARG RUST_VERSION=${rustVersion.replaceAll('.', '\\.')}$`, 'm'));
    assert.match(sysroot, new RegExp(`^ARG EMSDK_VERSION=${emsdkVersion.replaceAll('.', '\\.')}$`, 'm'));
    assert.match(web, /^FROM emscripten\/emsdk:\$\{EMSDK_VERSION\}@sha256:[0-9a-f]{64} AS emsdk$/m);
    assert.match(web, /^ARG CROSSBIND_EMSCRIPTEN_REV=[0-9a-f]{40}$/m);
    assert.match(web, /^ARG CROSSBIND_EMBIND_SHA256=[0-9a-f]{64}$/m);
    assert.doesNotMatch(web, new RegExp(`wasi-sdk-${wasiVersion}-rc|${wasiVersion}\\.0-rc`));
    assert.match(linuxWorkflow, new RegExp(`wasi-sdk-${wasiVersion}(?:/|\\.0-)`));
    assert.doesNotMatch(linuxWorkflow, new RegExp(`wasi-sdk-${wasiVersion}-rc|${wasiVersion}\\.0-rc`));
    assert.match(android, /^ARG CMDLINE_TOOLS=commandlinetools-linux-\d+_latest\.zip$/m);
    assert.match(android, /^ARG CMDLINE_TOOLS_SHA1=[0-9a-f]{40}$/m);
    assert.match(android, /^ARG CMDLINE_TOOLS_SHA256=[0-9a-f]{64}$/m);
    assert.match(android, /\$\{CMDLINE_TOOLS_SHA256\}.*sha256sum -c -/);
    assert.match(
        fs.readFileSync(path.join(ROOT, 'core/crossbind/src/actions/run.js'), 'utf8'),
        new RegExp(`/opt/android-sdk/ndk/${ndkVersion.replaceAll('.', '\\.')}`),
    );
    assert.match(base, /^USER 10001:10001$/m);
    assert.match(web, /^USER 10001:10001$/m);
    assert.match(android, /^USER 10001:10001$/m);
});

test('legacy package scripts cannot publish with a stored npm credential', () => {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const name of ['publish:examples', 'publish:plugins', 'publish:create', 'publish:all', 'publish:beta']) {
        assert.equal(rootPackage.scripts[name], 'node scripts/release/refuse-legacy-npm-publish.mjs');
    }
    assert.equal(rootPackage.scripts['publish:core'], 'node scripts/release/refuse-direct-crossbind-publish.mjs');
});

test('the toolchain release is GHCR-only, attested and write-free by default', () => {
    const release = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-images.yml'), 'utf8');
    const reusable = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish-image.yml'), 'utf8');
    assert.doesNotMatch(release, /DOCKERHUB_|docker\.io/);
    assert.match(release, /dry_run:[\s\S]*default:\s*true/);
    assert.match(release, /environment:\s*toolchain-release/);
    assert.match(release, /Scan local base image[\s\S]*cache:\s*false/);
    assert.match(reusable, /provenance:\s*mode=max/);
    assert.match(reusable, /sbom:\s*true/);
});

test('unsupported actionlint platforms fail instead of downloading an unpinned binary', () => {
    assert.throws(() => actionlintArchive('plan9', 'mips'), /no pinned archive/);
});

test('every external action in every repository workflow is pinned to a full commit SHA', () => {
    const workflowDirectory = path.join(ROOT, '.github', 'workflows');
    for (const workflow of fs.readdirSync(workflowDirectory).filter((name) => /\.ya?ml$/.test(name))) {
        const source = fs.readFileSync(path.join(ROOT, '.github', 'workflows', workflow), 'utf8');
        const actions = [...source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]).filter((action) => !action.startsWith('./'));
        assert.ok(actions.length > 0, `${workflow} has no external actions to validate`);
        for (const action of actions) assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/, `${workflow}: ${action} is not commit-pinned`);
    }
});
