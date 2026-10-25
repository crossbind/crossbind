#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TARGET_GROUPS } from './validate-native-family.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

export function changedDependencyUnits(files, root = ROOT) {
    const families = [...new Set(files.map((file) => /^ports\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))].sort();
    const groups = (platform) => ({
        include: Object.entries(TARGET_GROUPS[platform])
            .filter(([, targets]) =>
                families.some((family) => targets.some((target) => fs.existsSync(path.join(root, 'ports', family, target, 'package.json')))),
            )
            .map(([group]) => ({ group })),
    });
    return {
        toolchain: files.some(
            (file) =>
                file === '.nvmrc' ||
                file.startsWith('tooling/docker/') ||
                file === 'core/crossbind/src/actions/run.js' ||
                file === 'core/crossbind/src/utils/linuxToolchain.js' ||
                file === 'core/crossbind/src/utils/windowsToolchain.js' ||
                file === '.github/workflows/build-linux.yml',
        ),
        families,
        linuxGroups: groups('linux'),
        macosGroups: groups('macos'),
    };
}

function main() {
    const base = option('--base');
    const head = option('--head');
    if (!/^[0-9a-f]{40}$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) throw new Error('Base and head must be full commit SHAs.');
    const files = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, head], { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const units = changedDependencyUnits(files);
    process.stdout.write(
        `${files.length} changed file(s): ${units.families.length} native family/families in ${units.linuxGroups.include.length} Linux and ${units.macosGroups.include.length} macOS target group(s); toolchain=${units.toolchain}.\n`,
    );
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `families=${units.families.join(',')}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `linux_groups=${JSON.stringify(units.linuxGroups)}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `linux_group_count=${units.linuxGroups.include.length}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `macos_groups=${JSON.stringify(units.macosGroups)}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `macos_group_count=${units.macosGroups.include.length}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `toolchain=${units.toolchain}\n`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
