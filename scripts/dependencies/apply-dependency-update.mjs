#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    COMMIT_RE,
    SHA1_RE,
    SHA256_RE,
    assertSafeId,
    decodeProposal,
    githubCommitForRef,
    githubJson,
    readText,
    replaceOne,
    sha256Url,
    writeText,
} from './dependency-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.CROSSBIND_DEPENDENCY_ROOT ?? path.resolve(SCRIPT_DIR, '../..'));

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

function replaceLiteral(text, current, target, label, expected = 1) {
    const count = text.split(current).length - 1;
    if (count !== expected) throw new Error(`${label}: expected ${expected} occurrence(s) of ${JSON.stringify(current)}, found ${count}.`);
    return text.split(current).join(target);
}

function updateFile(relativePath, updater) {
    const current = readText(ROOT, relativePath);
    const updated = updater(current);
    if (updated === current) throw new Error(`${relativePath}: update made no change.`);
    writeText(ROOT, relativePath, updated);
}

function walkPackageJsons(directory) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (['node_modules', '.git', '.crossbind', 'dist'].includes(entry.name)) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkPackageJsons(absolute));
        else if (entry.name === 'package.json') files.push(absolute);
    }
    return files;
}

function applyNative(proposal) {
    const family = assertSafeId(proposal.unit, 'native family');
    const root = path.join(ROOT, 'ports', family);
    if (!fs.existsSync(root)) throw new Error(`${family}: native family does not exist.`);
    let packages = 0;
    for (const packagePath of walkPackageJsons(root)) {
        const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
        if (!manifest.nativeVersion) continue;
        if (manifest.nativeVersion !== proposal.current) {
            throw new Error(`${path.relative(ROOT, packagePath)}: expected nativeVersion ${proposal.current}, got ${manifest.nativeVersion}.`);
        }
        const source = fs.readFileSync(packagePath, 'utf8');
        const pattern = /("nativeVersion"\s*:\s*")([^"]*)(")/g;
        let replacements = 0;
        const updated = source.replace(pattern, (match, prefix, value, suffix) => {
            if (value !== proposal.current) throw new Error(`${path.relative(ROOT, packagePath)}: inconsistent nested nativeVersion ${value}.`);
            replacements += 1;
            return `${prefix}${proposal.target}${suffix}`;
        });
        if (replacements === 0) throw new Error(`${path.relative(ROOT, packagePath)}: no nativeVersion field was updated.`);
        fs.writeFileSync(packagePath, updated);
        packages += 1;
    }
    if (packages === 0) throw new Error(`${family}: no native packages were updated.`);
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/pin-source-hash.js'), family], {
        cwd: ROOT,
        stdio: 'inherit',
        env: process.env,
    });
}

function applyNode(proposal) {
    if (proposal.current !== proposal.target) {
        updateFile('.nvmrc', (text) => replaceLiteral(text, proposal.current, proposal.target, '.nvmrc'));
        updateFile('tooling/docker/licenses-README.md', (text) =>
            replaceLiteral(text, `node:${proposal.current}-trixie-slim`, `node:${proposal.targetTag}`, 'Node license source'),
        );
        updateFile('docs/playbooks/releasing-crossbind.md', (text) =>
            replaceLiteral(text, `Node ${proposal.current} LTS`, `Node ${proposal.target} LTS`, 'documented Node pin'),
        );
    }
    updateFile('tooling/docker/base.Dockerfile', (text) =>
        replaceLiteral(
            text,
            `FROM node:${proposal.current}-trixie-slim@${proposal.currentDigest}`,
            `FROM node:${proposal.targetTag}@${proposal.targetDigest}`,
            'Node Docker image',
        ),
    );
    const oldMajor = proposal.current.split('.')[0];
    const newMajor = proposal.target.split('.')[0];
    if (oldMajor !== newMajor) {
        for (const packagePath of walkPackageJsons(ROOT)) {
            const source = fs.readFileSync(packagePath, 'utf8');
            const current = `"node": ">=${oldMajor}"`;
            if (!source.includes(current)) continue;
            fs.writeFileSync(packagePath, source.split(current).join(`"node": ">=${newMajor}"`));
        }
    }
}

function applyRust(proposal) {
    for (const relativePath of ['tooling/docker/base.Dockerfile', 'tooling/docker/rust-sysroot.Dockerfile']) {
        updateFile(relativePath, (text) => {
            let updated = replaceLiteral(
                text,
                `ARG RUST_VERSION=${proposal.current}`,
                `ARG RUST_VERSION=${proposal.target}`,
                `${relativePath} Rust pin`,
            );
            if (proposal.currentDigest !== proposal.targetDigest) {
                updated = replaceLiteral(
                    updated,
                    `FROM rust:${proposal.bootstrapTag}@${proposal.currentDigest}`,
                    `FROM rust:${proposal.bootstrapTag}@${proposal.targetDigest}`,
                    `${relativePath} Rust bootstrap digest`,
                );
            }
            return updated;
        });
    }
    if (proposal.current !== proposal.target) {
        updateFile('tooling/docker/licenses-README.md', (text) =>
            replaceLiteral(text, `exact Rust ${proposal.current} distribution`, `exact Rust ${proposal.target} distribution`, 'Rust license source'),
        );
    }
}

function applyEmscripten(proposal) {
    updateFile('tooling/docker/web.Dockerfile', (text) => {
        let updated = text;
        if (proposal.current !== proposal.target) {
            updated = replaceLiteral(
                updated,
                `ARG EMSDK_VERSION=${proposal.current}`,
                `ARG EMSDK_VERSION=${proposal.target}`,
                'web Emscripten version',
            );
            updated = replaceLiteral(
                updated,
                `rebased directly onto the upstream ${proposal.current} tag commit`,
                `rebased directly onto the upstream ${proposal.target} tag commit`,
                'Emscripten fork contract comment',
            );
            const currentRevision = /^ARG CROSSBIND_EMSCRIPTEN_REV=([0-9a-f]{40})$/m.exec(updated)?.[1];
            const currentHash = /^ARG CROSSBIND_EMBIND_SHA256=([0-9a-f]{64})$/m.exec(updated)?.[1];
            if (!currentRevision || !currentHash) throw new Error('Current Crossbind Emscripten fork pins are invalid.');
            updated = replaceLiteral(updated, currentRevision, proposal.forkRevision, 'Crossbind Emscripten revision');
            updated = replaceLiteral(updated, currentHash, proposal.embindSha256, 'Crossbind libembind hash');
        }
        updated = replaceLiteral(
            updated,
            `FROM emscripten/emsdk:\${EMSDK_VERSION}@${proposal.currentDigest}`,
            `FROM emscripten/emsdk:\${EMSDK_VERSION}@${proposal.targetDigest}`,
            'Emscripten Docker digest',
        );
        return updated;
    });
    if (proposal.current !== proposal.target) {
        updateFile('tooling/docker/rust-sysroot.Dockerfile', (text) =>
            replaceLiteral(text, `ARG EMSDK_VERSION=${proposal.current}`, `ARG EMSDK_VERSION=${proposal.target}`, 'sysroot Emscripten version'),
        );
        updateFile('tooling/docker/licenses-README.md', (text) =>
            replaceLiteral(text, `emscripten/emsdk:${proposal.current}`, `emscripten/emsdk:${proposal.target}`, 'Emscripten license sources', 2),
        );
    }
}

async function wasiMetadata(version) {
    const tag = `wasi-sdk-${version}`;
    const repository = 'WebAssembly/wasi-sdk';
    await githubCommitForRef(repository, `tags/${tag}`);
    const [llvm, wasiLibc] = await Promise.all([
        githubJson(`/repos/${repository}/contents/src/llvm-project?ref=${encodeURIComponent(tag)}`),
        githubJson(`/repos/${repository}/contents/src/wasi-libc?ref=${encodeURIComponent(tag)}`),
    ]);
    if (!COMMIT_RE.test(llvm.sha ?? '') || !COMMIT_RE.test(wasiLibc.sha ?? '')) {
        throw new Error(`${tag}: wasi-sdk submodule revisions are unavailable.`);
    }
    const archives = {
        arm64: `https://github.com/${repository}/releases/download/${tag}/wasi-sdk-${version}.0-arm64-linux.tar.gz`,
        x86_64: `https://github.com/${repository}/releases/download/${tag}/wasi-sdk-${version}.0-x86_64-linux.tar.gz`,
    };
    const licenseUrls = {
        'wasi-sdk-LICENSE': `https://raw.githubusercontent.com/${repository}/${tag}/LICENSE`,
        'llvm-LICENSE.TXT': `https://raw.githubusercontent.com/llvm/llvm-project/${llvm.sha}/LICENSE.TXT`,
        'wasi-libc-LICENSE': `https://raw.githubusercontent.com/WebAssembly/wasi-libc/${wasiLibc.sha}/LICENSE`,
        'wasi-libc-LICENSE-APACHE': `https://raw.githubusercontent.com/WebAssembly/wasi-libc/${wasiLibc.sha}/LICENSE-APACHE`,
        'wasi-libc-LICENSE-APACHE-LLVM': `https://raw.githubusercontent.com/WebAssembly/wasi-libc/${wasiLibc.sha}/LICENSE-APACHE-LLVM`,
        'wasi-libc-LICENSE-MIT': `https://raw.githubusercontent.com/WebAssembly/wasi-libc/${wasiLibc.sha}/LICENSE-MIT`,
    };
    const [arm64, x86_64, licenseEntries] = await Promise.all([
        sha256Url(archives.arm64),
        sha256Url(archives.x86_64),
        Promise.all(Object.entries(licenseUrls).map(async ([name, url]) => [name, await sha256Url(url)])),
    ]);
    return { llvm: llvm.sha, wasiLibc: wasiLibc.sha, arm64, x86_64, licenses: Object.fromEntries(licenseEntries) };
}

function replaceHashForFile(text, filename, hash) {
    if (!SHA256_RE.test(hash)) throw new Error(`${filename}: invalid generated SHA-256.`);
    return replaceOne(
        text,
        new RegExp(`"[0-9a-f]{64}  ${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
        () => `"${hash}  ${filename}"`,
        `${filename} license hash`,
    );
}

async function applyWasi(proposal) {
    const metadata = await wasiMetadata(proposal.target);
    updateFile('tooling/docker/web.Dockerfile', (text) => {
        let updated = replaceLiteral(text, `ARG WASI_SDK_VERSION=${proposal.current}`, `ARG WASI_SDK_VERSION=${proposal.target}`, 'wasi-sdk version');
        const currentArm = /arm64\) WASI_ARCH=arm64;\s+WASI_SHA=([0-9a-f]{64})/.exec(updated)?.[1];
        const currentX64 = /WASI_ARCH=x86_64; WASI_SHA=([0-9a-f]{64})/.exec(updated)?.[1];
        const currentLlvm = /^ARG LLVM_REV=([0-9a-f]{40})$/m.exec(updated)?.[1];
        const currentLibc = /^ARG WASI_LIBC_REV=([0-9a-f]{40})$/m.exec(updated)?.[1];
        if (!currentArm || !currentX64 || !currentLlvm || !currentLibc) throw new Error('Current wasi-sdk pins are incomplete.');
        updated = replaceLiteral(updated, currentArm, metadata.arm64, 'wasi-sdk arm64 hash');
        updated = replaceLiteral(updated, currentX64, metadata.x86_64, 'wasi-sdk x86_64 hash');
        updated = replaceLiteral(updated, currentLlvm, metadata.llvm, 'wasi-sdk LLVM revision');
        updated = replaceLiteral(updated, currentLibc, metadata.wasiLibc, 'wasi-libc revision');
        for (const [filename, hash] of Object.entries(metadata.licenses)) updated = replaceHashForFile(updated, filename, hash);
        return updated;
    });
    updateFile('.github/workflows/build-linux.yml', (text) => {
        let updated = replaceLiteral(text, `wasi-sdk-${proposal.current}`, `wasi-sdk-${proposal.target}`, 'Linux wasi-sdk URLs and paths', 2);
        const currentHash = /echo "([0-9a-f]{64}) {2}\$RUNNER_TEMP\/wasi-sdk\.tar\.gz"/.exec(updated)?.[1];
        if (!currentHash) throw new Error('Linux workflow wasi-sdk hash is missing.');
        return replaceLiteral(updated, currentHash, metadata.x86_64, 'Linux workflow wasi-sdk hash');
    });
    updateFile('tooling/docker/licenses-README.md', (text) =>
        replaceLiteral(text, `wasi-sdk-${proposal.current}`, `wasi-sdk-${proposal.target}`, 'wasi-sdk license source'),
    );
}

async function applyAndroidTools(proposal) {
    if (!/^commandlinetools-linux-\d+_latest\.zip$/.test(proposal.archive) || !SHA1_RE.test(proposal.sha1 ?? '')) {
        throw new Error('Android command-line tools proposal has invalid archive metadata.');
    }
    const sha256 = await sha256Url(`https://dl.google.com/android/repository/${proposal.archive}`);
    updateFile('tooling/docker/android.Dockerfile', (text) => {
        let updated = replaceLiteral(
            text,
            `ARG CMDLINE_TOOLS=commandlinetools-linux-${proposal.current}_latest.zip`,
            `ARG CMDLINE_TOOLS=${proposal.archive}`,
            'Android command-line tools archive',
        );
        const currentSha1 = /^ARG CMDLINE_TOOLS_SHA1=([0-9a-f]{40})$/m.exec(updated)?.[1];
        const currentSha256 = /^ARG CMDLINE_TOOLS_SHA256=([0-9a-f]{64})$/m.exec(updated)?.[1];
        if (!currentSha1 || !currentSha256) throw new Error('Current Android command-line tools hashes are missing.');
        updated = replaceLiteral(updated, currentSha1, proposal.sha1, 'Android command-line tools SHA-1');
        return replaceLiteral(updated, currentSha256, sha256, 'Android command-line tools SHA-256');
    });
}

function applyAndroidNdk(proposal) {
    updateFile('tooling/docker/android.Dockerfile', (text) =>
        replaceLiteral(text, `ENV NDK_VERSION=${proposal.current}`, `ENV NDK_VERSION=${proposal.target}`, 'Android Docker NDK version'),
    );
    updateFile('core/crossbind/src/actions/run.js', (text) =>
        replaceLiteral(text, `/opt/android-sdk/ndk/${proposal.current}`, `/opt/android-sdk/ndk/${proposal.target}`, 'CLI Android NDK path'),
    );
    updateFile('docs/api/build-state.md', (text) =>
        replaceLiteral(text, `NDK ${proposal.current}`, `NDK ${proposal.target}`, 'documented Android NDK'),
    );
}

async function applySwig(proposal) {
    if (!COMMIT_RE.test(proposal.target)) throw new Error('SWIG target is not a full commit SHA.');
    const hash = await sha256Url(`https://github.com/crossbind/swig/archive/${proposal.target}.zip`);
    updateFile('tooling/docker/base.Dockerfile', (text) => {
        let updated = replaceLiteral(text, `ARG SWIG_REV=${proposal.current}`, `ARG SWIG_REV=${proposal.target}`, 'SWIG revision');
        const currentHash = /^ARG SWIG_SHA256=([0-9a-f]{64})$/m.exec(updated)?.[1];
        if (!currentHash) throw new Error('Current SWIG source hash is missing.');
        return replaceLiteral(updated, currentHash, hash, 'SWIG source hash');
    });
    updateFile('tooling/docker/licenses-README.md', (text) =>
        replaceLiteral(text, proposal.current.slice(0, 8), proposal.target.slice(0, 8), 'SWIG license source revision'),
    );
}

async function applyToolchain(proposal) {
    switch (proposal.component) {
        case 'node':
            return applyNode(proposal);
        case 'rust':
            return applyRust(proposal);
        case 'emscripten':
            return applyEmscripten(proposal);
        case 'wasi-sdk':
            return applyWasi(proposal);
        case 'android-command-line-tools':
            return applyAndroidTools(proposal);
        case 'android-ndk':
            return applyAndroidNdk(proposal);
        case 'swig':
            return applySwig(proposal);
        default:
            throw new Error(`Unsupported toolchain component: ${proposal.component}`);
    }
}

export async function applyProposal(proposal) {
    if (proposal.kind === 'native') return applyNative(proposal);
    if (proposal.kind === 'toolchain') return applyToolchain(proposal);
    throw new Error(`Unsupported proposal kind: ${proposal.kind}`);
}

async function main() {
    const proposal = decodeProposal(option('--proposal'));
    await applyProposal(proposal);
    process.stdout.write(`Prepared ${proposal.id}: ${proposal.current} -> ${proposal.target}. No branch, PR, package or image was published.\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
