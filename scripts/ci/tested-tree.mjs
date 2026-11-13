import fs from 'node:fs';
import { githubApi, runAsScript, setOutput, workflowOption } from './github-api.mjs';

// A merge that moves one of these keys runs in full, so main saves the cache the next pull requests restore.
const CACHE_INPUTS = [
    /^pnpm-lock\.yaml$/,
    /^\.nvmrc$/,
    /^core\/crossbind\/src\/utils\/hermes\.js$/,
    /^core\/crossbind\/src\/assets\/toolchain-digests\.json$/,
    /^tooling\/bridge-tools\//,
    /^tooling\/docker\/base\.Dockerfile$/,
    /\.gradle(\.kts)?$/,
    /(^|\/)gradle(-wrapper)?\.properties$/,
];
// What the compiler cache is built from. A workflow that sets that cache up runs such a merge in full too, as main alone
// writes it; a missing entry costs speed alone, as sccache keys each object on what it compiles.
const COMPILER_INPUTS = [
    /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inl|ipp|m|mm|i|swg)$/,
    /(^|\/)CMakeLists\.txt$/,
    /\.cmake$/,
    /^ports\//,
    /^core\/crossbind\/src\/actions\/(run|createLib|buildLib|buildApp|buildNode|getCmakeParameters|createInterface)\.js$/,
    /^core\/crossbind\/src\/utils\/[A-Za-z]*(Toolchain|Flags)\.js$/,
];
const FILES_PER_PAGE = 100;

export function usesCompilerCache(workflow) {
    return fs.readFileSync(new URL(`../../.github/workflows/${workflow}`, import.meta.url), 'utf8').includes('./.github/actions/setup-sccache');
}

async function pullFiles(api, repository, number) {
    const files = [];
    for (let page = 1; ; page += 1) {
        const batch = await api(`repos/${repository}/pulls/${number}/files?per_page=${FILES_PER_PAGE}&page=${page}`);
        files.push(...batch.map((file) => file.filename));
        if (batch.length < FILES_PER_PAGE) return files;
    }
}

export async function treeTestedInPullRequest({ api, repository, sha, workflow, compilerCache = false }) {
    const pulls = await api(`repos/${repository}/commits/${sha}/pulls`);
    const pull = pulls.find((candidate) => candidate.merged_at && candidate.merge_commit_sha === sha);
    if (!pull) return { tested: false, reason: `no pull request was merged as ${sha}` };
    // Such a run had none of the secrets the steps of a run on main use.
    if (pull.user?.login === 'dependabot[bot]' || pull.head?.repo?.full_name !== repository) {
        return { tested: false, reason: `#${pull.number} ran without the repository's secrets` };
    }
    const [head, commit] = await Promise.all([
        api(`repos/${repository}/git/commits/${pull.head.sha}`),
        api(`repos/${repository}/git/commits/${sha}`),
    ]);
    if (head.tree.sha !== commit.tree.sha) return { tested: false, reason: `#${pull.number}'s head ${pull.head.sha} holds another tree` };
    const runs = await api(
        `repos/${repository}/actions/workflows/${workflow}/runs?event=pull_request&head_sha=${pull.head.sha}&status=success&per_page=1`,
    );
    if (!runs.total_count) return { tested: false, reason: `#${pull.number} has no successful ${workflow} run on ${pull.head.sha}` };
    const inputs = compilerCache ? [...CACHE_INPUTS, ...COMPILER_INPUTS] : CACHE_INPUTS;
    const cacheInput = (await pullFiles(api, repository, pull.number)).find((file) => inputs.some((pattern) => pattern.test(file)));
    if (cacheInput) return { tested: false, reason: `#${pull.number} changes ${cacheInput}, which a cache main writes is built from` };
    return { tested: true, reason: `#${pull.number} passed ${workflow} on the same tree in ${runs.workflow_runs[0].html_url}` };
}

async function main() {
    const workflow = workflowOption();
    const { GITHUB_REPOSITORY: repository, GITHUB_SHA: sha } = process.env;
    if (!repository || !sha) throw new Error('GITHUB_REPOSITORY and GITHUB_SHA are required.');
    const api = githubApi();
    let tested = false;
    try {
        const result = await treeTestedInPullRequest({ api, repository, sha, workflow, compilerCache: usesCompilerCache(workflow) });
        tested = result.tested;
        console.log(`::notice::${tested ? 'Skipping the jobs' : 'Running every job'}: ${result.reason}.`);
    } catch (error) {
        // Running every job is the safe answer when GitHub cannot tell.
        console.log(`::warning::Running every job, as the check failed: ${error.message}`);
    }
    setOutput('tested', tested);
}

runAsScript(import.meta.url, main);
