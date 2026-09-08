#!/usr/bin/env node
// Run the local-consumption gate with the exact compiler that built the currently published,
// digest-pinned sysroot. GitHub runner images update Rust independently, while prebuilt rlibs are
// compiler-specific, so relying on the runner's moving `stable` toolchain makes this gate flaky.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TABLE = path.join(ROOT, 'core', 'crossbind', 'src', 'assets', 'toolchain-digests.json');

export function pinnedRustVersion(table) {
    const version = table?.toolchains?.rust;
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error('the canonical toolchain digest table has no exact toolchains.rust version');
    }
    return version;
}

export function runPinnedLocalSysrootGate({ tablePath = TABLE, args = process.argv.slice(2), spawn = spawnSync, environment = process.env } = {}) {
    const table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
    const version = pinnedRustVersion(table);
    console.log(`gate-pinned-local-sysroot: installing and selecting rustc ${version} for toolchain image ${table.version}`);

    const install = spawn('rustup', ['toolchain', 'install', version, '--profile', 'minimal', '--no-self-update'], {
        cwd: ROOT,
        env: environment,
        stdio: 'inherit',
    });
    if (install.error) throw install.error;
    if (install.status !== 0) throw new Error(`rustup toolchain install ${version} exited ${install.status}`);

    const gate = spawn('rustup', ['run', version, 'node', path.join(ROOT, 'scripts', 'gate-local-sysroot.js'), ...args], {
        cwd: ROOT,
        env: environment,
        stdio: 'inherit',
    });
    if (gate.error) throw gate.error;
    return gate.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = runPinnedLocalSysrootGate();
    } catch (error) {
        console.error(`gate-pinned-local-sysroot: ${error.message}`);
        process.exitCode = 1;
    }
}
