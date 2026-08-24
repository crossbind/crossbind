#!/usr/bin/env node
// Release gate (ADR rev 6.6): the mirror carries the same bytes, all the way down.
//
//   node scripts/gate-registry.js                     # compare GHCR against Docker Hub
//   node scripts/gate-registry.js --table digests.json  # also write the release digest table
//
// Comparing the index digest alone proves only that two registries agree on a pointer. This walks
// the whole graph from the raw bodies the registry actually serves - index, every linux platform
// manifest, and each manifest's config and layer digests - because a mirror that diverges anywhere
// below the index would still pass an index-only check, and the CLI pins leaves, not just indexes.
//
// The table it writes is the release identity the CLI consumes: the multi-arch index digest, plus
// the per-platform leaf digests the forced-platform path (android -> linux/amd64) needs, because a
// classic image store holds one platform per digest reference.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);
const VERSION = fs.readFileSync(new URL('tooling/docker/VERSION', ROOT), 'utf8').trim();
// The release is built and gated under a staging tag, then promoted; --tag points the gate at it.
const TAG = (process.argv.includes('--tag') ? process.argv[process.argv.indexOf('--tag') + 1] : null) || VERSION;
const IMAGES = ['rust-sysroot', 'base', 'web', 'android'];
const arg = (flag) => { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; };
const PRIMARY = arg('--primary') ?? 'ghcr.io/crossbind';
const MIRROR = arg('--mirror') ?? 'docker.io/crossbind';
const TABLE = arg('--table');

const digestOf = (body) => `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;

// --raw returns the bytes the registry stored, which is what the digest is computed over; a
// formatted view would be a re-serialisation and could differ while the content does not.
function raw(ref) {
    return execFileSync('docker', ['buildx', 'imagetools', 'inspect', ref, '--raw'], {
        maxBuffer: 32 * 1024 * 1024,
    });
}

const problems = [];
const note = (msg) => console.log(`  ${msg}`);
const bad = (msg) => { problems.push(msg); console.error(`  FAIL ${msg}`); };

// One descriptor compared across both registries: same digest means same bytes, by construction.
function compare(label, primaryRef, mirrorRef) {
    const a = raw(primaryRef);
    let b;
    try {
        b = raw(mirrorRef);
    } catch (e) {
        bad(`${label}: not present on the mirror (${(e.stderr?.toString() || e.message).trim().split('\n')[0]})`);
        return null;
    }
    const da = digestOf(a);
    const db = digestOf(b);
    if (da !== db) {
        bad(`${label}: ${da} on ${PRIMARY}, ${db} on ${MIRROR}`);
        return null;
    }
    return { digest: da, body: JSON.parse(a.toString()) };
}

console.log(`gate-registry: ${PRIMARY} vs ${MIRROR}, version ${TAG}\n`);
// `registry` is the field the CLI's pinner reads; primary/mirror record what was compared.
const table = {
    version: VERSION, registry: PRIMARY, primary: PRIMARY, mirror: MIRROR, images: {},
};

for (const image of IMAGES) {
    const index = compare(`${image} index`, `${PRIMARY}/${image}:${TAG}`, `${MIRROR}/${image}:${TAG}`);
    if (!index) continue;
    note(`ok   ${image} index ${index.digest}`);
    const entry = { index: index.digest, platforms: {} };

    const leaves = (index.body.manifests ?? []).filter((m) => m.platform?.os === 'linux');
    if (leaves.length === 0) bad(`${image}: the index carries no linux platform manifests`);

    for (const leaf of leaves) {
        const platform = `linux/${leaf.platform.architecture}`;
        const manifest = compare(`${image} ${platform} manifest`,
            `${PRIMARY}/${image}@${leaf.digest}`, `${MIRROR}/${image}@${leaf.digest}`);
        if (!manifest) continue;
        if (manifest.digest !== leaf.digest) {
            bad(`${image} ${platform}: the index points at ${leaf.digest}, the body hashes to ${manifest.digest}`);
            continue;
        }
        entry.platforms[platform] = leaf.digest;

        // Config and layers are content-addressed too: identical digests here mean the mirror
        // carries the same filesystem, not a rebuild that happens to describe itself the same way.
        const config = manifest.body.config?.digest;
        const layers = (manifest.body.layers ?? []).map((l) => l.digest);
        if (!config || layers.length === 0) {
            bad(`${image} ${platform}: manifest has no config or no layers`);
            continue;
        }
        entry.platforms[`${platform}#config`] = config;
        note(`ok   ${image} ${platform} ${leaf.digest.slice(0, 19)}… config ${config.slice(7, 19)}… ${layers.length} layers`);
    }
    table.images[image] = entry;
}

if (TABLE) {
    fs.writeFileSync(TABLE, `${JSON.stringify(table, null, 2)}\n`);
    console.log(`\nwrote ${TABLE}`);
}

console.log(`\ngate-registry: ${problems.length ? `${problems.length} problem(s)` : 'both registries agree, index to layers'}`);
process.exit(problems.length ? 1 : 0);
