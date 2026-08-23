#!/usr/bin/env node
// Release gate (ADR rev 7.2 §3.2): every signed subject carries the signature it was meant to
// carry, discoverable through the NATIVE OCI 1.1 Referrers API - and, when a mirror exists, the
// same descriptor set on both registries.
//
//   node scripts/gate-referrers.js --tag v1.0.2-staging-42 --primary ghcr.io/crossbind --primary-only
//   node scripts/gate-referrers.js --tag v1.0.2-staging-42 --primary ghcr.io/crossbind --mirror docker.io/crossbind
//
// Two different claims, asserted separately because one does not imply the other:
//
//   1. The referrer EXISTS and is reachable through the native API. Discovery is forced onto it:
//      oras falls back to the legacy tag schema when a registry lacks referrers support, and that
//      fallback is exactly the failure this gate exists to catch - the mirror would look correct
//      while a policy speaking the native API finds nothing.
//   2. The referrer POINTS AT the digest we meant to sign. A signature that exists in the right
//      repository but names another subject would satisfy any count-based check and protect
//      nothing, so the referrer manifest is fetched and its .subject.digest compared exactly.
//
// The subject check is the reason this file is shared by the sign job and the mirror verification:
// signing asserts it on the primary before anything is copied, verification re-asserts it on both.

import { execFileSync } from 'node:child_process';

const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
const TAG = arg('--tag');
const PRIMARY = arg('--primary') ?? 'ghcr.io/crossbind';
const MIRROR = arg('--mirror') ?? 'docker.io/crossbind';
const PRIMARY_ONLY = process.argv.includes('--primary-only');
if (!TAG) { console.error('gate-referrers: --tag is required'); process.exit(1); }

const IMAGES = ['rust-sysroot', 'base', 'web', 'android'];
let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m, d = '') => { failed += 1; console.error(`  FAIL  ${m}`); if (d) console.error(`        ${d}`); };

const sh = (args) => execFileSync(args[0], args.slice(1), { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const shellOut = (cmd) => execFileSync('sh', ['-c', cmd], { encoding: 'utf8' }).trim();

// Computed over the raw body the registry serves, the same way the CLI and gate-registry compute it.
const indexDigest = (ref) => `sha256:${shellOut(`docker buildx imagetools inspect ${ref} --raw | sha256sum | cut -d' ' -f1`)}`;
const rawIndex = (ref) => JSON.parse(sh(['docker', 'buildx', 'imagetools', 'inspect', ref, '--raw']));

// Only the fields that must survive a copy, sorted so registry ordering cannot decide the result.
function discover(repo, digest) {
    const out = sh(['oras', 'discover', '--distribution-spec', 'v1.1-referrers-api',
        '--format', 'json', '--depth', '1', `${repo}@${digest}`]);
    const parsed = JSON.parse(out);
    const list = parsed.referrers ?? parsed.manifests ?? [];
    return list
        .map(({ digest: d, mediaType, artifactType, size }) => ({ digest: d, mediaType, artifactType, size }))
        .sort((a, b) => a.digest.localeCompare(b.digest));
}

// The claim a count cannot make: this referrer is about THIS subject.
function assertSubjects(label, repo, subject, descriptors) {
    for (const descriptor of descriptors) {
        let manifest;
        try {
            manifest = JSON.parse(sh(['oras', 'manifest', 'fetch', `${repo}@${descriptor.digest}`]));
        } catch (e) {
            bad(`${label}: cannot fetch referrer ${descriptor.digest.slice(0, 19)}…`, (e.stderr || e.message).toString().trim().split('\n').slice(-1)[0]);
            return false;
        }
        const named = manifest.subject?.digest;
        if (named !== subject) {
            bad(`${label}: referrer ${descriptor.digest.slice(0, 19)}… names subject ${named ?? '(none)'}`, `expected ${subject}`);
            return false;
        }
    }
    return true;
}

function check(label, image, subject) {
    let primary;
    try { primary = discover(`${PRIMARY}/${image}`, subject); } catch (e) {
        bad(`${label}: native discovery failed on the primary`, (e.stderr || e.message).toString().trim().split('\n').slice(-2).join(' '));
        return;
    }
    if (primary.length === 0) {
        bad(`${label}: the primary reports no referrers - nothing was signed, or it went to the legacy tag schema`);
        return;
    }
    if (!assertSubjects(label, `${PRIMARY}/${image}`, subject, primary)) return;
    ok(`${label}: ${primary.length} referrer(s) on the primary, each naming ${subject.slice(0, 19)}…`);

    if (PRIMARY_ONLY) return;

    let mirror;
    try { mirror = discover(`${MIRROR}/${image}`, subject); } catch (e) {
        bad(`${label}: native discovery failed on the mirror`, (e.stderr || e.message).toString().trim().split('\n').slice(-2).join(' '));
        return;
    }
    if (JSON.stringify(primary) !== JSON.stringify(mirror)) {
        bad(`${label}: referrer sets differ`, `primary ${JSON.stringify(primary)} | mirror ${JSON.stringify(mirror)}`);
        return;
    }
    if (!assertSubjects(label, `${MIRROR}/${image}`, subject, mirror)) return;
    ok(`${label}: the mirror carries the same ${mirror.length} referrer(s), same subject`);
}

console.log(`gate-referrers: ${PRIMARY}${PRIMARY_ONLY ? '' : ` vs ${MIRROR}`}, tag ${TAG}\n`);

for (const image of IMAGES) check(`${image} root`, image, indexDigest(`${PRIMARY}/${image}:${TAG}`));

// The android linux/amd64 leaf is a signed subject in its own right: the CLI pins it directly,
// because a classic image store holds one platform per digest reference.
const androidRoot = indexDigest(`${PRIMARY}/android:${TAG}`);
const leaf = (rawIndex(`${PRIMARY}/android@${androidRoot}`).manifests ?? [])
    .find((m) => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
if (!leaf) bad('the android index carries no linux/amd64 leaf');
else check('android linux/amd64 leaf', 'android', leaf.digest);

console.log(`\ngate-referrers: ${failed ? `${failed} problem(s)` : 'every signed subject is discoverable and names itself'}`);
process.exit(failed ? 1 : 0);
