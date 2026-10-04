#!/usr/bin/env node
// Copies each addon a ready-made Node package built into the platform package npm installs it from,
// ports/<family>/node-<platform>-<arch>, whose main names the file. Runs in the package directory
// after `crossbind build -e node`; a macOS addon builds only on a macOS host, so one may be missing.

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readManifest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const { name, optionalDependencies = {} } = readManifest(root);

const addonPackages = Object.keys(optionalDependencies).filter((dependency) => dependency.startsWith(`${name}-`));
const staged = addonPackages.flatMap((dependency) => {
    const dir = path.join(root, '..', `node-${dependency.slice(name.length + 1)}`);
    const { main } = readManifest(dir);
    const built = path.join(root, 'dist', main);
    if (!fs.existsSync(built)) return [];
    // A new file: macOS kills the process that loads a binary written over one it loaded before.
    fs.rmSync(path.join(dir, main), { force: true });
    fs.copyFileSync(built, path.join(dir, main));
    return [dependency];
});

const missing = addonPackages.filter((dependency) => !staged.includes(dependency));
console.log(`stage-node-addons: ${staged.length} of ${addonPackages.length} addons staged${missing.length ? `; not built here: ${missing.join(', ')}` : ''}`);
