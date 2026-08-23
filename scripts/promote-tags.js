#!/usr/bin/env node
// Release promotion (ADR rev 7.2 §6): give the ALREADY VERIFIED bytes their stable tag.
//
//   node scripts/promote-tags.js --version 1.0.2 --staging v1.0.2-staging-42 \
//     --primary ghcr.io/crossbind --mirror docker.io/crossbind [--dry-run]
//
// Nothing is rebuilt here and no manifest is reconstructed: `oras tag` points a new tag at a digest
// that already exists. What was gated is what ships, byte for byte.
//
// There is no transaction across two registries, so promotion is idempotent instead: a tag that is
// missing gets created, a tag that already resolves to the expected digest is accepted, and a tag
// that resolves to anything else fails the release. An existing stable tag is never overwritten -
// a rerun after a half-finished promotion has to be safe, and silently moving a published tag is
// the one outcome worse than failing.
//
// Docker Hub goes first and canonical GHCR last, so the release's commit point is the canonical
// registry: if promotion dies midway, GHCR has not yet claimed a release it cannot serve.

import { spawnSync } from 'node:child_process';

const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
const VERSION = arg('--version');
const STAGING = arg('--staging');
const PRIMARY = arg('--primary') ?? 'ghcr.io/crossbind';
const MIRROR = arg('--mirror') ?? 'docker.io/crossbind';
const DRY = process.argv.includes('--dry-run');
const IMAGES = (arg('--images') ?? 'rust-sysroot,base,web,android').split(',');
// Resolving and tagging both go through oras, so promotion needs exactly one tool and the same
// code path can be driven against disposable registries. CROSSBIND_ORAS lets the local gate point
// at a containerised oras without installing anything; CI leaves it as the binary on PATH.
const ORAS = (process.env.CROSSBIND_ORAS ?? 'oras').split(' ').filter(Boolean);
const PLAIN = process.argv.includes('--plain-http') ? ['--plain-http'] : [];

if (!VERSION || !STAGING) {
    console.error('promote-tags: --version and --staging are required');
    process.exit(1);
}

let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m, d = '') => { failed += 1; console.error(`  FAIL  ${m}`); if (d) console.error(`        ${d}`); };

// The digest the registry itself reports for a reference. Asking oras rather than hashing a body
// locally keeps promotion honest about what the registry will serve under that name.
function resolve(ref) {
    const r = spawnSync(ORAS[0], [...ORAS.slice(1), 'manifest', 'fetch', '--descriptor', ...PLAIN, ref], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    try { return JSON.parse(r.stdout).digest ?? null; } catch { return null; }
}

function promote(registry, image, expected) {
    const stable = `${registry}/${image}:${VERSION}`;
    const current = resolve(stable);

    if (current === expected) { ok(`${stable} already resolves to ${expected.slice(0, 19)}… (idempotent)`); return; }
    if (current !== null) {
        bad(`${stable} already resolves to ${current}`, `expected ${expected} - refusing to move a published tag`);
        return;
    }
    if (DRY) { ok(`${stable} would be created at ${expected.slice(0, 19)}… (dry run)`); return; }

    const r = spawnSync(ORAS[0], [...ORAS.slice(1), 'tag', ...PLAIN, `${registry}/${image}@${expected}`, VERSION], { encoding: 'utf8' });
    if (r.status !== 0) { bad(`tagging ${stable}`, (r.stderr || '').trim().split('\n').slice(-2).join(' ')); return; }
    ok(`${stable} created at ${expected.slice(0, 19)}…`);
}

console.log(`promote-tags: ${STAGING} -> ${VERSION}${DRY ? ' (dry run)' : ''}\n`);

// The staging digests are the release identity; everything below is compared against these.
const expected = {};
for (const image of IMAGES) {
    const d = resolve(`${PRIMARY}/${image}:${STAGING}`);
    if (!d) { bad(`${PRIMARY}/${image}:${STAGING} does not exist - nothing to promote`); continue; }
    expected[image] = d;
    ok(`staging ${image} ${d.slice(0, 19)}…`);
}
if (failed) { console.log('\npromote-tags: aborted before touching any stable tag'); process.exit(1); }

// The mirror must already carry the same bytes under the staging tag: promoting a tag onto a
// digest a registry does not have would create a tag that resolves to nothing.
for (const image of IMAGES) {
    const mirrored = resolve(`${MIRROR}/${image}:${STAGING}`);
    if (mirrored !== expected[image]) {
        bad(`${MIRROR}/${image}:${STAGING} is ${mirrored ?? '(absent)'}`, `expected ${expected[image]}`);
    }
}
if (failed) { console.log('\npromote-tags: aborted - the mirror does not carry the staged bytes'); process.exit(1); }

console.log('');
for (const registry of [MIRROR, PRIMARY]) {
    for (const image of IMAGES) promote(registry, image, expected[image]);
}

// A release is finished only when every stable tag resolves to the staged digest on BOTH sides.
console.log('');
if (!DRY) {
    for (const registry of [PRIMARY, MIRROR]) {
        for (const image of IMAGES) {
            const got = resolve(`${registry}/${image}:${VERSION}`);
            if (got !== expected[image]) bad(`${registry}/${image}:${VERSION} settled at ${got ?? '(absent)'}`, `expected ${expected[image]}`);
        }
    }
    if (!failed) ok('every stable tag resolves to its staged digest on both registries');
}

console.log(`\npromote-tags: ${failed ? `${failed} problem(s)` : 'release promoted'}`);
process.exit(failed ? 1 : 0);
