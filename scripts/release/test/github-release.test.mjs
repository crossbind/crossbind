import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureGitHubRelease, ensureGitTag, GitHubCliRelease } from '../github-release.mjs';

const TAG = 'crossbind@1.0.0-beta.41';
const COMMIT = '1234567890abcdef1234567890abcdef12345678';

test('a tag pointing to the wrong commit fails without moving it', async () => {
    let created = 0;
    const github = {
        tagCommit: async () => 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        createTag: async () => {
            created += 1;
        },
    };
    await assert.rejects(ensureGitTag({ github, tag: TAG, commit: COMMIT, apply: true }), /refusing to move/i);
    assert.equal(created, 0);
});

test('a tag already pointing to the release commit is reused', async () => {
    let created = 0;
    const github = {
        tagCommit: async () => COMMIT,
        createTag: async () => {
            created += 1;
        },
    };
    assert.equal(await ensureGitTag({ github, tag: TAG, commit: COMMIT, apply: true, log: () => {} }), 'reused');
    assert.equal(created, 0);
});

test('a matching GitHub rerun reuses the release and identical assets', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-release-test-'));
    const manifest = path.join(temporary, 'crossbind-release.json');
    fs.writeFileSync(manifest, '{"fixture":true}\n');
    let created = 0;
    let uploaded = 0;
    const release = {
        tag_name: TAG,
        name: 'Crossbind fixture',
        body: 'Fixture body\n',
        draft: false,
        prerelease: true,
        assets: [
            {
                name: 'crossbind-release.json',
                url: 'asset-api-url',
                browser_download_url: 'asset-browser-url',
            },
        ],
    };
    const github = {
        release: async () => release,
        createRelease: async () => {
            created += 1;
        },
        downloadAsset: async () => fs.readFileSync(manifest),
        uploadAsset: async () => {
            uploaded += 1;
        },
    };
    try {
        const result = await ensureGitHubRelease({
            github,
            tag: TAG,
            title: 'Crossbind fixture',
            body: 'Fixture body',
            bodyFile: 'unused.md',
            prerelease: true,
            assets: [{ name: 'crossbind-release.json', file: manifest }],
            apply: true,
            log: () => {},
        });
        assert.equal(result.assets['crossbind-release.json'], 'asset-browser-url');
        assert.equal(created, 0);
        assert.equal(uploaded, 0);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('a conflicting release asset is never overwritten', async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-release-test-'));
    const manifest = path.join(temporary, 'crossbind-release.json');
    fs.writeFileSync(manifest, 'expected');
    const release = {
        tag_name: TAG,
        name: 'Crossbind fixture',
        body: 'Fixture body',
        draft: false,
        prerelease: true,
        assets: [{ name: 'crossbind-release.json', url: 'asset-api-url' }],
    };
    const github = {
        release: async () => release,
        downloadAsset: async () => Buffer.from('conflict'),
    };
    try {
        await assert.rejects(
            ensureGitHubRelease({
                github,
                tag: TAG,
                title: 'Crossbind fixture',
                body: 'Fixture body',
                bodyFile: 'unused.md',
                prerelease: true,
                assets: [{ name: 'crossbind-release.json', file: manifest }],
                apply: true,
                log: () => {},
            }),
            /refusing to overwrite/i,
        );
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
});

test('tag lookup and creation call gh with the exact api arguments', async () => {
    const client = new GitHubCliRelease({ repository: 'crossbind/crossbind' });
    const calls = [];
    const responses = [{ object: { type: 'tag', sha: 'annotated-object' } }, { object: { type: 'commit', sha: COMMIT } }, {}];
    client.run = async (args, options) => {
        calls.push({ args, options });
        return { stdout: JSON.stringify(responses[calls.length - 1]) };
    };

    assert.equal(await client.tagCommit(TAG), COMMIT);
    await client.createTag(TAG, COMMIT);

    assert.deepEqual(calls[0].args, ['api', 'repos/crossbind/crossbind/git/ref/tags/crossbind%401.0.0-beta.41']);
    assert.equal(calls[0].options.allowMissing, true);
    assert.deepEqual(calls[1].args, ['api', 'repos/crossbind/crossbind/git/tags/annotated-object']);
    assert.deepEqual(calls[2].args, [
        'api',
        '--method',
        'POST',
        'repos/crossbind/crossbind/git/refs',
        '-f',
        `ref=refs/tags/${TAG}`,
        '-f',
        `sha=${COMMIT}`,
    ]);
});
