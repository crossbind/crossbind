import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BOOTSTRAP_TAG,
    BOOTSTRAP_VERSION,
    bootstrapCommands,
    isPublishedOn,
    placeholderManifest,
    selectPackages,
    viewCommand,
    waitUntilPublished,
} from '../bootstrap-npm-packages.mjs';

const candidate = (name) => ({
    name,
    version: '2.0.0-beta.62',
    manifest: { name, license: 'Zlib', repository: 'https://github.com/crossbind/crossbind.git' },
});

test('selects the workspace packages npm has never seen', () => {
    const candidates = [candidate('@crossbind/port-zlib-linux'), candidate('@crossbind/port-zlib-wasm')];
    const known = new Set(['@crossbind/port-zlib-wasm']);

    const selected = selectPackages(candidates, { requested: [], isPublished: (name) => known.has(name) });

    assert.deepEqual(
        selected.map((entry) => entry.name),
        ['@crossbind/port-zlib-linux'],
    );
});

test('takes named packages as they are, and refuses a name the workspace does not publish', () => {
    const candidates = [candidate('@crossbind/port-zlib-linux'), candidate('@crossbind/port-zlib-wasm')];
    const isPublished = () => true;

    assert.deepEqual(
        selectPackages(candidates, { requested: ['@crossbind/port-zlib-wasm'], isPublished }).map((entry) => entry.name),
        ['@crossbind/port-zlib-wasm'],
    );
    assert.throws(() => selectPackages(candidates, { requested: ['@crossbind/port-nope'], isPublished }), /@crossbind\/port-nope/);
});

test('the placeholder carries no code and sorts below every real release', () => {
    const manifest = placeholderManifest(candidate('@crossbind/port-zlib-linux'));

    assert.equal(manifest.version, BOOTSTRAP_VERSION);
    assert.match(BOOTSTRAP_VERSION, /^0\.0\.0-/);
    assert.equal(manifest.license, 'Zlib');
    assert.equal(manifest.repository, 'https://github.com/crossbind/crossbind.git');
    for (const field of ['main', 'exports', 'bin', 'files', 'scripts', 'dependencies']) assert.equal(manifest[field], undefined, field);
});

test('publishes under its own dist-tag, then trusts the release workflow for direct publish', () => {
    const [publish, trust, ...rest] = bootstrapCommands('@crossbind/port-zlib-linux', '/tmp/placeholder');

    assert.deepEqual(rest, []);
    assert.deepEqual(publish, ['publish', '/tmp/placeholder', '--access', 'public', '--tag', BOOTSTRAP_TAG, '--provenance=false']);
    assert.deepEqual(trust, [
        'trust',
        'github',
        '@crossbind/port-zlib-linux',
        '--repo',
        'crossbind/crossbind',
        '--file',
        'release-crossbind.yml',
        '--env',
        'npm-release',
        '--allow-publish',
        '--yes',
    ]);
});

test('reads npm view: found, never published, or an error it will not guess about', () => {
    assert.equal(isPublishedOn({ status: 0, stderr: '' }), true);
    assert.equal(isPublishedOn({ status: 1, stderr: 'npm error code E404\nnpm error 404 Not Found' }), false);
    assert.throws(() => isPublishedOn({ status: 1, stderr: 'npm error code ETIMEDOUT' }), /ETIMEDOUT/);
});

test('asks npm past its cache, which keeps an earlier 404 after the first publish', () => {
    assert.deepEqual(viewCommand('@crossbind/core-embind-napi'), ['view', '@crossbind/core-embind-napi', 'name', '--prefer-online']);
});

test('waits for a new package to show before trusting it, and gives up with the name', async () => {
    let checks = 0;
    await waitUntilPublished('@crossbind/port-zlib-linux', { isPublished: () => ++checks >= 3, pause: async () => {}, attempts: 5 });
    assert.equal(checks, 3);

    await assert.rejects(
        waitUntilPublished('@crossbind/port-zlib-linux', { isPublished: () => false, pause: async () => {}, attempts: 2 }),
        /@crossbind\/port-zlib-linux/,
    );
});
