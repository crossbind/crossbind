#!/usr/bin/env node
// Installs a standalone Node-API package the way a user does, from a registry, and runs its e2e/check.mjs:
// on this machine, then in glibc and musl containers of both architectures. The packages are packed
// and served by a registry this script runs, so npm picks the addon package by os, cpu and libc as it
// does from npmjs.org. Addons for machines nothing here runs are checked for the machine they target.
// Runs in the directory of the package after its build.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { run, serveRegistry, tarballEntry } from './lib/node-registry.mjs';
import { FORMAT_OF_OS, binaryIdentity } from './release/node-packages.mjs';

const CONTAINER_IMAGES = { glibc: 'node:24-bookworm-slim', musl: 'node:24-alpine' };
const CONTAINERS = [['glibc', 'arm64'], ['glibc', 'x64'], ['musl', 'arm64'], ['musl', 'x64']];
const DOCKER_ARCH = { arm64: 'arm64', x64: 'amd64' };

const root = process.cwd();
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const manifest = readManifest(root);
const [scope, baseName] = manifest.name.split('/');
const addonDirOf = (name) => path.dirname(createRequire(path.join(root, 'package.json')).resolve(`${name}/package.json`));
const addonPackages = Object.keys(manifest.optionalDependencies ?? {})
    .filter((name) => name.startsWith(`${manifest.name}-`))
    .map((name) => ({ name, dir: addonDirOf(name), ...readManifest(addonDirOf(name)) }));

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

function pack(dir, destination) {
    const before = new Set(fs.readdirSync(destination));
    // stderr carries the reason the prepack guard refuses a package.
    execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
    return tarballEntry(path.join(destination, fs.readdirSync(destination).find((entry) => !before.has(entry))));
}

// The one addon package npm installed must be the one for the machine.
function checkInstalled(label, listing, expected) {
    const installed = listing.split('\n').map((line) => line.trim()).filter((line) => line.startsWith(`${baseName}-`));
    if (installed.length !== 1 || installed[0] !== expected) {
        fail(`${label} installed ${installed.join(', ') || 'no addon package'}, expected ${expected}`);
    }
    console.log(`ok: ${label} installed ${scope}/${expected} alone`);
}

async function runHost(port, checkDir) {
    const app = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-package-'));
    try {
        fs.writeFileSync(path.join(app, 'package.json'), '{"name":"e2e","private":true}\n');
        await run('npm', [
            'install', `${manifest.name}@${manifest.version}`, '--registry', `http://127.0.0.1:${port}`,
            '--no-audit', '--no-fund', '--loglevel', 'error', '--cache', path.join(app, '.npm'),
        ], { cwd: app });
        fs.copyFileSync(path.join(checkDir, 'check.mjs'), path.join(app, 'check.mjs'));
        await run('node', ['check.mjs'], { cwd: app, env: { ...process.env, NATIVE_VERSION: manifest.nativeVersion } });
        const label = `${process.platform}-${process.arch} host`;
        checkInstalled(label, fs.readdirSync(path.join(app, 'node_modules', scope)).join('\n'), `${baseName}-${process.platform}-${process.arch}`);
    } finally {
        fs.rmSync(app, { recursive: true, force: true });
    }
}

async function runContainer(port, checkDir, libc, arch) {
    const platform = libc === 'musl' ? 'linuxmusl' : 'linux';
    const script = [
        'set -e',
        'mkdir -p /tmp/app && cd /tmp/app',
        'echo \'{"name":"e2e","private":true}\' > package.json',
        `npm install ${manifest.name}@${manifest.version} --registry http://host.docker.internal:${port} --no-audit --no-fund --loglevel error`,
        'cp /check/check.mjs . && node check.mjs',
        `ls node_modules/${scope}`,
    ].join('\n');
    const output = await run('docker', [
        'run', '--rm', '--platform', `linux/${DOCKER_ARCH[arch]}`, '--add-host', 'host.docker.internal:host-gateway',
        '-e', `NATIVE_VERSION=${manifest.nativeVersion}`, '-v', `${checkDir}:/check:ro`,
        CONTAINER_IMAGES[libc], 'sh', '-c', script,
    ]);
    checkInstalled(`${platform}-${arch} in ${CONTAINER_IMAGES[libc]}`, output, `${baseName}-${platform}-${arch}`);
}

// The macOS and Windows addons of machines neither the host nor a container runs.
function checkUnrun() {
    addonPackages
        .filter(({ os: [system], cpu: [arch] }) => system !== 'linux' && `${system}-${arch}` !== `${process.platform}-${process.arch}`)
        .forEach(({ name, dir, main, os: [system], cpu: [arch] }) => {
            const { format, arch: actual } = binaryIdentity(fs.readFileSync(path.join(dir, main)));
            if (format !== FORMAT_OF_OS[system] || actual !== arch) fail(`${name} does not target ${system}-${arch}`);
            console.log(`ok: ${name} targets ${system}-${arch}, not run`);
        });
}

const missing = addonPackages.filter(({ dir, main }) => !fs.existsSync(path.join(dir, main))).map(({ name }) => name);
if (missing.length) fail(`not built: ${missing.join(', ')}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-registry-'));
const server = await serveRegistry([root, ...addonPackages.map(({ dir }) => dir)].map((dir) => pack(dir, work)), work);
try {
    const { port } = server.address();
    const checkDir = path.join(root, 'e2e');
    await runHost(port, checkDir);
    for (const [libc, arch] of CONTAINERS) await runContainer(port, checkDir, libc, arch);
    checkUnrun();
} finally {
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
}
