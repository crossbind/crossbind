#!/usr/bin/env node
// Installs the standalone Node-API packages of an assembled train from its exact tarballs, as a user does from
// npm, and runs the e2e/check.mjs of each package on this machine: one package per app, then all of them in
// one process. The release workflow runs it on every platform an addon targets, with each supported Node.js
// major, before anything is published. Node.js built-ins only: it also runs in a bare Alpine container.
//
//   node scripts/release/verify-node-packages.mjs --artifact-dir <assembled train>

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostAddonTarget, nodePackageKind, run, serveRegistry, tarballEntry } from '../lib/node-registry.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCOPE = '@crossbind';
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const artifactDir = path.resolve(valueOf('--artifact-dir') ?? 'workspace-release-artifacts');
const tarballDir = path.join(artifactDir, 'tarballs');

// npm is a .cmd script on Windows, which execFile cannot start without a shell.
const NPM =
    process.platform === 'win32'
        ? [process.execPath, path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
        : ['npm'];
const npm = (args, options) => run(NPM[0], [...NPM.slice(1), ...args], options);

const { artifacts } = JSON.parse(fs.readFileSync(path.join(artifactDir, 'workspace-release-artifacts.json'), 'utf8'));
const entries = artifacts
    .filter((artifact) => /^@crossbind\/.+-standalone-napi(?:-(?:darwin|linux|linuxmusl|win32)-(?:arm64|x64))?$/.test(artifact.package))
    .map((artifact) => tarballEntry(path.join(tarballDir, artifact.filename)))
    .filter((entry) => nodePackageKind({ name: entry.manifest.name, manifest: entry.manifest }));
const bindings = entries.map((entry) => entry.manifest).filter((manifest) => !manifest.os);
const target = hostAddonTarget(process.report.getReport(), process.platform, process.arch);

if (bindings.length === 0) throw new Error(`verify-node-packages: ${artifactDir} holds no standalone Node-API package.`);

// A port's package is ports/<family>/standalone-napi.
function checkOf(manifest) {
    const family = /^@crossbind\/port-(.+)-standalone-napi$/.exec(manifest.name)?.[1];
    const file = family && path.join(ROOT, 'ports', family, 'standalone-napi', 'e2e', 'check.mjs');
    if (!file || !fs.existsSync(file)) throw new Error(`${manifest.name} has no e2e/check.mjs to verify it with.`);
    return file;
}

async function install(app, manifests, port) {
    fs.writeFileSync(path.join(app, 'package.json'), '{"name":"verify","private":true}\n');
    const specs = manifests.map(({ name, version }) => `${name}@${version}`);
    await npm(
        [
            'install',
            ...specs,
            '--registry',
            `http://127.0.0.1:${port}`,
            '--no-audit',
            '--no-fund',
            '--loglevel',
            'error',
            '--cache',
            path.join(app, '.npm'),
        ],
        {
            cwd: app,
        },
    );
}

// npm must have picked the one addon package of this machine by os, cpu and libc.
function assertAddon(app, { name }) {
    const baseName = name.slice(SCOPE.length + 1);
    const installed = fs.readdirSync(path.join(app, 'node_modules', SCOPE)).filter((entry) => entry.startsWith(`${baseName}-`));
    if (installed.length !== 1 || installed[0] !== `${baseName}-${target}`) {
        throw new Error(`${name}: npm installed ${installed.join(', ') || 'no addon package'} on ${target}, expected ${baseName}-${target}.`);
    }
}

const server = await serveRegistry(entries, tarballDir);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-verify-node-'));
try {
    const { port } = server.address();
    for (const manifest of bindings) {
        const app = fs.mkdtempSync(path.join(work, 'package-'));
        await install(app, [manifest], port);
        assertAddon(app, manifest);
        fs.copyFileSync(checkOf(manifest), path.join(app, 'check.mjs'));
        await run(process.execPath, ['check.mjs'], { cwd: app, env: { ...process.env, NATIVE_VERSION: manifest.nativeVersion } });
    }
    // An app using several packages keeps each one's addon, registrations and runtime helpers apart.
    const together = fs.mkdtempSync(path.join(work, 'together-'));
    await install(together, bindings, port);
    bindings.forEach((manifest, index) => fs.copyFileSync(checkOf(manifest), path.join(together, `check-${index}.mjs`)));
    fs.writeFileSync(
        path.join(together, 'together.mjs'),
        [
            "process.on('warning', (warning) => { if (warning.name === 'MaxListenersExceededWarning') throw warning; });",
            ...bindings.map(
                ({ nativeVersion }, index) => `process.env.NATIVE_VERSION = ${JSON.stringify(nativeVersion)};\nawait import('./check-${index}.mjs');`,
            ),
            '',
        ].join('\n'),
    );
    await run(process.execPath, ['together.mjs'], { cwd: together });
    console.log(`verify-node-packages: ${bindings.length} package(s) verified on ${target} with Node.js ${process.version}`);
} finally {
    server.close();
    fs.rmSync(work, { recursive: true, force: true });
}
