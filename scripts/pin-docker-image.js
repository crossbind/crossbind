#!/usr/bin/env node
// Writes the verified image workflow digest table into the committed JSON consumed by the CLI,
// package-release manifests and release assets. The source is the table emitted from the registry's
// raw manifests - not `docker inspect` on whatever happens to be pulled locally.
//
//   gh run download <run id> -n digests -D /tmp/digests
//   node scripts/pin-docker-image.js /tmp/digests/digests.json
//
// Each image needs two references: the multi-arch index, which a native pull resolves per
// platform, and its linux/amd64 leaf, for the paths where the CLI forces a platform (android).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'core', 'crossbind', 'src', 'assets', 'toolchain-digests.json');
const VERSION_FILE = path.join(ROOT, 'tooling', 'docker', 'VERSION');
const ROLES = ['rust-sysroot', 'base', 'web', 'android'];

const fail = (message) => {
    console.error(`pin-docker-image: ${message}`);
    process.exit(1);
};

const tablePath = process.argv[2];
if (!tablePath) fail('pass the digests.json produced by the publish workflow');

let table;
try {
    table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
} catch (e) {
    fail(`cannot read ${tablePath}: ${e.message}`);
}

const declared = fs.readFileSync(VERSION_FILE, 'utf8').trim();
if (table.version !== declared) {
    fail(`the table is for ${table.version} but tooling/docker/VERSION says ${declared} - publish that version or update the file`);
}
if (!table.registry) fail('the table has no registry');
if (!/^\d+\.\d+\.\d+$/.test(table.toolchains?.rust ?? '')) {
    fail('the table has no exact toolchains.rust version');
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
ROLES.forEach((role) => {
    const image = table.images?.[role];
    if (!image) fail(`the table has no entry for ${role}`);
    if (!DIGEST.test(image.index ?? '')) fail(`${role}: index digest is missing or malformed`);
    for (const [platform, digest] of Object.entries(image.platforms ?? {})) {
        if (!DIGEST.test(digest)) fail(`${role}: ${platform} digest is malformed`);
    }
    if (!DIGEST.test(image.platforms?.['linux/amd64'] ?? '')) fail(`${role}: no linux/amd64 leaf digest`);
});

const next = `${JSON.stringify(
    { version: table.version, registry: table.registry, toolchains: { rust: table.toolchains.rust }, images: table.images },
    null,
    4,
)}\n`;
const text = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : '';

if (next === text) {
    console.log(`pin-docker-image: already pinned to ${table.registry} ${table.version}`);
    process.exit(0);
}
fs.writeFileSync(TARGET, next);
console.log(`pin-docker-image: pinned ${table.registry} ${table.version}`);
ROLES.forEach((role) => {
    const image = table.images[role];
    console.log(`  ${role.padEnd(12)} index ${image.index.slice(0, 19)}...  amd64 ${image.platforms['linux/amd64'].slice(0, 19)}...`);
});
