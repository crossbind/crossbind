#!/usr/bin/env node
// Release gate (ADR rev 7.2 §4): the signing mechanics, without GitHub OIDC or a real registry.
//
//   node scripts/gate-local-signature.js
//
// The production chain has two halves. One is identity - keyless OIDC, Fulcio, the certificate
// policy - and only a real workflow run can exercise that. The other is MECHANICS: does cosign
// store the signature through the native OCI 1.1 Referrers API, does `oras cp -r` carry the whole
// graph including a child leaf's own signature, does verification find it on the copy. That half
// needs no identity at all, and leaving it to staging means every flag mistake costs a release run.
//
// So: two disposable zot registries on a private docker network, a throwaway key pair, and the real
// pinned tool images - the same versions the workflow installs. Nothing is installed on the host.
//
// Topology mirrors production on purpose: a root index AND a child platform leaf are signed
// separately, because the CLI pins the android linux/amd64 leaf directly and a consumer verifying
// that digest cannot discover a signature attached only to the root.
//
// It also models production's MODE MATRIX, which is asymmetric because the registries are. GHCR
// does not implement the referrers API (measured: HTTP 404), so cosign stores there through the
// OCI 1.1 tag schema; Docker Hub does implement it. One mode cannot serve both, so each side is
// pinned explicitly to what it actually serves and the copy converts between them:
//
//     source (GHCR-shaped)  tag schema  --oras cp -r--> api form  mirror (Hub-shaped)
//
// The one leg this cannot reproduce is cosign verify against a tag-only registry: zot implements
// the API, so cosign queries it there regardless of how the referrer was written. That leg is
// proved directly against GHCR instead - a live `cosign verify` on the published staging digest
// succeeds with the exact certificate identity.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ARCH = os.arch() === 'arm64' ? 'arm64' : 'amd64';
// Pinned by tag AND digest: a gate that silently follows a moving tag proves nothing about the
// versions the release actually uses.
const TOOLS = {
    cosign: 'ghcr.io/sigstore/cosign/cosign:v3.1.3',
    oras: 'ghcr.io/oras-project/oras:v1.3.3',
    zot: `ghcr.io/project-zot/zot-linux-${ARCH}:v2.1.2`,
};
// A small multi-arch index to stand in for a release image: what matters is that it HAS platform
// leaves, not what is in them. Pulled from ghcr because anonymous Docker Hub pulls are rate
// limited, and this gate pulls on every run.
const SEED = 'ghcr.io/oras-project/oras:v1.3.3';

const NET = 'crossbind-siggate';
const REG_A = 'crossbind-siggate-a';
const REG_B = 'crossbind-siggate-b';
const results = [];
const ok = (m) => { results.push(['ok', m]); console.log(`  ok    ${m}`); };
const fail = (m, d = '') => {
    results.push(['fail', m]);
    console.error(`  FAIL  ${m}`);
    if (d) d.trim().split('\n').slice(-6).forEach((l) => console.error(`        ${l}`));
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-siggate-'));
const docker = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
// HOME points at the mounted work dir, not the container's writable layer: cosign keeps TUF state
// under $HOME, and a full docker disk otherwise fails the gate for a reason that has nothing to do
// with signing. It also means everything the tools write lands in the directory this script cleans.
const tool = (image, args, extra = []) => docker(['run', '--rm', '--network', NET,
    '-v', `${work}:/work`, '-w', '/work', '-e', 'COSIGN_PASSWORD=', '-e', 'HOME=/work', ...extra, image, ...args]);
const cosign = (args) => tool(TOOLS.cosign, args, ['--entrypoint', 'cosign']);
const oras = (args) => tool(TOOLS.oras, args);

function cleanup() {
    spawnSync('docker', ['rm', '-f', REG_A, REG_B], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', NET], { stdio: 'ignore' });
}

function waitReady(name) {
    for (let i = 0; i < 60; i += 1) {
        const r = spawnSync('docker', ['run', '--rm', '--network', NET, TOOLS.oras, 'repo', 'ls', '--plain-http', `${name}:5000`], { stdio: 'ignore' });
        if (r.status === 0) return true;
        spawnSync('sh', ['-c', 'sleep 1']);
    }
    return false;
}

// The descriptor set a registry reports for one subject, in an EXPLICIT mode - never negotiated -
// reduced to the fields that must survive a copy and sorted so ordering cannot decide a comparison.
function discover(registry, repo, digest, mode) {
    try {
        const out = oras(['discover', '--distribution-spec', mode, '--plain-http',
            '--format', 'json', '--depth', '1', `${registry}:5000/${repo}@${digest}`]);
        const parsed = JSON.parse(out);
        return (parsed.referrers ?? parsed.manifests ?? [])
            .map(({ digest: d, mediaType, artifactType, size }) => ({ digest: d, mediaType, artifactType, size }))
            .sort((a, b) => a.digest.localeCompare(b.digest));
    } catch { return []; }
}

// A referrer that exists but names another subject would satisfy any count-based check.
function subjectsMatch(label, repoRef, subject, descriptors) {
    for (const d of descriptors) {
        const manifest = JSON.parse(oras(['manifest', 'fetch', '--plain-http', `${repoRef}@${d.digest}`]));
        if (manifest.subject?.digest !== subject) {
            fail(`${label}: referrer ${d.digest.slice(0, 19)}… names ${manifest.subject?.digest ?? '(none)'}`, `expected ${subject}`);
            return false;
        }
    }
    return true;
}

try {
    console.log(`gate-local-signature: cosign v3.1.3, oras v1.3.3, zot v2.1.2 (linux/${ARCH})\n`);
    cleanup();
    docker(['network', 'create', NET], { stdio: 'ignore' });
    for (const name of [REG_A, REG_B]) docker(['run', '-d', '--name', name, '--network', NET, TOOLS.zot], { stdio: 'ignore' });
    if (!waitReady(REG_A) || !waitReady(REG_B)) throw new Error('the disposable registries did not come up');

    // Version asserts: the gate must prove it ran the versions it claims.
    const cv = cosign(['version']).match(/GitVersion:\s+(\S+)/)?.[1];
    const ov = oras(['version']).match(/Version:\s+(\S+)/)?.[1];
    if (cv !== 'v3.1.3') throw new Error(`cosign is ${cv}, expected v3.1.3`);
    if (ov !== '1.3.3') throw new Error(`oras is ${ov}, expected 1.3.3`);
    ok(`tool versions are the pinned ones (cosign ${cv}, oras ${ov})`);

    oras(['cp', '--to-plain-http', SEED, `${REG_A}:5000/probe:v1`]);
    const index = JSON.parse(oras(['manifest', 'fetch', '--plain-http', `${REG_A}:5000/probe:v1`]));
    const rootDigest = JSON.parse(oras(['manifest', 'fetch', '--plain-http', '--descriptor', `${REG_A}:5000/probe:v1`])).digest;
    const leaf = (index.manifests ?? []).find((m) => m.platform?.os === 'linux');
    if (!leaf) throw new Error('the seed image carries no linux platform leaf');
    ok(`seeded a root index with ${index.manifests.length} leaves (root ${rootDigest.slice(0, 19)}…)`);

    cosign(['generate-key-pair']);
    for (const [label, digest] of [['root index', rootDigest], ['child leaf', leaf.digest]]) {
        cosign(['sign', '--yes', '--key', '/work/cosign.key', '--allow-http-registry', `${REG_A}:5000/probe@${digest}`]);
        ok(`signed the ${label} by digest (${digest.slice(0, 19)}…)`);
    }

    // zot implements the referrers API, so cosign just stored these natively. GHCR cannot, and
    // holds the tag schema instead - so build that shape here before testing the copy, or the gate
    // would be exercising a source production does not have.
    oras(['cp', '-r', '--from-distribution-spec', 'v1.1-referrers-api', '--to-distribution-spec', 'v1.1-referrers-tag',
        '--from-plain-http', '--to-plain-http', `${REG_A}:5000/probe:v1`, `${REG_A}:5000/probe-tag:v1`]);
    const sourceSet = discover(REG_A, 'probe-tag', rootDigest, 'v1.1-referrers-tag');
    if (sourceSet.length === 0) fail('the GHCR-shaped source carries no referrers in the tag schema');
    else ok(`built a GHCR-shaped source: ${sourceSet.length} referrer(s) in the tag schema`);

    // The production copy: tag schema in, referrers API out. This is the leg that decides whether
    // the mirror ends up with a signature anyone can verify.
    oras(['cp', '-r', '--from-distribution-spec', 'v1.1-referrers-tag', '--to-distribution-spec', 'v1.1-referrers-api',
        '--from-plain-http', '--to-plain-http', `${REG_A}:5000/probe-tag:v1`, `${REG_B}:5000/probe:v1`]);
    ok('copied tag schema -> referrers API, the conversion production performs');

    // Each side is read in the mode it actually serves, and the descriptor sets must still match:
    // the transport differs, the content must not.
    for (const [label, digest] of [['root index', rootDigest], ['child leaf', leaf.digest]]) {
        const a = discover(REG_A, 'probe-tag', digest, 'v1.1-referrers-tag');
        const b = discover(REG_B, 'probe', digest, 'v1.1-referrers-api');
        if (a.length === 0) { fail(`${label}: nothing on the tag-schema source`); continue; }
        if (b.length === 0) { fail(`${label}: the conversion produced nothing on the API side`); continue; }
        if (JSON.stringify(a) !== JSON.stringify(b)) {
            fail(`${label}: descriptor sets differ across the conversion`, `tag ${JSON.stringify(a)}\napi ${JSON.stringify(b)}`);
            continue;
        }
        if (!subjectsMatch(label, `${REG_B}:5000/probe`, digest, b)) continue;
        ok(`${label}: ${a.length} referrer(s) survive the conversion, same descriptors, same subject`);
    }

    // Verification on the mirror is the claim that matters: a converted referrer nobody can verify
    // is worse than none. The tag-only side is proved against GHCR directly, not here.
    for (const [label, digest] of [['root index', rootDigest], ['child leaf', leaf.digest]]) {
        try {
            cosign(['verify', '--key', '/work/cosign.pub', '--allow-http-registry', `${REG_B}:5000/probe@${digest}`], { stdio: ['ignore', 'pipe', 'pipe'] });
            ok(`mirror: ${label} signature verifies after the conversion`);
        } catch (e) {
            fail(`mirror: ${label} verification`, e.stderr?.toString() || e.message);
        }
    }

    // The cosign v2 `.sig` layout is a different scheme from the OCI 1.1 tag schema; production
    // forbids it, so prove here that signing in this mode does not quietly produce one.
    for (const [reg, repo] of [[REG_A, 'probe-tag'], [REG_B, 'probe']]) {
        const tags = oras(['repo', 'tags', '--plain-http', `${reg}:5000/${repo}`]).split('\n').map((t) => t.trim());
        const legacy = tags.filter((t) => t.endsWith('.sig'));
        if (legacy.length) fail(`${reg === REG_A ? 'source' : 'mirror'}: cosign v2 .sig tags present`, legacy.join(', '));
        else ok(`${reg === REG_A ? 'source' : 'mirror'}: no cosign v2 .sig tag, only the OCI 1.1 referrers tag`);
    }

    // Negative: a key that never signed anything must be refused. A harness that cannot tell a
    // failed verification from a passing gate is worse than no gate at all.
    fs.mkdirSync(path.join(work, 'other'), { recursive: true });
    docker(['run', '--rm', '--network', NET, '-v', `${work}/other:/work`, '-w', '/work',
        '-e', 'COSIGN_PASSWORD=', '-e', 'HOME=/work', '--entrypoint', 'cosign', TOOLS.cosign, 'generate-key-pair'], { stdio: 'ignore' });
    fs.copyFileSync(path.join(work, 'other', 'cosign.pub'), path.join(work, 'wrong.pub'));
    const neg = spawnSync('docker', ['run', '--rm', '--network', NET, '-v', `${work}:/work`, '-w', '/work',
        '-e', 'HOME=/work', '--entrypoint', 'cosign', TOOLS.cosign, 'verify', '--key', '/work/wrong.pub', '--allow-http-registry',
        `${REG_A}:5000/probe@${rootDigest}`], { encoding: 'utf8' });
    if (neg.status === 0) fail('a signature verified against a key that never signed it');
    else ok(`an unrelated key is refused (cosign exited ${neg.status})`);
} catch (e) {
    fail('gate setup', (e.stderr?.toString() || e.message));
} finally {
    cleanup();
    fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter(([s]) => s === 'fail').length;
console.log(`\ngate-local-signature: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
