#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateReleaseManifest } from './release-lib.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const valueOf = (name) => {
    const index = process.argv.indexOf(name);
    return index === -1 ? undefined : process.argv[index + 1];
};
const manifestPath = process.argv[2];
if (!manifestPath || manifestPath.startsWith('--')) {
    throw new Error('Usage: node scripts/release/validate-crossbind-manifest.mjs <crossbind-release.json> [--root <path>]');
}
const root = path.resolve(valueOf('--root') ?? REPOSITORY_ROOT);
const manifest = readJson(path.resolve(manifestPath));
validateReleaseManifest(manifest, { root, schemaSource: valueOf('--schema') });
process.stdout.write(`${manifestPath}: valid crossbind release manifest for ${manifest.git.tag}.\n`);
