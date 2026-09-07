import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAttestationGraph } from '../../gate-image-attestations.mjs';

const SUBJECT = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ATTESTATION = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function graph(predicates = ['https://slsa.dev/provenance/v0.2', 'https://spdx.dev/Document']) {
    return {
        image: 'web',
        expectedPlatforms: ['linux/amd64'],
        index: {
            manifests: [
                { digest: SUBJECT, platform: { os: 'linux', architecture: 'amd64' } },
                {
                    digest: ATTESTATION,
                    platform: { os: 'unknown', architecture: 'unknown' },
                    annotations: {
                        'vnd.docker.reference.type': 'attestation-manifest',
                        'vnd.docker.reference.digest': SUBJECT,
                    },
                },
            ],
        },
        attestationManifests: new Map([
            [
                ATTESTATION,
                {
                    subject: { digest: SUBJECT },
                    layers: predicates.map((predicate) => ({
                        mediaType: 'application/vnd.in-toto+json',
                        annotations: { 'in-toto.io/predicate-type': predicate },
                    })),
                },
            ],
        ]),
    };
}

test('accepts subject-bound SLSA provenance and SPDX SBOM', () => {
    assert.deepEqual(validateAttestationGraph(graph()), []);
});

test('fails when an image platform has no SBOM', () => {
    assert.match(validateAttestationGraph(graph(['https://slsa.dev/provenance/v0.2'])).join('\n'), /SBOM is missing/);
});

test('fails when an image platform has no provenance', () => {
    assert.match(validateAttestationGraph(graph(['https://spdx.dev/Document'])).join('\n'), /provenance is missing/);
});

test('fails when an attestation names another image digest', () => {
    const fixture = graph();
    fixture.attestationManifests.get(ATTESTATION).subject.digest = `sha256:${'c'.repeat(64)}`;
    assert.match(validateAttestationGraph(fixture).join('\n'), /names sha256:c+/);
});
