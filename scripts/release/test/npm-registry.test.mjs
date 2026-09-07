import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ensurePackagePublished,
    expectedAttestationUrl,
    expectedRegistryTarball,
    PROVENANCE_PREDICATE,
    trustedPublishingEnvironment,
    verifyProvenanceAttestation,
    waitForRegistry,
} from '../npm-registry.mjs';

test('npm attestation URLs encode every package-name path separator', () => {
    assert.equal(
        expectedAttestationUrl('1.2.3', '@crossbind/internal/example'),
        'https://registry.npmjs.org/-/npm/v1/attestations/@crossbind%2finternal%2fexample@1.2.3',
    );
});

const EXPECTED = '1.0.0-beta.41';
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const INTEGRITY_BYTES = Buffer.alloc(64, 1);
const INTEGRITY = `sha512-${INTEGRITY_BYTES.toString('base64')}`;
const TARBALL = expectedRegistryTarball(EXPECTED);
const SUMMARY = {
    url: expectedAttestationUrl(EXPECTED),
    provenance: { predicateType: PROVENANCE_PREDICATE },
};

function provenanceBundle({ commit = COMMIT, integrityBytes = INTEGRITY_BYTES } = {}) {
    const statement = {
        _type: 'https://in-toto.io/Statement/v1',
        subject: [{ name: `pkg:npm/crossbind@${EXPECTED}`, digest: { sha512: integrityBytes.toString('hex') } }],
        predicateType: PROVENANCE_PREDICATE,
        predicate: {
            buildDefinition: {
                externalParameters: {
                    workflow: {
                        repository: 'https://github.com/crossbind/crossbind',
                        path: '.github/workflows/release-crossbind.yml',
                    },
                },
                resolvedDependencies: [{ digest: { gitCommit: commit } }],
            },
        },
    };
    return {
        attestations: [
            {
                predicateType: PROVENANCE_PREDICATE,
                bundle: {
                    verificationMaterial: { tlogEntries: [{}] },
                    dsseEnvelope: {
                        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
                        signatures: [{ sig: 'fixture' }],
                    },
                },
            },
        ],
    };
}

function registryMetadata(overrides = {}) {
    return {
        version: async () => EXPECTED,
        distTag: async () => EXPECTED,
        publishedAt: async () => '2026-09-03T12:00:00Z',
        integrity: async () => INTEGRITY,
        tarball: async () => TARBALL,
        attestations: async () => SUMMARY,
        attestationBundle: async () => provenanceBundle(),
        ...overrides,
    };
}

test('registry polling retries while the channel still returns the previous beta', async () => {
    const tags = ['1.0.0-beta.40', EXPECTED];
    let attempts = 0;
    const registry = registryMetadata({ distTag: async () => tags[attempts++] });
    const messages = [];
    const result = await waitForRegistry({
        registry,
        expectedVersion: EXPECTED,
        expectedDistTag: 'beta',
        expectedGitCommit: COMMIT,
        maxAttempts: 3,
        maxDurationMs: 1000,
        initialBackoffMs: 1,
        sleep: async () => {},
        log: (message) => messages.push(message),
    });
    assert.equal(result.attempts, 2);
    assert.match(messages[0], /beta=1\.0\.0-beta\.40/);
});

test('registry polling succeeds only when exact version, channel, artifact and provenance match', async () => {
    const result = await waitForRegistry({
        registry: registryMetadata(),
        expectedVersion: EXPECTED,
        expectedDistTag: 'beta',
        expectedGitCommit: COMMIT,
        log: () => {},
    });
    assert.equal(result.version, EXPECTED);
    assert.equal(result.publishedAt, '2026-09-03T12:00:00Z');
    assert.equal(result.tarball, TARBALL);
    assert.deepEqual(result.provenance, { url: SUMMARY.url, predicateType: PROVENANCE_PREDICATE });
});

test('registry polling waits for provenance propagation', async () => {
    let attempts = 0;
    const registry = registryMetadata({ attestations: async () => (attempts++ === 0 ? null : SUMMARY) });
    const result = await waitForRegistry({
        registry,
        expectedVersion: EXPECTED,
        expectedDistTag: 'beta',
        expectedGitCommit: COMMIT,
        maxAttempts: 2,
        maxDurationMs: 1000,
        initialBackoffMs: 1,
        sleep: async () => {},
        log: () => {},
    });
    assert.equal(result.attempts, 2);
});

test('registry polling retries a temporarily unavailable provenance bundle', async () => {
    let attempts = 0;
    const registry = registryMetadata({
        attestationBundle: async () => {
            if (attempts++ === 0) throw new Error('HTTP 503');
            return provenanceBundle();
        },
    });
    const result = await waitForRegistry({
        registry,
        expectedVersion: EXPECTED,
        expectedDistTag: 'beta',
        expectedGitCommit: COMMIT,
        maxAttempts: 2,
        maxDurationMs: 1000,
        initialBackoffMs: 1,
        sleep: async () => {},
        log: () => {},
    });
    assert.equal(result.attempts, 2);
});

test('provenance from a different release commit fails', async () => {
    const registry = registryMetadata({
        attestationBundle: async () => provenanceBundle({ commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    });
    await assert.rejects(
        waitForRegistry({
            registry,
            expectedVersion: EXPECTED,
            expectedDistTag: 'beta',
            expectedGitCommit: COMMIT,
            log: () => {},
        }),
        /does not resolve to release commit/,
    );
});

test('matching npm rerun is idempotent and never republishes', async () => {
    let published = 0;
    const registry = registryMetadata({
        publish: async () => {
            published += 1;
        },
    });
    const result = await ensurePackagePublished({
        registry,
        version: EXPECTED,
        distTag: 'beta',
        integrity: INTEGRITY,
        tarball: 'unused.tgz',
        gitCommit: COMMIT,
        apply: true,
        log: () => {},
    });
    assert.equal(result.action, 'reused');
    assert.equal(published, 0);
});

test('matching npm bytes with a conflicting dist-tag fail without attempting a repair', async () => {
    let published = 0;
    const registry = registryMetadata({
        distTag: async () => '1.0.0-beta.40',
        publish: async () => {
            published += 1;
        },
    });
    await assert.rejects(
        ensurePackagePublished({
            registry,
            version: EXPECTED,
            distTag: 'beta',
            integrity: INTEGRITY,
            tarball: 'unused.tgz',
            gitCommit: COMMIT,
            apply: true,
            log: () => {},
        }),
        /Trusted Publishing cannot mutate dist-tags/,
    );
    assert.equal(published, 0);
});

test('trusted publishing accepts only GitHub OIDC and refuses npm credentials', () => {
    const oidc = {
        GITHUB_ACTIONS: 'true',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'ephemeral-github-token',
    };
    assert.deepEqual(trustedPublishingEnvironment(oidc), oidc);
    assert.throws(() => trustedPublishingEnvironment({ ...oidc, NPM_TOKEN: 'long-lived-secret' }), /refuses long-lived npm credentials/);
    assert.throws(
        () => trustedPublishingEnvironment({ ...oidc, 'npm_config_//registry.npmjs.org/:_authToken': 'long-lived-secret' }),
        /refuses long-lived npm credentials/,
    );
    assert.throws(() => trustedPublishingEnvironment({}), /requires GitHub Actions OIDC Trusted Publishing/);
});

test('an existing npm version with conflicting integrity fails', async () => {
    const registry = {
        version: async () => EXPECTED,
        integrity: async () => 'sha512-other',
    };
    await assert.rejects(
        ensurePackagePublished({ registry, version: EXPECTED, distTag: 'beta', integrity: INTEGRITY, apply: true }),
        /Refusing to overwrite conflicting package data/,
    );
});

test('scoped package provenance uses the encoded npm package URL subject', () => {
    const packageName = '@crossbind/plugin-vite';
    const version = '2.0.0-beta.54';
    const statement = {
        predicateType: PROVENANCE_PREDICATE,
        subject: [{ name: `pkg:npm/%40crossbind/plugin-vite@${version}`, digest: { sha512: INTEGRITY_BYTES.toString('hex') } }],
        predicate: {
            buildDefinition: {
                externalParameters: {
                    workflow: {
                        repository: 'https://github.com/crossbind/crossbind',
                        path: '.github/workflows/release-crossbind.yml',
                    },
                },
                resolvedDependencies: [{ digest: { gitCommit: COMMIT } }],
            },
        },
    };
    const response = {
        attestations: [
            {
                predicateType: PROVENANCE_PREDICATE,
                bundle: {
                    verificationMaterial: { tlogEntries: [{}] },
                    dsseEnvelope: {
                        payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
                        signatures: [{ sig: 'fixture' }],
                    },
                },
            },
        ],
    };
    assert.deepEqual(
        verifyProvenanceAttestation({
            summary: {
                url: expectedAttestationUrl(version, packageName),
                provenance: { predicateType: PROVENANCE_PREDICATE },
            },
            response,
            version,
            integrity: INTEGRITY,
            gitCommit: COMMIT,
            packageName,
        }),
        { url: expectedAttestationUrl(version, packageName), predicateType: PROVENANCE_PREDICATE },
    );
    assert.equal(expectedRegistryTarball(version, packageName), `https://registry.npmjs.org/@crossbind/plugin-vite/-/plugin-vite-${version}.tgz`);
});
