#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeId } from './dependency-lib.mjs';

const ROOT = path.resolve(process.env.CROSSBIND_DEPENDENCY_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));

function run(command, args, cwd) {
    process.stdout.write(`$ ${command} ${args.join(' ')}\n`);
    execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
}

function packageHasScript(directory, script) {
    const manifestPath = path.join(directory, 'package.json');
    if (!fs.existsSync(manifestPath)) return false;
    return Boolean(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).scripts?.[script]);
}

function nativeWorkspacePackages(root) {
    const packages = new Map();
    const portsRoot = path.join(root, 'ports');
    for (const family of fs.readdirSync(portsRoot, { withFileTypes: true })) {
        if (!family.isDirectory()) continue;
        const familyRoot = path.join(portsRoot, family.name);
        for (const target of fs.readdirSync(familyRoot, { withFileTypes: true })) {
            if (!target.isDirectory()) continue;
            const directory = path.join(familyRoot, target.name);
            const manifestPath = path.join(directory, 'package.json');
            if (!fs.existsSync(manifestPath)) continue;
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.name) throw new Error(`${manifestPath}: package name is required.`);
            packages.set(manifest.name, { directory, manifest });
        }
    }
    return packages;
}

export function nativeDependencyBuildOrder(packageName, packages) {
    const order = [];
    const visiting = new Set();
    const visited = new Set();

    function visit(name) {
        if (visited.has(name)) return;
        if (visiting.has(name)) throw new Error(`${packageName}: native workspace dependency cycle includes ${name}.`);
        const entry = packages.get(name);
        if (!entry) return;
        visiting.add(name);
        for (const field of ['dependencies', 'optionalDependencies']) {
            for (const [dependency, range] of Object.entries(entry.manifest[field] ?? {})) {
                if (packages.has(dependency)) visit(dependency);
                else if (String(range).startsWith('workspace:') && dependency.startsWith('@crossbind/port-')) {
                    throw new Error(`${name}: workspace dependency ${dependency} is missing from ports/.`);
                }
            }
        }
        visiting.delete(name);
        visited.add(name);
        order.push(entry);
    }

    if (!packages.has(packageName)) throw new Error(`${packageName}: native workspace package was not found.`);
    visit(packageName);
    return order;
}

// A pull request validates each group on its own runner, so a package is built once per group however many
// changed families need it. Longest first, by measured build time: max-parallel's slots then free up together.
export const TARGET_GROUPS = {
    linux: {
        wasm: ['wasm'],
        wasi: ['wasi', 'standalone-wasi'],
        linux: ['linux'],
        linuxmusl: ['linuxmusl'],
        android: ['android'],
        win32: ['win32'],
        base: ['base'],
    },
    macos: { ios: ['ios'], darwin: ['darwin'] },
};

function platformGroups(platform) {
    if (!Object.hasOwn(TARGET_GROUPS, platform)) throw new Error(`Unsupported native validation platform: ${platform}`);
    return TARGET_GROUPS[platform];
}

export function nativeValidationSteps(families, targets, root = ROOT) {
    const packages = nativeWorkspacePackages(root);
    const closure = (name) => nativeDependencyBuildOrder(name, packages).map((entry) => entry.manifest.name);
    const built = new Set();
    const steps = [];
    for (const target of targets) {
        for (const family of families) {
            const directory = path.join(root, 'ports', family, target);
            const manifestPath = path.join(directory, 'package.json');
            if (!fs.existsSync(manifestPath)) continue;
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            for (const entry of nativeDependencyBuildOrder(manifest.name, packages)) {
                const name = entry.manifest.name;
                if (built.has(name)) continue;
                built.add(name);
                if (packageHasScript(entry.directory, 'prepublishOnly')) {
                    steps.push({ type: 'build', directory: entry.directory, name, requires: closure(name).slice(0, -1) });
                }
            }
            steps.push({ type: 'pack', directory, family, target, name: manifest.name, requires: closure(manifest.name) });
        }
    }
    return steps;
}

// A failed build skips only the steps that need it, so one run reports every family's result.
export function validateNativeTargets(families, targets, root = ROOT) {
    for (const family of families) {
        assertSafeId(family, 'native family');
        if (!fs.existsSync(path.join(root, 'ports', family))) throw new Error(`${family}: native family does not exist.`);
    }
    const broken = new Set();
    const failed = [];
    const skipped = [];
    let packed = 0;
    for (const step of nativeValidationSteps(families, targets, root)) {
        const label = `${step.type} ${step.name} (${path.relative(root, step.directory)})`;
        const blocker = step.requires.find((name) => broken.has(name));
        if (blocker) {
            process.stdout.write(`\n== skip ${label}: ${blocker} did not build\n`);
            if (step.type === 'build') broken.add(step.name);
            skipped.push(label);
            continue;
        }
        process.stdout.write(`\n== ${label}\n`);
        try {
            if (step.type === 'build') {
                run('pnpm', ['run', 'prepublishOnly'], step.directory);
                continue;
            }
            const packDestination = fs.mkdtempSync(path.join(os.tmpdir(), `crossbind-${step.family}-${step.target}-`));
            try {
                run('pnpm', ['pack', '--pack-destination', packDestination], step.directory);
            } finally {
                fs.rmSync(packDestination, { recursive: true, force: true });
            }
            packed += 1;
        } catch (error) {
            console.error(`== ${label} failed: ${error.message}`);
            if (step.type === 'build') broken.add(step.name);
            failed.push(label);
        }
    }
    if (failed.length > 0) {
        const because = skipped.length > 0 ? `; skipped because of them: ${skipped.join('; ')}` : '';
        throw new Error(`native validation failed: ${failed.join('; ')}${because}`);
    }
    return packed;
}

export function validateNativeFamily(family, platform, root = ROOT) {
    const packed = validateNativeTargets([family], Object.values(platformGroups(platform)).flat(), root);
    if (packed === 0 && platform === 'linux') throw new Error(`${family}: no Linux native package was found.`);
    process.stdout.write(`${family}: validated and packed ${packed} ${platform} package(s).\n`);
}

function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const platform = option('--platform');
        const group = option('--group');
        const groups = platformGroups(platform);
        if (!Object.hasOwn(groups, group)) throw new Error(`Unknown ${platform} target group: ${group}`);
        const families = [...new Set(option('--families').split(','))];
        const packed = validateNativeTargets(families, groups[group]);
        if (packed === 0) throw new Error(`${families.join(', ')}: no ${platform} ${group} package was found.`);
        process.stdout.write(`${families.join(', ')}: validated and packed ${packed} ${platform} ${group} package(s).\n`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
