#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeProposal } from './dependency-lib.mjs';
import { validateNativeFamily } from './validate-native-family.mjs';

const ROOT = path.resolve(process.env.CROSSBIND_DEPENDENCY_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));

function option(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

function run(command, args, options = {}) {
    process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
    execFileSync(command, args, { cwd: options.cwd ?? ROOT, stdio: 'inherit', env: { ...process.env, ...options.environment } });
}

function changedFiles() {
    return execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR'], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
}

export function dependencyPathAllowed(proposal, file) {
    if (proposal.kind === 'native') return file.startsWith(`ports/${proposal.unit}/`);
    switch (proposal.component) {
        case 'node':
            return (
                ['.nvmrc', 'tooling/docker/base.Dockerfile', 'tooling/docker/licenses-README.md', 'docs/playbooks/releasing-crossbind.md'].includes(
                    file,
                ) ||
                (proposal.current.split('.')[0] !== proposal.target.split('.')[0] && path.basename(file) === 'package.json')
            );
        case 'rust':
            return ['tooling/docker/base.Dockerfile', 'tooling/docker/rust-sysroot.Dockerfile', 'tooling/docker/licenses-README.md'].includes(file);
        case 'swig':
            return ['tooling/docker/base.Dockerfile', 'tooling/docker/licenses-README.md'].includes(file);
        case 'emscripten':
            return ['tooling/docker/web.Dockerfile', 'tooling/docker/rust-sysroot.Dockerfile', 'tooling/docker/licenses-README.md'].includes(file);
        case 'wasi-sdk':
            return ['tooling/docker/web.Dockerfile', 'tooling/docker/licenses-README.md', '.github/workflows/build-linux.yml'].includes(file);
        case 'android-command-line-tools':
            return file === 'tooling/docker/android.Dockerfile';
        case 'android-ndk':
            return [
                'tooling/docker/android.Dockerfile',
                'core/crossbind/src/actions/run.js',
                'docs/api/build-state.md',
                'agents/skills/crossbind/references/api/build-state.md',
                'agents/skills/crossbind/references/manifest.json',
            ].includes(file);
        default:
            throw new Error(`No changed-file policy for ${proposal.component}.`);
    }
}

function assertChangeScope(proposal) {
    const files = changedFiles();
    if (files.length === 0) throw new Error(`${proposal.id}: updater produced no files.`);
    const unexpected = files.filter((file) => !dependencyPathAllowed(proposal, file));
    if (unexpected.length > 0)
        throw new Error(`${proposal.id}: updater changed files outside its policy:\n${unexpected.map((file) => `  - ${file}`).join('\n')}`);
    process.stdout.write(`${proposal.id}: ${files.length} changed file(s) stay inside the declared update unit.\n`);
}

function validateNative(proposal, platform) {
    if (platform === 'metadata') {
        run(process.execPath, ['scripts/check-source-hashes.js', '--check']);
        run(process.execPath, ['scripts/check-dependency-wiring.js', '--check']);
        return;
    }
    validateNativeFamily(proposal.unit, platform, ROOT);
}

function validateToolchain(proposal, platform) {
    if (platform === 'metadata') {
        run(process.execPath, ['scripts/release/actionlint.mjs']);
        run('pnpm', ['--filter', 'crossbind', 'test']);
        return;
    }
    if (platform === 'macos') {
        run('pnpm', ['--filter', 'crossbind', 'test']);
        return;
    }
    if (proposal.component === 'android-command-line-tools' || proposal.component === 'android-ndk') {
        run('pnpm', ['build:base:amd64'], { cwd: path.join(ROOT, 'tooling/docker') });
        run('pnpm', ['build:android'], { cwd: path.join(ROOT, 'tooling/docker') });
        run(process.execPath, ['scripts/smoke-images.js', 'android:amd64']);
        return;
    }
    run('pnpm', ['build:family'], { cwd: path.join(ROOT, 'tooling/docker') });
    run(process.execPath, ['scripts/smoke-images.js', 'base:amd64', 'web:amd64', 'android:amd64']);
    run('pnpm', ['run', 'gate:local-sysroot']);
    run('pnpm', ['run', 'check:release:web'], { environment: { CROSSBIND_IMAGE_WEB: 'crossbind/web:dev-amd64' } });
}

export function validateChangeScope(proposal) {
    assertChangeScope(proposal);
}

async function main() {
    const proposal = decodeProposal(option('--proposal'));
    const platform = option('--platform', 'metadata');
    if (!['metadata', 'linux', 'macos'].includes(platform)) throw new Error(`Unsupported validation platform: ${platform}`);
    if (platform === 'metadata') assertChangeScope(proposal);
    if (proposal.kind === 'native') validateNative(proposal, platform);
    else validateToolchain(proposal, platform);
    run('git', ['diff', '--check']);
    run('git', ['diff', '--cached', '--check']);
    process.stdout.write(`${proposal.id}: ${platform} validation passed.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
