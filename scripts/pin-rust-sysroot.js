#!/usr/bin/env node
// Compatibility entrypoint for the old two-command pinning procedure. The CLI now reads every
// image, including rust-sysroot, from one committed toolchain-digests.json written by
// pin-docker-image.js. This command validates that the canonical table already matches the input.
//
//   gh run download <run id> -n digests -D /tmp/digests
//   node scripts/pin-rust-sysroot.js /tmp/digests/digests.json
//
// It consumes the same digest table the CLI's image pins come from - there is no separate artifact
// to publish or hash. One index digest is the whole contract: the loader verifies the index body
// against it, and every descriptor inside a verified body authenticates the next fetch.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'core', 'crossbind', 'src', 'assets', 'toolchain-digests.json');
const VERSION_FILE = path.join(ROOT, 'tooling', 'docker', 'VERSION');

const fail = (message) => {
    console.error(`pin-rust-sysroot: ${message}`);
    process.exit(1);
};

const tablePath = process.argv[2];
if (!tablePath) fail('pass the digests.json produced by the publish workflow');
if (!fs.existsSync(tablePath)) fail(`${tablePath} does not exist`);

let table;
try {
    table = JSON.parse(fs.readFileSync(tablePath, 'utf8'));
} catch (e) {
    fail(`${tablePath} is not valid JSON: ${e.message}`);
}

const expected = fs.readFileSync(VERSION_FILE, 'utf8').trim();
if (table.version !== expected) {
    fail(
        `the table was produced for ${table.version}, but tooling/docker/VERSION says ${expected}.\n` +
            '  Publish the images for this version first, or check out the commit that produced the table.',
    );
}

const entry = table.images?.['rust-sysroot'];
if (!entry?.index) fail('the digest table carries no rust-sysroot index digest');
if (!/^sha256:[0-9a-f]{64}$/.test(entry.index)) fail(`the index digest is malformed: ${entry.index}`);

const registry = table.registry ?? table.primary;
if (!registry) fail('the digest table names no registry');
if (!/^\d+\.\d+\.\d+$/.test(table.toolchains?.rust ?? '')) fail('the digest table names no exact toolchains.rust version');

const canonical = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
if (
    canonical.version !== table.version ||
    canonical.registry !== registry ||
    canonical.toolchains?.rust !== table.toolchains?.rust ||
    canonical.images?.['rust-sysroot']?.index !== entry.index
) {
    fail(`the canonical ${path.relative(ROOT, TARGET)} does not match; run scripts/pin-docker-image.js first`);
}

console.log(`pin-rust-sysroot: ${path.relative(ROOT, TARGET)} already carries the verified sysroot`);
console.log(`  version  ${table.version}`);
console.log(`  image    ${registry}/rust-sysroot`);
console.log(`  index    ${entry.index}`);
console.log(`  rustc    ${canonical.toolchains.rust}`);
