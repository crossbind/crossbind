import { githubApi, option, runAsScript, setOutput, workflowOption } from './github-api.mjs';

const TRUSTED_EVENTS = ['workflow_dispatch', 'push', 'schedule'];

// The newest unexpired artifact of that name a run of the workflow on main made in this repository: never one of a
// fork or a pull request, whose code could have written what a release then builds from.
export async function trustedArtifact({ api, repository, name, workflow }) {
    const { artifacts } = await api(`repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
    for (const artifact of [...artifacts].sort((left, right) => right.id - left.id)) {
        const run = artifact.workflow_run;
        if (artifact.expired || run?.head_branch !== 'main' || run.head_repository_id !== run.repository_id) continue;
        const details = await api(`repos/${repository}/actions/runs/${run.id}`);
        if (details.path?.split('@')[0] !== `.github/workflows/${workflow}` || !TRUSTED_EVENTS.includes(details.event)) continue;
        // A run on a tag named main reports main as well: its commit has to be one main holds.
        const { status } = await api(`repos/${repository}/compare/${run.head_sha}...main`);
        if (!['ahead', 'identical'].includes(status)) continue;
        return { artifactId: artifact.id, runId: run.id };
    }
    return null;
}

async function main() {
    const name = option('--name');
    const workflow = workflowOption();
    const { GITHUB_REPOSITORY: repository } = process.env;
    if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
    let found = null;
    try {
        found = await trustedArtifact({ api: githubApi(), repository, name, workflow });
        console.log(
            found
                ? `::notice::${name} comes from run ${found.runId}.`
                : `::notice::No run of ${workflow} on main left ${name}; the build starts from nothing.`,
        );
    } catch (error) {
        // A build from nothing is slower, never wrong.
        console.log(`::warning::${name} is left out, as the lookup failed: ${error.message}`);
    }
    setOutput('run-id', found?.runId ?? '');
}

runAsScript(import.meta.url, main);
