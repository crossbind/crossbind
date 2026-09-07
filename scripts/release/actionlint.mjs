#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ACTIONLINT_VERSION = '1.7.12';
export const RELEASE_WORKFLOWS = [
    '.github/workflows/check-crossbind-release.yml',
    '.github/workflows/publish-image.yml',
    '.github/workflows/publish-images.yml',
    '.github/workflows/release-crossbind.yml',
    '.github/workflows/scan-toolchain-images.yml',
];

const ARCHITECTURES = { x64: 'amd64', arm64: 'arm64', ia32: '386', arm: 'armv6' };
const CHECKSUMS = {
    'darwin-amd64': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
    'darwin-arm64': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
    'linux-386': '72a44b32c2d032700e6d0c23ca2f540b67519ec68db098ddfcfa96059e61f723',
    'linux-amd64': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
    'linux-arm64': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
    'windows-386': 'cdc8643b2c8dc890c76ad16095da97e75f86572805cc3573cc13f31ea0f19127',
    'windows-amd64': '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
    'windows-arm64': 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
};

export function actionlintArchive(platform = process.platform, architecture = process.arch) {
    const osName = platform === 'win32' ? 'windows' : platform;
    const archName = ARCHITECTURES[architecture];
    const key = `${osName}-${archName}`;
    const sha256 = CHECKSUMS[key];
    if (!archName || !sha256) throw new Error(`actionlint ${ACTIONLINT_VERSION} has no pinned archive for ${platform}/${architecture}.`);
    const extension = osName === 'windows' ? 'zip' : 'tar.gz';
    const filename = `actionlint_${ACTIONLINT_VERSION}_${osName}_${archName}.${extension}`;
    return {
        filename,
        sha256,
        url: `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${filename}`,
        executableName: osName === 'windows' ? 'actionlint.exe' : 'actionlint',
    };
}

async function installActionlint({ cacheRoot = path.join(os.tmpdir(), 'crossbind-actionlint'), fetchImpl = fetch } = {}) {
    const archive = actionlintArchive();
    const directory = path.join(cacheRoot, ACTIONLINT_VERSION, `${process.platform}-${process.arch}`);
    const executable = path.join(directory, archive.executableName);
    if (fs.existsSync(executable)) return executable;

    fs.mkdirSync(directory, { recursive: true });
    const response = await fetchImpl(archive.url);
    if (!response.ok) throw new Error(`Cannot download actionlint ${ACTIONLINT_VERSION}: HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actual = crypto.createHash('sha256').update(bytes).digest('hex');
    if (actual !== archive.sha256) {
        throw new Error(`actionlint archive SHA-256 mismatch: expected ${archive.sha256}, received ${actual}.`);
    }
    const archivePath = path.join(directory, archive.filename);
    fs.writeFileSync(archivePath, bytes);
    execFileSync('tar', ['-xf', archivePath, '-C', directory], { stdio: 'inherit' });
    if (!fs.existsSync(executable)) throw new Error(`${archive.filename} did not contain ${archive.executableName}.`);
    if (process.platform !== 'win32') fs.chmodSync(executable, 0o755);
    fs.unlinkSync(archivePath);
    return executable;
}

export function repositoryWorkflows(cwd = process.cwd()) {
    const directory = path.join(cwd, '.github', 'workflows');
    return fs
        .readdirSync(directory)
        .filter((name) => /\.ya?ml$/.test(name))
        .sort()
        .map((name) => path.join('.github', 'workflows', name));
}

export async function runActionlint({ files, cwd = process.cwd(), installOptions } = {}) {
    const executable = await installActionlint(installOptions);
    execFileSync(executable, ['-shellcheck=', '-pyflakes=', ...(files ?? repositoryWorkflows(cwd))], { cwd, stdio: 'inherit' });
    return executable;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await runActionlint({ files: process.argv.slice(2).length ? process.argv.slice(2) : undefined });
}
