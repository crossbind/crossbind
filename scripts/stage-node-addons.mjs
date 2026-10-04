#!/usr/bin/env node
// Copies each addon a ready-made Node package built into the platform package npm installs it from,
// <name>-<platform>-<arch>, whose main names the file, and derives the license files of
// every package from `crossbind licenses`. Runs in the package directory after `crossbind build -e
// node`; a macOS addon builds only on a macOS host, so one may be missing, and a package whose
// addon was not built here only gets its license field.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { deriveLicenseExpression } from '../core/crossbind/src/utils/licenseReport.js';
import { setManifestLicense, writeNodePackageLicense } from './release/node-packages.mjs';

const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, 'package.json'));
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const { name, version, repository, optionalDependencies = {} } = readManifest(root);
const meta = { version, repository, projectPath: path.relative(path.resolve(import.meta.dirname, '..'), root).split(path.sep).join('/') };

const crossbindManifest = requireFromRoot.resolve('crossbind/package.json');
const crossbindBin = path.join(path.dirname(crossbindManifest), JSON.parse(fs.readFileSync(crossbindManifest, 'utf8')).bin.crossbind);

const rowsByPlatform = new Map();
function licenseRows(platform) {
    if (!rowsByPlatform.has(platform)) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-node-licenses-'));
        const args = ['licenses', ...(platform ? ['--platform', platform] : []), '--runtime-env', 'node', '--json', path.join(dir, 'rows.json')];
        const { status } = spawnSync(process.execPath, [crossbindBin, ...args], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
        if (status !== 0) throw new Error(`crossbind ${args.slice(0, -1).join(' ')} failed in ${root}`);
        rowsByPlatform.set(platform, JSON.parse(fs.readFileSync(path.join(dir, 'rows.json'), 'utf8')));
        fs.rmSync(dir, { recursive: true, force: true });
    }
    return rowsByPlatform.get(platform);
}

const addonPackages = Object.keys(optionalDependencies).filter((dependency) => dependency.startsWith(`${name}-`));
const staged = addonPackages.flatMap((dependency) => {
    const suffix = dependency.slice(name.length + 1);
    const dir = path.dirname(requireFromRoot.resolve(`${dependency}/package.json`));
    const { main } = readManifest(dir);
    const rows = licenseRows(suffix.slice(0, suffix.lastIndexOf('-')));
    const built = path.join(root, 'dist', main);
    if (!fs.existsSync(built)) {
        setManifestLicense(dir, deriveLicenseExpression(rows));
        return [];
    }
    // A new file: macOS kills the process that loads a binary written over one it loaded before.
    fs.rmSync(path.join(dir, main), { force: true });
    fs.copyFileSync(built, path.join(dir, main));
    writeNodePackageLicense(dir, { ...meta, name: dependency, addonFile: main, rows });
    return [dependency];
});

const bindingRows = licenseRows(null);
const dist = path.join(root, 'dist');
const hasBindings = fs.existsSync(dist) && fs.readdirSync(dist, { recursive: true }).some((file) => file.endsWith('.h.cjs'));
if (hasBindings) writeNodePackageLicense(root, { ...meta, name, rows: bindingRows });
else setManifestLicense(root, deriveLicenseExpression(bindingRows));

const missing = addonPackages.filter((dependency) => !staged.includes(dependency));
console.log(`stage-node-addons: ${staged.length} of ${addonPackages.length} addons staged${missing.length ? `; not built here: ${missing.join(', ')}` : ''}`);
