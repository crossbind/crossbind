import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureGitHubRelease, ensureGitTag, ensureGitTags, GitHubCliRelease, GitRemoteTags } from '../github-release.mjs';

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

// What GitHub answers a read with around a write it acknowledged: the old answer until the given read after the write.
function lagging(before, after, shownFromRead) {
    let writes = 0;
    let reads = 0;
    return {
        writes: () => writes,
        write: async () => {
            writes += 1;
        },
        read: async () => {
            if (writes === 0) return before;
            reads += 1;
            return reads >= shownFromRead ? after : before;
        },
    };
}

const RELEASE = { tag_name: TAG, name: 'Crossbind fixture', body: 'Fixture body', draft: false, prerelease: true, assets: [] };
const RELEASE_OPTIONS = {
    tag: TAG,
    title: 'Crossbind fixture',
    body: 'Fixture body',
    bodyFile: 'unused.md',
    prerelease: true,
    apply: true,
    log: () => {},
};

test('a created tag GitHub shows only on a later read is waited for', async () => {
    const tag = lagging(null, COMMIT, 3);
    const waits = [];
    const sleep = async (duration) => waits.push(duration);
    const action = await ensureGitTag({
        github: { tagCommit: tag.read, createTag: tag.write },
        tag: TAG,
        commit: COMMIT,
        apply: true,
        log: () => {},
        sleep,
    });
    assert.equal(action, 'created');
    assert.equal(tag.writes(), 1);
    assert.deepEqual(waits, [1000, 2000]);
});

test('a created tag GitHub never shows fails once its reads are spent', async () => {
    const tag = lagging(null, COMMIT, Infinity);
    const waits = [];
    const sleep = async (duration) => waits.push(duration);
    await assert.rejects(
        ensureGitTag({ github: { tagCommit: tag.read, createTag: tag.write }, tag: TAG, commit: COMMIT, apply: true, log: () => {}, sleep }),
        /settled at \(absent\)/,
    );
    assert.deepEqual(waits, [1000, 2000, 4000, 8000, 16000]);
});

test('a created tag GitHub shows at another commit fails without waiting', async () => {
    const tag = lagging(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1);
    const waits = [];
    const sleep = async (duration) => waits.push(duration);
    await assert.rejects(
        ensureGitTag({ github: { tagCommit: tag.read, createTag: tag.write }, tag: TAG, commit: COMMIT, apply: true, log: () => {}, sleep }),
        /settled at a{40}/,
    );
    assert.deepEqual(waits, []);
});

test('a created release GitHub shows only on a later read is waited for', async () => {
    const shown = lagging(null, RELEASE, 2);
    const waits = [];
    const sleep = async (duration) => waits.push(duration);
    const result = await ensureGitHubRelease({ ...RELEASE_OPTIONS, github: { release: shown.read, createRelease: shown.write }, assets: [], sleep });
    assert.equal(result.release, RELEASE);
    assert.equal(shown.writes(), 1);
    assert.deepEqual(waits, [1000]);
});

test('an uploaded asset GitHub shows only on a later read is waited for', async () => {
    const asset = { name: 'crossbind-release.json', url: 'asset-api-url', browser_download_url: 'asset-browser-url' };
    const shown = lagging(RELEASE, { ...RELEASE, assets: [asset] }, 2);
    const waits = [];
    const sleep = async (duration) => waits.push(duration);
    const result = await ensureGitHubRelease({
        ...RELEASE_OPTIONS,
        github: { release: shown.read, uploadAsset: shown.write },
        assets: [{ name: asset.name, file: 'unused.json' }],
        sleep,
    });
    assert.equal(result.assets[asset.name], 'asset-browser-url');
    assert.equal(shown.writes(), 1);
    assert.deepEqual(waits, [1000]);
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

function remote(tags) {
    const pushes = [];
    return {
        pushes,
        list: async () => new Map(tags),
        push: async (names, commit) => {
            pushes.push(names);
            for (const name of names) tags.set(name, commit);
        },
    };
}

test('ensureGitTags pushes only the missing tags at the commit, 64 to a push, and reads them back', async () => {
    const names = Array.from({ length: 130 }, (_, index) => `@crossbind/port-${index}@1.0.0-beta.41`);
    const git = remote(new Map([[names[0], COMMIT]]));
    const outcome = await ensureGitTags({ git, tags: names, commit: COMMIT, apply: true, log: () => {} });
    assert.deepEqual(outcome, { reused: 1, created: 129 });
    assert.deepEqual(
        git.pushes.map((push) => push.length),
        [64, 64, 1],
    );
    assert.ok(!git.pushes.flat().includes(names[0]));
});

test('ensureGitTags refuses before pushing anything when a tag points to another commit', async () => {
    const git = remote(new Map([[TAG, 'a'.repeat(40)]]));
    await assert.rejects(ensureGitTags({ git, tags: ['crossbind@other', TAG], commit: COMMIT, apply: true, log: () => {} }), /refusing to move/i);
    assert.equal(git.pushes.length, 0);
});

test('ensureGitTags without apply creates nothing', async () => {
    const git = remote(new Map());
    assert.deepEqual(await ensureGitTags({ git, tags: [TAG], commit: COMMIT, log: () => {} }), { reused: 0, created: 0 });
    assert.equal(git.pushes.length, 0);
});

test('ensureGitTags reads pushed tags back until they show and fails on one that never settles', async () => {
    const tags = new Map();
    let reads = 0;
    const late = {
        list: async () => {
            reads += 1;
            return reads >= 3 ? new Map(tags) : new Map();
        },
        push: async (names, commit) => names.forEach((name) => tags.set(name, commit)),
    };
    assert.deepEqual(await ensureGitTags({ git: late, tags: [TAG], commit: COMMIT, apply: true, log: () => {}, sleep: async () => {} }), {
        reused: 0,
        created: 1,
    });

    const lost = { list: async () => new Map(), push: async () => {} };
    await assert.rejects(
        ensureGitTags({ git: lost, tags: [TAG], commit: COMMIT, apply: true, log: () => {}, sleep: async () => {} }),
        /settled at \(absent\)/,
    );
});

test('GitRemoteTags reads every tag of the remote at its commit, the peeled one for an annotated tag', async () => {
    const git = new GitRemoteTags({ cwd: os.tmpdir() });
    const annotated = 'b'.repeat(40);
    git.run = async (args) => {
        assert.deepEqual(args, ['ls-remote', '--tags', 'origin']);
        return [`${COMMIT}\trefs/tags/${TAG}`, `${annotated}\trefs/tags/v1`, `${'c'.repeat(40)}\trefs/tags/v1^{}`, ''].join('\n');
    };
    assert.deepEqual(
        await git.list(),
        new Map([
            [TAG, COMMIT],
            ['v1', 'c'.repeat(40)],
        ]),
    );
});

test('a tag git already holds but the API does not show yet is read back, not created a second time', async () => {
    let reads = 0;
    const github = {
        tagCommit: async () => {
            reads += 1;
            return reads >= 3 ? COMMIT : null;
        },
        createTag: async () => {
            throw new Error('gh api --method POST repos/crossbind/crossbind/git/refs failed: gh: Reference already exists (HTTP 422)');
        },
    };
    assert.equal(await ensureGitTag({ github, tag: TAG, commit: COMMIT, apply: true, log: () => {}, sleep: async () => {} }), 'created');

    const failing = { tagCommit: async () => null, createTag: async () => Promise.reject(new Error('HTTP 403')) };
    await assert.rejects(ensureGitTag({ github: failing, tag: TAG, commit: COMMIT, apply: true, log: () => {}, sleep: async () => {} }), /HTTP 403/);
});
