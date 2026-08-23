#!/usr/bin/env node
// Release gate (ADR rev 7.2 §6): promotion is the only step that MUTATES a published name, and its
// first real execution must not be against Docker Hub.
//
//   node scripts/gate-local-promotion.js
//
// Everything else in the release is additive - a new digest, a new signature, a new tag nobody has
// seen. Promotion is different: it points an existing, public name at a digest. The failure that
// matters is not "the tag was not created", it is "a tag that already meant something now means
// something else", and no amount of reading the script proves it cannot happen. So it is exercised
// here, on two disposable zot registries, against the four cases that decide whether a rerun after
// a half-finished promotion is safe:
//
//   1. the stable tag does not exist          -> created, at the staged digest
//   2. the same promotion runs again          -> accepted, nothing changes (idempotent)
//   3. the stable tag points somewhere else   -> refused, and the tag is left alone
//   4. after a successful promotion           -> the tag resolves to exactly the staged digest
//
// Case 3 is the one worth the whole file: a promotion that overwrites is indistinguishable from a
// successful one until someone pulls the old digest and gets different bytes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ARCH = os.arch() === 'arm64' ? 'arm64' : 'amd64';
const ZOT = `ghcr.io/project-zot/zot-linux-${ARCH}:v2.1.2`;
const ORAS_IMAGE = 'ghcr.io/oras-project/oras:v1.3.3';
const NET = 'crossbind-promogate';
const REG_A = 'crossbind-promogate-a';
const REG_B = 'crossbind-promogate-b';
const VERSION = '9.9.9';
const STAGING = 'v9.9.9-staging-local';
const IMAGE = 'probe';
// Two different seeds, so "a tag already points at other bytes" is a real digest mismatch.
// Seeded from ghcr, not Docker Hub: these gates pull on every run and anonymous Hub pulls are
// rate limited, which fails the gate for a reason that has nothing to do with promotion. Both
// images are already local - the gates run them as tools.
const SEED = 'ghcr.io/oras-project/oras:v1.3.3';
// Both seeds are image INDEXES: a registry refuses to change a tag's media type, so pointing an
// index tag at a single-arch manifest would fail on that rule instead of on the promotion
// logic under test.
const OTHER = 'ghcr.io/sigstore/cosign/cosign:v3.1.3';

const results = [];
const ok = (m) => { results.push(['ok', m]); console.log(`  ok    ${m}`); };
const fail = (m, d = '') => {
    results.push(['fail', m]);
    console.error(`  FAIL  ${m}`);
    if (d) d.trim().split('\n').slice(-4).forEach((l) => console.error(`        ${l}`));
};

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-promogate-'));
const ORAS_CMD = `docker run --rm --network ${NET} ${ORAS_IMAGE}`;
const oras = (args) => execFileSync('docker', ['run', '--rm', '--network', NET, ORAS_IMAGE, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

function cleanup() {
    spawnSync('docker', ['rm', '-f', REG_A, REG_B], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', NET], { stdio: 'ignore' });
}

const ready = (name) => {
    for (let i = 0; i < 60; i += 1) {
        if (spawnSync('docker', ['run', '--rm', '--network', NET, ORAS_IMAGE, 'repo', 'ls', '--plain-http', `${name}:5000`], { stdio: 'ignore' }).status === 0) return true;
        spawnSync('sh', ['-c', 'sleep 1']);
    }
    return false;
};

const digestOf = (ref) => JSON.parse(oras(['manifest', 'fetch', '--descriptor', '--plain-http', ref])).digest;

// Drives the real promotion script, with oras pointed at the containerised binary.
function promote() {
    return spawnSync('node', ['scripts/promote-tags.js',
        '--version', VERSION, '--staging', STAGING,
        '--primary', `${REG_A}:5000`, '--mirror', `${REG_B}:5000`,
        '--images', IMAGE, '--plain-http'], {
        encoding: 'utf8',
        env: { ...process.env, CROSSBIND_ORAS: ORAS_CMD },
    });
}

try {
    console.log(`gate-local-promotion: two disposable zot registries (linux/${ARCH})\n`);
    cleanup();
    execFileSync('docker', ['network', 'create', NET], { stdio: 'ignore' });
    for (const n of [REG_A, REG_B]) execFileSync('docker', ['run', '-d', '--name', n, '--network', NET, ZOT], { stdio: 'ignore' });
    if (!ready(REG_A) || !ready(REG_B)) throw new Error('the disposable registries did not come up');

    // Stage the same bytes on both registries, the way mirror leaves them.
    for (const reg of [REG_A, REG_B]) oras(['cp', '--to-plain-http', SEED, `${reg}:5000/${IMAGE}:${STAGING}`]);
    const staged = digestOf(`${REG_A}:5000/${IMAGE}:${STAGING}`);
    ok(`staged ${staged.slice(0, 19)}… on both registries under ${STAGING}`);

    // 1. The stable tag does not exist yet.
    let r = promote();
    if (r.status !== 0) fail('promotion into a clean registry', r.stdout + r.stderr);
    else {
        const a = digestOf(`${REG_A}:5000/${IMAGE}:${VERSION}`);
        const b = digestOf(`${REG_B}:5000/${IMAGE}:${VERSION}`);
        if (a === staged && b === staged) ok('a missing stable tag is created at the staged digest, on both registries');
        else fail('the created tag does not resolve to the staged digest', `primary ${a} mirror ${b} staged ${staged}`);
    }

    // 2. Idempotent: the same promotion again must be accepted and change nothing.
    r = promote();
    if (r.status !== 0) fail('rerunning an already-finished promotion', r.stdout + r.stderr);
    else if (digestOf(`${REG_A}:5000/${IMAGE}:${VERSION}`) !== staged) fail('a rerun moved the tag');
    else ok('a rerun is accepted and moves nothing (idempotent)');

    // 3. The tag already points at other bytes: promotion must refuse AND leave it alone.
    oras(['cp', '--to-plain-http', OTHER, `${REG_B}:5000/${IMAGE}:${VERSION}`]);
    const foreign = digestOf(`${REG_B}:5000/${IMAGE}:${VERSION}`);
    if (foreign === staged) fail('the second seed hashed to the staged digest - the case is untestable');
    else {
        r = promote();
        if (r.status === 0) fail('promotion accepted a stable tag that pointed at other bytes');
        else {
            const after = digestOf(`${REG_B}:5000/${IMAGE}:${VERSION}`);
            if (after !== foreign) fail('the refused promotion still moved the tag', `${foreign} -> ${after}`);
            else ok(`a stable tag pointing elsewhere is refused (exit ${r.status}) and left untouched`);
        }
    }
} catch (e) {
    fail('gate setup', (e.stderr?.toString() || e.message));
} finally {
    cleanup();
    fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter(([s]) => s === 'fail').length;
console.log(`\ngate-local-promotion: ${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
