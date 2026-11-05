import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

// A repository as GitHub names it, owner/name.
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
// package.json's repository where it is GitHub's: owner/name or github:owner/name, as npm takes them, or its address,
// git@github.com:owner/name.git as well.
const GITHUB_ADDRESS = /^(?:(?:git\+)?(?:https?|ssh|git):\/\/(?:git@)?github\.com[/:]|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/;

// The token GitHub takes a release from: GH_TOKEN or GITHUB_TOKEN, as GitHub's CLI and Actions name it, else the GitHub
// CLI's own sign-in where it has one; null without any.
export function githubToken(env = process.env) {
    const token = env.GH_TOKEN || env.GITHUB_TOKEN;
    if (token) return token;
    const signedIn = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' });
    return signedIn.status === 0 && signedIn.stdout.trim() ? signedIn.stdout.trim() : null;
}

// The repository a release goes to: CROSSBIND_GITHUB_REPOSITORY, else GITHUB_REPOSITORY, as GitHub Actions sets it,
// else package.json's repository where it is GitHub's; null without one.
export function githubRepository(packageJson, env = process.env) {
    const variable = ['CROSSBIND_GITHUB_REPOSITORY', 'GITHUB_REPOSITORY'].find((name) => env[name]);
    if (variable) {
        if (!REPOSITORY.test(env[variable])) throw new Error(`crossbind: ${variable} ${JSON.stringify(env[variable])} names no repository, as owner/name does.`);
        return env[variable];
    }
    const given = typeof packageJson?.repository === 'string' ? packageJson.repository : packageJson?.repository?.url;
    if (typeof given !== 'string') return null;
    const address = GITHUB_ADDRESS.exec(given)?.[1];
    if (address) return address;
    const short = given.replace(/^github:/, '');
    return REPOSITORY.test(short) ? short : null;
}

const apiAddress = () => process.env.GITHUB_API_URL || 'https://api.github.com';

// What GitHub said of a call it refused, with the field of each error where it names no message, as a 422's do.
const saidIn = (body) => [body?.message, ...(body?.errors ?? []).map((error) => error.message ?? [error.resource, error.field, error.code].filter(Boolean).join(' '))]
    .filter(Boolean).join(': ');

function githubError(status, body, method, route, repository) {
    const said = saidIn(body);
    let text = `crossbind: GitHub answered ${method} ${route} with ${status}${said ? `: ${said}` : '.'}`;
    if (status === 401) {
        text = "crossbind: GitHub refused the token: it has expired, or is none of GitHub's; GH_TOKEN or GITHUB_TOKEN names it, else `gh auth login` signs in.";
    } else if (status === 404 && route === `/repos/${repository}`) {
        text = `crossbind: GitHub has no repository ${repository} the token sees: check its name, and that the token reaches it.`;
    } else if ((status === 403 && !/rate limit/i.test(said)) || (status === 404 && route.endsWith('/releases'))) {
        text += `\ncrossbind: the token takes write access to the contents of ${repository}: a workflow gives its GITHUB_TOKEN \`permissions: contents: write\`, a fine-grained token "Contents" read and write, a classic one the repo scope.`;
    }
    return Object.assign(new Error(text), { status, body });
}

// A caller of GitHub's API for one repository, at a route of the repository's or at an address GitHub gave, as an
// upload's. A file's bytes go up as they are.
export function githubCaller(repository, token) {
    return async (method, route, body) => {
        const isAddress = route.startsWith('https://');
        const address = isAddress ? route : `${apiAddress()}/repos/${repository}${route}`;
        const isBytes = Buffer.isBuffer(body);
        const response = await fetch(address, {
            method,
            headers: {
                authorization: `Bearer ${token}`,
                accept: 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'crossbind',
                ...(body === undefined ? {} : { 'content-type': isBytes ? 'application/octet-stream' : 'application/json' }),
            },
            body: isBytes || body === undefined ? body : JSON.stringify(body),
        });
        const shown = isAddress ? new URL(route).pathname : `/repos/${repository}${route.split('?')[0]}`;
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            if (response.ok) throw new Error(`crossbind: GitHub answered ${method} ${shown} with no JSON, as a proxy between might: ${text.slice(0, 200)}`);
        }
        if (response.ok) return json;
        throw githubError(response.status, json, method, shown, repository);
    };
}

// The oldest draft of a tag on the first page of the repository's releases, which lists the newest first; drafts have no
// tag yet, which GitHub's lookup by tag goes by.
async function draftOf(call, tag) {
    const drafts = (await call('GET', '/releases?per_page=100')).filter((release) => release.draft && release.tag_name === tag);
    return drafts.reduce((oldest, release) => (oldest && oldest.id < release.id ? oldest : release), null);
}

// The release of a tag: the one GitHub has out, else its oldest draft; null without one.
export async function releaseOf(call, tag) {
    const published = await call('GET', `/releases/tags/${encodeURIComponent(tag)}`).catch((error) => {
        if (error.status === 404) return null;
        throw error;
    });
    return published ?? draftOf(call, tag);
}

// A new draft release of a tag, at the commit given or else the default branch's, with the notes GitHub writes of the
// changes since the last. Publishes of the same version at once, as a matrix's jobs, each make one: all then take the
// oldest, and the others go. A tag GitHub has a release of out takes that one.
export async function newRelease(call, { tag, commit, isPrerelease }) {
    let made;
    try {
        made = await call('POST', '/releases', {
            tag_name: tag, ...(commit ? { target_commitish: commit } : {}), name: tag, draft: true, prerelease: isPrerelease, generate_release_notes: true,
        });
    } catch (error) {
        const out = error.status === 422 && (error.body?.errors ?? []).some(({ code }) => code === 'already_exists') ? await releaseOf(call, tag) : null;
        if (!out) throw error;
        return out;
    }
    const oldest = await draftOf(call, tag) ?? made;
    if (oldest.id !== made.id) await call('DELETE', `/releases/${made.id}`);
    return oldest;
}

// Uploads a file to a release under a name, in place of an asset of that name the release has, as an earlier publish of
// the same version left. GitHub renames a name with characters it takes none of, which the update's manifest would no
// longer find, so that stops the publish.
export async function uploadAsset(call, release, file, name) {
    const bytes = fs.readFileSync(file);
    const old = (release.assets ?? []).find((asset) => asset.name === name);
    if (old) await call('DELETE', `/releases/assets/${old.id}`);
    const uploaded = await call('POST', `${release.upload_url.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(name)}`, bytes);
    if (uploaded.name !== name) throw new Error(`crossbind: GitHub named ${name} ${uploaded.name}, as it takes no such name: rename general.name in crossbind.config.js to letters, digits, . _ and -.`);
}

// Puts a draft out, latest unless GitHub has a newer version out, so a fix of an older line leaves the newest latest.
export const publishRelease = (call, release) => call('PATCH', `/releases/${release.id}`, { draft: false, make_latest: 'legacy' });
