#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

export function changedDependencyUnits(files, root = ROOT) {
    const families = [...new Set(files.map((file) => /^ports\/([^/]+)\//.exec(file)?.[1]).filter(Boolean))].sort();
    return {
        toolchain: files.some(
            (file) =>
                file === '.nvmrc' ||
                file.startsWith('tooling/docker/') ||
                file === 'core/crossbind/src/actions/run.js' ||
                file === '.github/workflows/build-linux.yml',
        ),
        families: {
            include: families.map((family) => ({
                family,
                macos: fs.existsSync(path.join(root, 'ports', family, 'ios', 'package.json')),
            })),
        },
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
    process.stdout.write(`${files.length} changed file(s): ${units.families.include.length} native family/families; toolchain=${units.toolchain}.\n`);
    if (process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `families=${JSON.stringify(units.families)}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `family_count=${units.families.include.length}\n`);
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
