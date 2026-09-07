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

export function validateNativeFamily(family, platform, root = ROOT) {
    assertSafeId(family, 'native family');
    if (!['linux', 'macos'].includes(platform)) throw new Error(`Unsupported native validation platform: ${platform}`);
    const familyRoot = path.join(root, 'ports', family);
    if (!fs.existsSync(familyRoot)) throw new Error(`${family}: native family does not exist.`);
    const packages = nativeWorkspacePackages(root);
    const built = new Set();
    const targets = platform === 'macos' ? ['ios'] : ['base', 'wasm', 'wasi', 'bin-wasi', 'android'];
    let packed = 0;
    for (const target of targets) {
        const directory = path.join(familyRoot, target);
        const manifestPath = path.join(directory, 'package.json');
        if (!fs.existsSync(manifestPath)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        for (const entry of nativeDependencyBuildOrder(manifest.name, packages)) {
            if (built.has(entry.manifest.name)) continue;
            if (packageHasScript(entry.directory, 'prepublishOnly')) run('pnpm', ['run', 'prepublishOnly'], entry.directory);
            built.add(entry.manifest.name);
        }
        const packDestination = fs.mkdtempSync(path.join(os.tmpdir(), `crossbind-${family}-${target}-`));
        try {
            run('pnpm', ['pack', '--pack-destination', packDestination], directory);
        } finally {
            fs.rmSync(packDestination, { recursive: true, force: true });
        }
        packed += 1;
    }
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
        validateNativeFamily(option('--family'), option('--platform'));
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
