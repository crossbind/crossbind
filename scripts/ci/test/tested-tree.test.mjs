import assert from 'node:assert/strict';
import test from 'node:test';
import { treeTestedInPullRequest, usesCompilerCache } from '../tested-tree.mjs';

const REPOSITORY = 'crossbind/crossbind';
const MAIN = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);

function github({
    pulls,
    trees = { [MAIN]: TREE, [HEAD]: TREE },
    successfulRuns = 1,
    files = ['core/crossbind/src/utils/logger.js', 'docs/api/overrides.md'],
}) {
    const asked = [];
    const api = async (endpoint) => {
        asked.push(endpoint);
        if (endpoint === `repos/${REPOSITORY}/commits/${MAIN}/pulls`) return pulls;
        const commit = /^repos\/crossbind\/crossbind\/git\/commits\/([0-9a-f]{40})$/.exec(endpoint);
        if (commit) return { tree: { sha: trees[commit[1]] } };
        if (endpoint === `repos/${REPOSITORY}/actions/workflows/build-linux.yml/runs?event=pull_request&head_sha=${HEAD}&status=success&per_page=1`) {
            return { total_count: successfulRuns, workflow_runs: successfulRuns ? [{ html_url: 'https://github.com/run/7' }] : [] };
        }
        const page = /^repos\/crossbind\/crossbind\/pulls\/42\/files\?per_page=100&page=(\d+)$/.exec(endpoint);
        if (page) return page[1] === '1' ? files.map((filename) => ({ filename })) : [];
        throw new Error(`unexpected request ${endpoint}`);
    };
    return { api, asked };
}

const merged = {
    number: 42,
    merged_at: '2026-11-13T14:56:00Z',
    merge_commit_sha: MAIN,
    user: { login: 'maintainer' },
    head: { sha: HEAD, repo: { full_name: REPOSITORY } },
};
const check = (api, compilerCache = false) =>
    treeTestedInPullRequest({ api, repository: REPOSITORY, sha: MAIN, workflow: 'build-linux.yml', compilerCache });

test('a push whose tree passed the workflow in the merged pull request counts as tested', async () => {
    const { api } = github({ pulls: [merged] });
    const result = await check(api);
    assert.equal(result.tested, true);
    assert.match(result.reason, /#42/);
    assert.match(result.reason, /run\/7/);
});

test('a push no pull request was merged as runs in full', async () => {
    const { api, asked } = github({ pulls: [] });
    assert.equal((await check(api)).tested, false);
    assert.equal(asked.length, 1);
});

test('a commit inside a rebased pull request, not its last one, runs in full', async () => {
    const { api } = github({ pulls: [{ ...merged, merge_commit_sha: 'd'.repeat(40) }] });
    assert.equal((await check(api)).tested, false);
});

test('an open pull request that holds the commit does not count', async () => {
    const { api } = github({ pulls: [{ ...merged, merged_at: null }] });
    assert.equal((await check(api)).tested, false);
});

test('a pull request merged onto a moved main holds another tree and runs in full', async () => {
    const { api, asked } = github({ pulls: [merged], trees: { [MAIN]: TREE, [HEAD]: 'e'.repeat(40) } });
    const result = await check(api);
    assert.equal(result.tested, false);
    assert.match(result.reason, /another tree/);
    assert.ok(!asked.some((endpoint) => endpoint.includes('/actions/')));
});

test('the same tree without a successful run of this workflow runs in full', async () => {
    const { api } = github({ pulls: [merged], successfulRuns: 0 });
    const result = await check(api);
    assert.equal(result.tested, false);
    assert.match(result.reason, /no successful build-linux\.yml run/);
});

test('a GitHub API failure propagates to the caller', async () => {
    const api = async () => {
        throw new Error('HTTP 502');
    };
    await assert.rejects(check(api), /HTTP 502/);
});

test("a Dependabot or fork pull request, which ran without the repository's secrets, does not count", async () => {
    for (const pull of [
        { ...merged, user: { login: 'dependabot[bot]' } },
        { ...merged, head: { sha: HEAD, repo: { full_name: 'someone/crossbind' } } },
    ]) {
        const { api } = github({ pulls: [pull] });
        const result = await check(api);
        assert.equal(result.tested, false);
        assert.match(result.reason, /secrets/);
    }
});

test('a merge that changes a file a cache of main is keyed on runs in full, so main saves that cache', async () => {
    for (const file of [
        'pnpm-lock.yaml',
        'core/crossbind/src/utils/hermes.js',
        'tooling/bridge-tools/sources.json',
        'examples/mobile-reactnative-cli/android/build.gradle',
    ]) {
        const { api } = github({ pulls: [merged], files: ['README.md', file] });
        const result = await check(api);
        assert.equal(result.tested, false, file);
        assert.match(result.reason, new RegExp(file.replaceAll('.', '\\.')));
    }
});

test('a merge that changes what is compiled runs in full where the workflow writes the compiler cache, and only there', async () => {
    const compiled = [
        'core/embind-napi/src/binding.cpp',
        'e2e/conformance/native/shapes.h',
        'core/app-host/cpp/CMakeLists.txt',
        'core/crossbind/src/assets/cmake/ios.toolchain.cmake',
        'ports/gdal/base/crossbind.build.js',
        'core/crossbind/src/actions/run.js',
        'core/crossbind/src/utils/linuxToolchain.js',
    ];
    for (const file of compiled) {
        const files = ['docs/api/overrides.md', file];
        const result = await check(github({ pulls: [merged], files }).api, true);
        assert.equal(result.tested, false, file);
        assert.match(result.reason, new RegExp(file.replaceAll('.', '\\.')));
        assert.equal((await check(github({ pulls: [merged], files }).api)).tested, true, file);
    }
});

test('a workflow writes the compiler cache when it sets that cache up', () => {
    assert.equal(usesCompilerCache('build-macos.yml'), true);
    assert.equal(usesCompilerCache('test-core.yml'), false);
});
