import assert from 'node:assert/strict';
import test from 'node:test';
import { trustedArtifact } from '../trusted-artifact.mjs';

const REPOSITORY = 'crossbind/crossbind';
const ID = 77;

function github(artifacts, runs, onMain = () => 'ahead') {
    return async (endpoint) => {
        const compare = /^repos\/crossbind\/crossbind\/compare\/([0-9a-f]+)\.\.\.main$/.exec(endpoint);
        if (compare) return { status: onMain(compare[1]) };
        if (endpoint === `repos/${REPOSITORY}/actions/artifacts?name=sccache-macos&per_page=100`) return { artifacts };
        const run = /^repos\/crossbind\/crossbind\/actions\/runs\/(\d+)$/.exec(endpoint);
        if (run) return runs[run[1]];
        throw new Error(`unexpected request ${endpoint}`);
    };
}

const artifact = (id, runId, changes = {}) => ({
    id,
    expired: false,
    workflow_run: { id: runId, repository_id: ID, head_repository_id: ID, head_branch: 'main', head_sha: String(runId).padStart(40, '0') },
    ...changes,
});
const release = { path: '.github/workflows/release-crossbind.yml', event: 'workflow_dispatch' };
const find = (api) => trustedArtifact({ api, repository: REPOSITORY, name: 'sccache-macos', workflow: 'release-crossbind.yml' });

test('the newest artifact a release run on main made is taken', async () => {
    const api = github([artifact(3, 30), artifact(2, 20)], { 30: release, 20: release });
    assert.deepEqual(await find(api), { artifactId: 3, runId: 30 });
});

test("a fork's run with a branch named main is passed over", async () => {
    const api = github(
        [artifact(3, 30, { workflow_run: { id: 30, repository_id: ID, head_repository_id: 99, head_branch: 'main' } }), artifact(2, 20)],
        {
            30: release,
            20: release,
        },
    );
    assert.deepEqual(await find(api), { artifactId: 2, runId: 20 });
});

test('a run of another branch, another workflow or a pull request is passed over', async () => {
    const api = github(
        [
            artifact(5, 50, { workflow_run: { id: 50, repository_id: ID, head_repository_id: ID, head_branch: 'ci/x' } }),
            artifact(4, 40),
            artifact(3, 30),
            artifact(2, 20),
        ],
        {
            40: { ...release, path: '.github/workflows/test-core.yml' },
            30: { ...release, event: 'pull_request' },
            20: release,
        },
    );
    assert.deepEqual(await find(api), { artifactId: 2, runId: 20 });
});

test('an expired artifact is passed over, and none left means a build from nothing', async () => {
    const api = github([artifact(3, 30, { expired: true })], { 30: release });
    assert.equal(await find(api), null);
});

test('a run on a tag named main, at a commit main never took, is passed over', async () => {
    const api = github([artifact(3, 30), artifact(2, 20)], { 30: release, 20: release }, (sha) => (sha.endsWith('30') ? 'diverged' : 'ahead'));
    assert.deepEqual(await find(api), { artifactId: 2, runId: 20 });
});

test('a run path with a ref after it still names the workflow', async () => {
    const api = github([artifact(3, 30)], { 30: { ...release, path: '.github/workflows/release-crossbind.yml@refs/heads/main' } });
    assert.deepEqual(await find(api), { artifactId: 3, runId: 30 });
});
