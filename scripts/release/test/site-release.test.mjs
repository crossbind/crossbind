import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
    assertDeployableSnapshot,
    assertSnapshotMatchesConfig,
    badgeLabel,
    channelDistTag,
    COMPANION_CREATOR,
    COMPANION_PLUGIN,
    createFixtureClients,
    distTagSuffix,
    FIXTURE_ENVIRONMENT_VARIABLE,
    renderSnapshotModule,
    resolveSiteRelease,
    resolveSiteReleaseForBuild,
    satisfiesCaret,
    SITE_RESOLVE_ATTEMPTS,
} from '../resolve-site-release.mjs';

const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
const INTEGRITY = `sha512-${Buffer.alloc(64, 7).toString('base64')}`;
const DIGEST = `sha256:${'a'.repeat(64)}`;
const IMAGE = { index: DIGEST, platforms: { 'linux/amd64': DIGEST } };
const DIGEST_TABLE = `${JSON.stringify(
    {
        version: '1.0.3',
        registry: 'ghcr.io/crossbind',
        toolchains: { rust: '1.98.1' },
        images: { 'rust-sysroot': IMAGE, base: IMAGE, web: IMAGE, android: IMAGE },
    },
    null,
    4,
)}\n`;
const RELEASES = [
    ['2.0.0-beta.56', 'beta', 'beta', true, '2026-09-09T19:13:06.492Z'],
    ['2.0.0-beta.57', 'beta', 'beta', true, '2026-09-15T10:00:00.000Z'],
    ['2.0.0-rc.1', 'rc', 'next', true, '2026-09-20T10:00:00.000Z'],
    ['2.0.0', 'stable', 'latest', false, '2026-10-01T10:00:00.000Z'],
];
const silent = () => {};

function notesFor(version) {
    return [
        '---',
        'package: crossbind',
        `version: ${version}`,
        `title: Crossbind ${version}`,
        `summary: Fixture summary for ${version}.`,
        '---',
        '',
        '## Highlights',
        '',
        `- Fixture highlight for ${version}.`,
        '',
        '## Breaking changes',
        '',
        'None.',
        '',
    ].join('\n');
}

function manifestFor(version, { channel, distTag, prerelease, publishedAt, commit = COMMIT, integrity = INTEGRITY } = {}) {
    return {
        schemaVersion: 1,
        package: 'crossbind',
        version,
        channel,
        prerelease,
        publishedAt,
        npm: {
            distTag,
            url: `https://www.npmjs.com/package/crossbind/v/${version}`,
            tarball: `https://registry.npmjs.org/crossbind/-/crossbind-${version}.tgz`,
            integrity,
            provenance: {
                url: `https://registry.npmjs.org/-/npm/v1/attestations/crossbind@${version}`,
                predicateType: 'https://slsa.dev/provenance/v1',
            },
        },
        git: { tag: `crossbind@${version}`, commit },
        releaseNotes: { source: `releases/crossbind/${version}.md` },
        toolchainDigestTable: {
            source: 'core/crossbind/src/assets/toolchain-digests.json',
            sha256: crypto.createHash('sha256').update(DIGEST_TABLE).digest('hex'),
        },
    };
}

// One fixture that carries every trap at once: a stale npm latest, a GitHub "latest" release from
// another stream, a pre-manifest crossbind release, and exact manifest-bearing releases for two
// betas, an RC and a stable version. The beta dist-tag points at the older beta by default so a
// test can move it forward and watch the older page survive.
function fixture() {
    const releases = {
        'cpp.js@1.0.4': { tag_name: 'cpp.js@1.0.4', draft: false, prerelease: false, assets: [] },
        'crossbind@2.0.0-beta.55': { tag_name: 'crossbind@2.0.0-beta.55', draft: false, prerelease: true, assets: [] },
    };
    const tags = {};
    const files = { 'core/crossbind/src/assets/toolchain-digests.json': DIGEST_TABLE };
    const versions = {};
    const plugin = { distTags: { latest: '2.0.0-beta.50', beta: '2.0.0-beta.56', next: '2.0.0-rc.1' }, versions: {} };
    for (const [version, channel, distTag, prerelease, publishedAt] of RELEASES) {
        const tag = `crossbind@${version}`;
        versions[version] = { integrity: INTEGRITY, tarball: `https://registry.npmjs.org/crossbind/-/crossbind-${version}.tgz` };
        releases[tag] = {
            tag_name: tag,
            draft: false,
            prerelease,
            assets: [
                {
                    name: 'crossbind-release.json',
                    url: `asset://${tag}`,
                    content: manifestFor(version, { channel, distTag, prerelease, publishedAt }),
                },
            ],
        };
        tags[tag] = COMMIT;
        files[`releases/crossbind/${version}.md`] = notesFor(version);
        plugin.versions[version] = { dependencies: { crossbind: `^${version}` } };
    }
    return structuredClone({
        npm: {
            distTags: { latest: '0.0.1', beta: '2.0.0-beta.56', next: '2.0.0-rc.1' },
            versions,
            packages: {
                [COMPANION_PLUGIN]: plugin,
                [COMPANION_CREATOR]: { distTags: { latest: '2.0.0-beta.50', beta: '2.0.0-beta.57', next: '2.0.0-rc.1' } },
            },
        },
        github: {
            latestRelease: { tag_name: 'cpp.js@1.0.4', prerelease: false },
            releases,
            tags,
            files: { [COMMIT]: files },
        },
    });
}

function resolve(channel, data = fixture(), options = {}) {
    const clients = createFixtureClients(data);
    return resolveSiteRelease({ channel, ...clients, source: 'fixture', log: silent, sleep: async () => {}, ...options });
}

test('channels map to the documented npm dist-tags and install suffixes', () => {
    assert.equal(channelDistTag('beta'), 'beta');
    assert.equal(channelDistTag('rc'), 'next');
    assert.equal(channelDistTag('stable'), 'latest');
    assert.throws(() => channelDistTag('stable-candidate'), /Unknown site release channel/);
    assert.equal(distTagSuffix('beta'), '@beta');
    assert.equal(distTagSuffix('rc'), '@next');
    assert.equal(distTagSuffix('stable'), '');
    assert.equal(badgeLabel({ channel: 'beta', version: '2.0.0-beta.56' }), 'Beta · v2.0.0-beta.56');
    assert.equal(badgeLabel({ channel: 'rc', version: '2.0.0-rc.1' }), 'RC · v2.0.0-rc.1');
    assert.equal(badgeLabel({ channel: 'stable', version: '2.0.0' }), 'v2.0.0');
});

test('caret ranges follow npm prerelease semantics and other forms fail closed', () => {
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.0-beta.56'), true);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.0-beta.57'), true);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.0-rc.1'), true);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.0'), true);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.1.0'), true);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.0-beta.55'), false);
    assert.equal(satisfiesCaret('^2.0.0-beta.56', '2.0.1-beta.1'), false);
    assert.equal(satisfiesCaret('^2.0.0', '2.1.0-beta.1'), false);
    assert.equal(satisfiesCaret('^2.0.0', '3.0.0'), false);
    assert.equal(satisfiesCaret('^1.0.4', '2.0.0-beta.56'), false);
    assert.throws(() => satisfiesCaret('>=2.0.0', '2.0.0'), /Unsupported dependency range/);
    assert.throws(() => satisfiesCaret('workspace:^', '2.0.0'), /Unsupported dependency range/);
});

test('the beta channel resolves to the exact beta tag, commit and badge', async () => {
    const snapshot = await resolve('beta');
    assert.equal(snapshot.source, 'fixture');
    assert.equal(snapshot.version, '2.0.0-beta.56');
    assert.equal(snapshot.channel, 'beta');
    assert.equal(snapshot.prerelease, true);
    assert.equal(snapshot.distTag, 'beta');
    assert.equal(snapshot.distTagSuffix, '@beta');
    assert.equal(snapshot.badge, 'Beta · v2.0.0-beta.56');
    assert.equal(snapshot.gitTag, 'crossbind@2.0.0-beta.56');
    assert.equal(snapshot.gitCommit, COMMIT);
    assert.equal(snapshot.npmUrl, 'https://www.npmjs.com/package/crossbind/v/2.0.0-beta.56');
    assert.equal(snapshot.githubReleaseUrl, 'https://github.com/crossbind/crossbind/releases/tag/crossbind%402.0.0-beta.56');
    assert.equal(snapshot.publishedAt, '2026-09-09T19:13:06.492Z');
    assert.equal(snapshot.releaseNotes.title, 'Crossbind 2.0.0-beta.56');
    assert.equal(snapshot.releaseNotes.summary, 'Fixture summary for 2.0.0-beta.56.');
    assert.deepEqual(snapshot.releaseNotes.blocks[0], { type: 'h2', id: 'highlights', text: 'Highlights' });
    assert.equal(snapshot.toolchainDigestTable.version, '1.0.3');
    assert.equal(snapshot.toolchainDigestTable.images.web.index, DIGEST);
});

test('the rc channel resolves through next to the RC badge', async () => {
    const snapshot = await resolve('rc');
    assert.equal(snapshot.version, '2.0.0-rc.1');
    assert.equal(snapshot.distTag, 'next');
    assert.equal(snapshot.distTagSuffix, '@next');
    assert.equal(snapshot.badge, 'RC · v2.0.0-rc.1');
    assert.equal(snapshot.prerelease, true);
});

test('an explicitly selected stable channel resolves through latest without a suffix', async () => {
    const data = fixture();
    data.npm.distTags.latest = '2.0.0';
    data.npm.packages[COMPANION_PLUGIN].distTags.latest = '2.0.0';
    data.npm.packages[COMPANION_CREATOR].distTags.latest = '2.0.0';
    const snapshot = await resolve('stable', data);
    assert.equal(snapshot.version, '2.0.0');
    assert.equal(snapshot.distTag, 'latest');
    assert.equal(snapshot.distTagSuffix, '');
    assert.equal(snapshot.badge, 'v2.0.0');
    assert.equal(snapshot.prerelease, false);
});

test('a stale npm latest never influences the beta selection', async () => {
    const data = fixture();
    const clients = createFixtureClients(data);
    const requested = [];
    const registry = { ...clients.registry, distTag: async (tag) => (requested.push(tag), clients.registry.distTag(tag)) };
    const snapshot = await resolveSiteRelease({ channel: 'beta', registry, github: clients.github, source: 'fixture', log: silent });
    assert.equal(snapshot.version, '2.0.0-beta.56');
    assert.deepEqual(requested, ['beta']);
});

test('GitHub releases are selected by exact tag prefix, never through the generic latest release', async () => {
    const clients = createFixtureClients(fixture());
    const github = {
        ...clients.github,
        latestRelease: async () => {
            throw new Error('the generic latest-release endpoint must not be used');
        },
    };
    const snapshot = await resolveSiteRelease({ channel: 'beta', registry: clients.registry, github, source: 'fixture', log: silent });
    assert.equal(snapshot.gitTag, 'crossbind@2.0.0-beta.56');
    assert.ok(!snapshot.history.some((entry) => entry.gitTag.startsWith('cpp.js@')));
});

test('companion packages resolve through the same dist-tag and the plugin range must admit the version', async () => {
    const snapshot = await resolve('beta');
    assert.deepEqual(snapshot.companions, {
        [COMPANION_PLUGIN]: { version: '2.0.0-beta.56', crossbindRange: '^2.0.0-beta.56' },
        [COMPANION_CREATOR]: { version: '2.0.0-beta.57' },
    });

    const incompatible = fixture();
    incompatible.npm.packages[COMPANION_PLUGIN].versions['2.0.0-beta.56'].dependencies.crossbind = '^2.0.0-beta.57';
    await assert.rejects(resolve('beta', incompatible), /requires crossbind \^2\.0\.0-beta\.57, which does not admit 2\.0\.0-beta\.56/);

    const missingCreator = fixture();
    delete missingCreator.npm.packages[COMPANION_CREATOR].distTags.beta;
    await assert.rejects(resolve('beta', missingCreator), /create-crossbind is absent/);

    const missingPlugin = fixture();
    delete missingPlugin.npm.packages[COMPANION_PLUGIN].distTags.beta;
    await assert.rejects(resolve('beta', missingPlugin), /@crossbind\/plugin-vite is absent/);

    const noDependency = fixture();
    noDependency.npm.packages[COMPANION_PLUGIN].versions['2.0.0-beta.56'].dependencies = {};
    await assert.rejects(resolve('beta', noDependency), /declares no crossbind dependency/);
});

test('every manifest-bearing crossbind release keeps its own page, newest first', async () => {
    const snapshot = await resolve('beta');
    assert.deepEqual(
        snapshot.history.map((entry) => entry.version),
        ['2.0.0', '2.0.0-rc.1', '2.0.0-beta.57', '2.0.0-beta.56'],
    );
    const stable = snapshot.history[0];
    assert.equal(stable.badge, 'v2.0.0');
    assert.equal(stable.prerelease, false);
    assert.equal(stable.releaseNotes.blocks[1].items[0], 'Fixture highlight for 2.0.0.');
    assert.ok(!snapshot.history.some((entry) => entry.version === '2.0.0-beta.55'), 'a release without a manifest gets no page');
});

test('an older changelog page survives the channel moving to a newer release and keeps its own notes', async () => {
    const before = await resolve('beta');
    assert.equal(before.version, '2.0.0-beta.56');

    const data = fixture();
    data.npm.distTags.beta = '2.0.0-beta.57';
    data.npm.packages[COMPANION_PLUGIN].distTags.beta = '2.0.0-beta.57';
    const after = await resolve('beta', data);
    assert.equal(after.version, '2.0.0-beta.57');
    assert.equal(after.badge, 'Beta · v2.0.0-beta.57');
    const older = after.history.find((entry) => entry.version === '2.0.0-beta.56');
    assert.ok(older, '/changelog/2.0.0-beta.56/ still has a source');
    assert.deepEqual(older.releaseNotes, before.releaseNotes);
    assert.equal(older.releaseNotes.blocks[1].items[0], 'Fixture highlight for 2.0.0-beta.56.');
    assert.notEqual(older.releaseNotes.blocks[1].items[0], after.releaseNotes.blocks[1].items[0]);
});

test('an inconsistent historical release fails the whole build', async () => {
    const data = fixture();
    data.github.tags['crossbind@2.0.0-rc.1'] = OTHER_COMMIT;
    await assert.rejects(resolve('beta', data), new RegExp(`Git tag crossbind@2\\.0\\.0-rc\\.1 points to ${OTHER_COMMIT}`));
});

test('a dist-tag that points at a version of another class is rejected', async () => {
    const data = fixture();
    data.npm.distTags.beta = '2.0.0-rc.1';
    await assert.rejects(resolve('beta', data), /beta.*resolves to 2\.0\.0-rc\.1.*classified as rc/s);
});

test('an absent dist-tag is rejected instead of falling back', async () => {
    const data = fixture();
    delete data.npm.distTags.next;
    await assert.rejects(resolve('rc', data), /npm dist-tag next .* is absent/);
});

test('a missing GitHub Release for the exact tag is rejected', async () => {
    const data = fixture();
    delete data.github.releases['crossbind@2.0.0-beta.56'];
    await assert.rejects(resolve('beta', data), /No GitHub Release with a crossbind-release\.json asset exists for crossbind@2\.0\.0-beta\.56/);
});

test('a current release without its manifest asset is rejected', async () => {
    const data = fixture();
    data.github.releases['crossbind@2.0.0-beta.56'].assets = [];
    await assert.rejects(resolve('beta', data), /crossbind-release\.json/);
});

test('a manifest for a different version is rejected', async () => {
    const data = fixture();
    const release = data.github.releases['crossbind@2.0.0-beta.56'];
    release.assets[0].content = manifestFor('2.0.0-beta.55', {
        channel: 'beta',
        distTag: 'beta',
        prerelease: true,
        publishedAt: '2026-09-01T00:00:00Z',
    });
    await assert.rejects(resolve('beta', data), /manifest describes 2\.0\.0-beta\.55, expected 2\.0\.0-beta\.56/);
});

test('a manifest whose commit differs from the exact tag is rejected', async () => {
    const data = fixture();
    data.github.tags['crossbind@2.0.0-beta.56'] = OTHER_COMMIT;
    await assert.rejects(resolve('beta', data), new RegExp(`points to ${OTHER_COMMIT}, but the manifest records ${COMMIT}`));
});

test('an npm integrity that differs from the manifest is rejected', async () => {
    const data = fixture();
    data.npm.versions['2.0.0-beta.56'].integrity = `sha512-${Buffer.alloc(64, 9).toString('base64')}`;
    await assert.rejects(resolve('beta', data), /integrity/);
});

test('a digest table whose bytes do not hash to the manifest value is rejected', async () => {
    const data = fixture();
    data.github.files[COMMIT]['core/crossbind/src/assets/toolchain-digests.json'] = DIGEST_TABLE.replace('1.0.3', '1.0.4');
    await assert.rejects(resolve('beta', data), /digest-table hash mismatch/i);
});

test('release notes with another frontmatter version are rejected', async () => {
    const data = fixture();
    data.github.files[COMMIT]['releases/crossbind/2.0.0-beta.56.md'] = notesFor('2.0.0-beta.55');
    await assert.rejects(resolve('beta', data), /frontmatter version is "2\.0\.0-beta\.55", expected "2\.0\.0-beta\.56"/);
});

test('release notes missing at the release commit are rejected', async () => {
    const data = fixture();
    delete data.github.files[COMMIT]['releases/crossbind/2.0.0-beta.56.md'];
    await assert.rejects(resolve('beta', data), /releases\/crossbind\/2\.0\.0-beta\.56\.md .* not found at commit/);
});

test('a GitHub Release with the wrong prerelease classification is rejected', async () => {
    const data = fixture();
    data.github.releases['crossbind@2.0.0-beta.56'].prerelease = false;
    await assert.rejects(resolve('beta', data), /prerelease=false, expected true/);
});

test('a draft GitHub Release is ignored, so the current version cannot come from one', async () => {
    const data = fixture();
    data.github.releases['crossbind@2.0.0-beta.56'].draft = true;
    await assert.rejects(resolve('beta', data), /No GitHub Release with a crossbind-release\.json asset exists/);
});

test('an unknown channel is rejected before any lookup', async () => {
    const clients = createFixtureClients(fixture());
    await assert.rejects(resolveSiteRelease({ channel: 'stable-candidate', ...clients, log: silent }), /Unknown site release channel/);
});

test('transient client failures are retried a bounded number of times', async () => {
    const clients = createFixtureClients(fixture());
    let calls = 0;
    const flaky = {
        ...clients.registry,
        distTag: async (tag) => {
            calls += 1;
            if (calls === 1) throw new Error('ECONNRESET');
            return clients.registry.distTag(tag);
        },
    };
    const snapshot = await resolveSiteRelease({
        channel: 'beta',
        registry: flaky,
        github: clients.github,
        source: 'fixture',
        log: silent,
        sleep: async () => {},
    });
    assert.equal(snapshot.version, '2.0.0-beta.56');
    assert.equal(calls, 2);

    const dead = {
        ...clients.registry,
        distTag: async () => {
            throw new Error('ECONNRESET');
        },
    };
    await assert.rejects(
        resolveSiteRelease({ channel: 'beta', registry: dead, github: clients.github, source: 'fixture', log: silent, sleep: async () => {} }),
        new RegExp(`failed after ${SITE_RESOLVE_ATTEMPTS} attempts`),
    );
});

test('the build entry point uses live clients unless the fixture variable is set', async () => {
    const data = fixture();
    const live = await resolveSiteReleaseForBuild({
        channel: 'beta',
        env: {},
        createLiveClients: () => createFixtureClients(data),
        log: silent,
    });
    assert.equal(live.source, 'live');

    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-site-fixture-'));
    const file = path.join(temporary, 'fixture.json');
    fs.writeFileSync(file, JSON.stringify(data));
    const fromFixture = await resolveSiteReleaseForBuild({
        channel: 'beta',
        env: { [FIXTURE_ENVIRONMENT_VARIABLE]: file },
        createLiveClients: () => {
            throw new Error('live clients must not be created in fixture mode');
        },
        log: silent,
    });
    assert.equal(fromFixture.source, 'fixture');
    assert.equal(fromFixture.version, live.version);
});

test('only a live snapshot is deployable', async () => {
    const live = await resolve('beta', fixture(), { source: 'live' });
    assert.doesNotThrow(() => assertDeployableSnapshot(live));
    const fromFixture = await resolve('beta');
    assert.throws(() => assertDeployableSnapshot(fromFixture), /fixture .* cannot be deployed/);
    assert.throws(() => assertDeployableSnapshot({ ...live, gitCommit: 'abc' }), /commit/);
    assert.throws(() => assertDeployableSnapshot({ ...live, channel: 'nightly' }), /channel/);
});

test('a build only accepts the snapshot resolved for it, on the configured channel', async () => {
    const snapshot = await resolve('beta');
    const token = 'run-1';
    assert.doesNotThrow(() => assertSnapshotMatchesConfig(snapshot, { channel: 'beta', buildToken: token, environmentToken: token }));
    assert.throws(
        () => assertSnapshotMatchesConfig(snapshot, { channel: 'stable', buildToken: token, environmentToken: token }),
        /resolved for the beta channel, but release\.config\.js selects stable/,
    );
    assert.throws(() => assertSnapshotMatchesConfig(snapshot, { channel: 'beta', buildToken: token, environmentToken: undefined }), /is not set/);
    assert.throws(() => assertSnapshotMatchesConfig(snapshot, { channel: 'beta', buildToken: token, environmentToken: 'run-2' }), /another run/);
    assert.throws(() => assertSnapshotMatchesConfig(snapshot, { channel: 'beta', buildToken: null, environmentToken: token }), /another run/);
});

test('the generated module hands every consumer the identical snapshot and keeps the token apart', async () => {
    const snapshot = await resolve('beta');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-site-module-'));
    const file = path.join(temporary, 'release-snapshot.js');
    fs.writeFileSync(file, renderSnapshotModule(snapshot, { buildToken: 'run-1' }));
    const first = await import(pathToFileURL(file).href);
    const { default: second } = await import(`${pathToFileURL(file).href}?again`);
    assert.deepEqual(first.default, snapshot);
    assert.deepEqual(second, snapshot);
    assert.equal(first.BUILD_TOKEN, 'run-1');
    assert.ok(!('buildToken' in first.default));
    assert.equal(renderSnapshotModule(snapshot, { buildToken: 'x' }), renderSnapshotModule(structuredClone(snapshot), { buildToken: 'x' }));
});
