#!/usr/bin/env node
// Fail closed unless every runnable platform manifest in the staged image family carries both a
// BuildKit SLSA provenance attestation and an SPDX SBOM. The attestation descriptors and manifests
// are part of the signed root index, so checking their subject binding is as important as checking
// that a predicate with the right name exists.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ATTESTATION_TYPE = 'attestation-manifest';
const REFERENCE_DIGEST = 'vnd.docker.reference.digest';
const REFERENCE_TYPE = 'vnd.docker.reference.type';
const PREDICATE_TYPE = 'in-toto.io/predicate-type';
const SPDX_PREDICATES = new Set(['https://spdx.dev/Document', 'https://spdx.dev/Document/v2.3']);

export const IMAGE_PLATFORMS = Object.freeze({
    'rust-sysroot': ['linux/amd64', 'linux/arm64'],
    base: ['linux/amd64', 'linux/arm64'],
    web: ['linux/amd64', 'linux/arm64'],
    android: ['linux/amd64'],
});

function platformOf(descriptor) {
    const { os, architecture } = descriptor.platform ?? {};
    return os && architecture ? `${os}/${architecture}` : null;
}

export function validateAttestationGraph({ image, index, attestationManifests, expectedPlatforms }) {
    const problems = [];
    const runnable = (index.manifests ?? []).filter((entry) => entry.platform?.os === 'linux');
    const actualPlatforms = runnable.map(platformOf).sort();
    const wantedPlatforms = [...expectedPlatforms].sort();
    if (JSON.stringify(actualPlatforms) !== JSON.stringify(wantedPlatforms)) {
        problems.push(`${image}: platforms are ${actualPlatforms.join(', ') || '(none)'}, expected ${wantedPlatforms.join(', ')}`);
    }

    const attestations = (index.manifests ?? []).filter((entry) => entry.annotations?.[REFERENCE_TYPE] === ATTESTATION_TYPE);

    for (const subject of runnable) {
        const descriptors = attestations.filter((entry) => entry.annotations?.[REFERENCE_DIGEST] === subject.digest);
        if (!descriptors.length) {
            problems.push(`${image} ${platformOf(subject)}: no attestation manifest refers to ${subject.digest}`);
            continue;
        }

        const predicates = new Set();
        for (const descriptor of descriptors) {
            const manifest = attestationManifests.get(descriptor.digest);
            if (!manifest) {
                problems.push(`${image} ${platformOf(subject)}: cannot read attestation manifest ${descriptor.digest}`);
                continue;
            }
            if (manifest.subject?.digest !== subject.digest) {
                problems.push(
                    `${image} ${platformOf(subject)}: attestation ${descriptor.digest} names ${manifest.subject?.digest ?? '(no subject)'}`,
                );
            }
            for (const layer of manifest.layers ?? []) {
                if (layer.mediaType === 'application/vnd.in-toto+json' && layer.annotations?.[PREDICATE_TYPE]) {
                    predicates.add(layer.annotations[PREDICATE_TYPE]);
                }
            }
        }
        if (![...predicates].some((predicate) => predicate.startsWith('https://slsa.dev/provenance/'))) {
            problems.push(`${image} ${platformOf(subject)}: SLSA provenance is missing`);
        }
        if (![...predicates].some((predicate) => SPDX_PREDICATES.has(predicate))) {
            problems.push(`${image} ${platformOf(subject)}: SPDX SBOM is missing`);
        }
    }
    return problems;
}

function argument(name) {
    const index = process.argv.indexOf(name);
    return index === -1 ? null : process.argv[index + 1];
}

function raw(reference) {
    return JSON.parse(
        execFileSync('docker', ['buildx', 'imagetools', 'inspect', reference, '--raw'], {
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        }),
    );
}

export function gatePublishedAttestations({ tag, registry = 'ghcr.io/crossbind', inspect = raw }) {
    const allProblems = [];
    for (const [image, expectedPlatforms] of Object.entries(IMAGE_PLATFORMS)) {
        const repository = `${registry}/${image}`;
        const index = inspect(`${repository}:${tag}`);
        const attestationManifests = new Map();
        for (const descriptor of index.manifests ?? []) {
            if (descriptor.annotations?.[REFERENCE_TYPE] === ATTESTATION_TYPE) {
                attestationManifests.set(descriptor.digest, inspect(`${repository}@${descriptor.digest}`));
            }
        }
        const problems = validateAttestationGraph({ image, index, attestationManifests, expectedPlatforms });
        allProblems.push(...problems);
        if (!problems.length) console.log(`PASS ${image}: provenance + SBOM for ${expectedPlatforms.join(', ')}`);
    }
    return allProblems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const tag = argument('--tag');
    const registry = argument('--registry') ?? 'ghcr.io/crossbind';
    if (!tag) {
        console.error('Usage: node scripts/gate-image-attestations.mjs --tag <staging-tag> [--registry ghcr.io/crossbind]');
        process.exit(1);
    }
    const problems = gatePublishedAttestations({ tag, registry });
    for (const problem of problems) console.error(`FAIL ${problem}`);
    console.log(`gate-image-attestations: ${problems.length ? `${problems.length} problem(s)` : 'all subjects are attested'}`);
    process.exit(problems.length ? 1 : 0);
}
