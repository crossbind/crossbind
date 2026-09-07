import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReleasePlan, createReleaseManifest, loadReleaseNotes, releasePolicy, validateReleaseManifest } from '../release-lib.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(TEST_DIRECTORY, 'fixtures', 'repository');
const REPOSITORY_ROOT = path.resolve(TEST_DIRECTORY, '..', '..', '..');
const SCHEMA = path.join(REPOSITORY_ROOT, 'releases', 'crossbind', 'manifest.schema.json');
const COMMIT = '1234567890abcdef1234567890abcdef12345678';
const NPM_METADATA = {
    integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}`,
    tarball: 'https://registry.npmjs.org/crossbind/-/crossbind-1.0.0-beta.41.tgz',
    provenance: {
        url: 'https://registry.npmjs.org/-/npm/v1/attestations/crossbind@1.0.0-beta.41',
        predicateType: 'https://slsa.dev/provenance/v1',
    },
};

test('1.0.0-beta.41 selects beta and a GitHub prerelease', () => {
    assert.deepEqual(releasePolicy('1.0.0-beta.41'), {
        version: '1.0.0-beta.41',
        channel: 'beta',
        npmDistTag: 'beta',
        prerelease: true,
        githubRelease: 'prerelease',
        promotionRequired: false,
        gitTag: 'crossbind@1.0.0-beta.41',
    });
});

test('1.0.0-rc.1 selects next and a GitHub prerelease', () => {
    const policy = releasePolicy('1.0.0-rc.1');
    assert.equal(policy.channel, 'rc');
    assert.equal(policy.npmDistTag, 'next');
    assert.equal(policy.prerelease, true);
    assert.equal(policy.githubRelease, 'prerelease');
});

test('1.0.0 selects latest and a normal GitHub release', () => {
    const policy = releasePolicy('1.0.0');
    assert.equal(policy.channel, 'stable');
    assert.equal(policy.npmDistTag, 'latest');
    assert.equal(policy.prerelease, false);
    assert.equal(policy.githubRelease, 'release');
    assert.equal(policy.promotionRequired, false);
});

test('a stable manifest validates with latest as its publish-time dist-tag', () => {
    const version = '1.0.0';
    const manifest = createReleaseManifest({
        version,
        publishedAt: '2026-09-03T12:00:00Z',
        gitCommit: COMMIT,
        digestSha256: '1'.repeat(64),
        npmMetadata: {
            integrity: NPM_METADATA.integrity,
            tarball: `https://registry.npmjs.org/crossbind/-/crossbind-${version}.tgz`,
            provenance: {
                url: `https://registry.npmjs.org/-/npm/v1/attestations/crossbind@${version}`,
                predicateType: NPM_METADATA.provenance.predicateType,
            },
        },
    });
    assert.doesNotThrow(() => validateReleaseManifest(manifest, { schemaSource: SCHEMA, verifySources: false }));
    assert.equal(manifest.npm.distTag, 'latest');
});

test('an unknown prerelease identifier fails actionably', () => {
    assert.throws(() => releasePolicy('1.0.0-alpha.1'), /Use -beta\.<number>, -rc\.<number>/);
});

test('the package repository must match the npm Trusted Publisher repository', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-trusted-publisher-test-'));
    fs.cpSync(FIXTURE_ROOT, temporary, { recursive: true });
    const packagePath = path.join(temporary, 'core', 'crossbind', 'package.json');
    const original = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    fs.writeFileSync(packagePath, `${JSON.stringify({ ...original, repository: 'https://github.com/example/fork.git' }, null, 2)}\n`);
    try {
        assert.throws(() => buildReleasePlan({ root: temporary, gitCommit: COMMIT }), /Trusted Publishing/);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('missing release notes fail', () => {
    assert.throws(() => loadReleaseNotes(FIXTURE_ROOT, '1.0.0-beta.42'), /Missing release notes/);
});

test('release-note and package version mismatch fails', () => {
    assert.throws(
        () => loadReleaseNotes(FIXTURE_ROOT, '1.0.0-beta.42', 'releases/crossbind/1.0.0-beta.41.md'),
        /frontmatter version is "1\.0\.0-beta\.41", expected "1\.0\.0-beta\.42"/,
    );
});

test('digest-table hash mismatch fails manifest validation', () => {
    const plan = buildReleasePlan({
        root: FIXTURE_ROOT,
        gitCommit: COMMIT,
        publishedAt: '2026-09-03T12:00:00Z',
        npmMetadata: NPM_METADATA,
        schemaSource: SCHEMA,
    });
    plan.manifest.toolchainDigestTable.sha256 = '0'.repeat(64);
    assert.throws(() => validateReleaseManifest(plan.manifest, { root: FIXTURE_ROOT, schemaSource: SCHEMA }), /digest-table hash mismatch/i);
});

test('a valid manifest derives all identities from canonical sources', () => {
    const plan = buildReleasePlan({
        root: FIXTURE_ROOT,
        gitCommit: COMMIT,
        publishedAt: '2026-09-03T12:00:00Z',
        npmMetadata: NPM_METADATA,
        schemaSource: SCHEMA,
    });
    assert.doesNotThrow(() =>
        validateReleaseManifest(plan.manifest, {
            root: FIXTURE_ROOT,
            schemaSource: SCHEMA,
        }),
    );
    assert.equal(plan.manifest.releaseNotes.source, 'releases/crossbind/1.0.0-beta.41.md');
    assert.equal(plan.manifest.npm.integrity, NPM_METADATA.integrity);
    assert.equal(plan.manifest.npm.tarball, NPM_METADATA.tarball);
    assert.equal(plan.manifest.npm.provenance.url, NPM_METADATA.provenance.url);
    assert.match(plan.manifest.toolchainDigestTable.sha256, /^[0-9a-f]{64}$/);
});
