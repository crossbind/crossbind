import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function option(name) {
    const index = process.argv.indexOf(name);
    if (index === -1 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
    return process.argv[index + 1];
}

export function workflowOption() {
    const workflow = option('--workflow');
    if (!/^[\w.-]+\.ya?ml$/.test(workflow)) throw new Error(`${workflow} is not a workflow file name.`);
    return workflow;
}

const API_TIMEOUT_MS = 30_000;

// GET on the REST API with the job's token, the JSON it answers or an error naming the status.
export function githubApi({ token = process.env.GH_TOKEN, apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com' } = {}) {
    if (!token) throw new Error('GH_TOKEN is required.');
    return async (endpoint) => {
        const response = await fetch(`${apiUrl}/${endpoint}`, {
            signal: AbortSignal.timeout(API_TIMEOUT_MS),
            headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
        });
        if (!response.ok) throw new Error(`GET ${endpoint} answered HTTP ${response.status}`);
        return response.json();
    };
}

export function setOutput(key, value) {
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

export function runAsScript(url, main) {
    if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(url)) {
        main().catch((error) => {
            console.error(error.message);
            process.exit(1);
        });
    }
}
