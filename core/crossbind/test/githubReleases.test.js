import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The GitHub CLI's sign-in, which `gh auth token` prints unless `gh.fails`.
const gh = { fails: false };
vi.mock('node:child_process', async (importOriginal) => ({
    ...await importOriginal(),
    spawnSync: () => (gh.fails ? { status: 1, stdout: '' } : { status: 0, stdout: 'gh-token\n' }),
}));

const {
    githubCaller, githubRepository, githubToken, newRelease, publishRelease, releaseOf, uploadAsset,
} = await import('../../../extensions/github/src/githubReleases.js');

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
let dir;
let requests;
// GitHub as one repository's releases see it: its answers by method and route, else none.
let answers;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-github-'));
    requests = [];
    answers = {};
    gh.fails = false;
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        const { hostname, pathname, search } = new URL(url);
        const route = `${init.method} ${hostname === 'api.github.com' ? pathname.replace('/repos/demo/app', '') : hostname + pathname}${search}`;
        requests.push({ route, init });
        return answers[route]?.(init) ?? json(404, { message: 'Not Found' });
    }));
});

afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("a GitHub release's token and repository", () => {
    test("are GH_TOKEN or GITHUB_TOKEN, else the GitHub CLI's sign-in, and none without either", () => {
        expect(githubToken({ GH_TOKEN: 'one', GITHUB_TOKEN: 'two' })).toBe('one');
        expect(githubToken({ GITHUB_TOKEN: 'two' })).toBe('two');
        expect(githubToken({})).toBe('gh-token');
        gh.fails = true;
        expect(githubToken({})).toBeNull();
    });

    test("are CROSSBIND_GITHUB_REPOSITORY, else GITHUB_REPOSITORY, else package.json's repository where it is GitHub's", () => {
        expect(githubRepository({ repository: 'other/app' }, { CROSSBIND_GITHUB_REPOSITORY: 'demo/releases', GITHUB_REPOSITORY: 'demo/app' })).toBe('demo/releases');
        expect(githubRepository({ repository: 'other/app' }, { GITHUB_REPOSITORY: 'demo/app' })).toBe('demo/app');
        expect(['demo/app', 'github:demo/app', 'https://github.com/demo/app', 'git+https://github.com/demo/app.git', 'ssh://git@github.com/demo/app.git', 'git@github.com:demo/app.git']
            .map((repository) => githubRepository({ repository }, {}))).toEqual(Array(6).fill('demo/app'));
        expect(githubRepository({ repository: { type: 'git', url: 'git+https://github.com/demo/app.git' } }, {})).toBe('demo/app');
        expect(['gitlab:demo/app', 'https://gitlab.com/demo/app', undefined].map((repository) => githubRepository({ repository }, {}))).toEqual([null, null, null]);
        expect(() => githubRepository({}, { CROSSBIND_GITHUB_REPOSITORY: 'https://github.com/demo/app' }))
            .toThrow('crossbind: CROSSBIND_GITHUB_REPOSITORY "https://github.com/demo/app" names no repository, as owner/name does.');
    });
});

describe("a repository's releases on GitHub", () => {
    const call = githubCaller('demo/app', 'secret');
    const list = (...releases) => () => json(200, releases);

    test("are asked with the token and GitHub's API version: the one out of a tag, else its oldest draft", async () => {
        answers['GET /releases/tags/v1.2.3'] = () => json(200, { id: 1, tag_name: 'v1.2.3', draft: false });
        expect(await releaseOf(call, 'v1.2.3')).toEqual({ id: 1, tag_name: 'v1.2.3', draft: false });
        expect(requests[0].init.headers).toMatchObject({ authorization: 'Bearer secret', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' });

        answers['GET /releases?per_page=100'] = list({ id: 3, tag_name: 'v1.2.4', draft: true }, { id: 2, tag_name: 'v1.2.4', draft: true }, { id: 1, tag_name: 'v1.2.3', draft: false });
        expect(await releaseOf(call, 'v1.2.4')).toEqual({ id: 2, tag_name: 'v1.2.4', draft: true });
        expect(await releaseOf(call, 'v9.9.9')).toBeNull();
    });

    test("make a draft of a tag at the commit with GitHub's notes, which takes the oldest draft another publish made at once", async () => {
        answers['POST /releases'] = (init) => json(201, { id: 9, ...JSON.parse(init.body) });
        answers['GET /releases?per_page=100'] = list({ id: 9, tag_name: 'v1.2.3', draft: true });
        expect(await newRelease(call, { tag: 'v1.2.3', commit: 'abc', isPrerelease: false })).toMatchObject({ id: 9 });
        expect(JSON.parse(requests[0].init.body)).toEqual({
            tag_name: 'v1.2.3', target_commitish: 'abc', name: 'v1.2.3', draft: true, prerelease: false, generate_release_notes: true,
        });

        requests = [];
        answers['GET /releases?per_page=100'] = list({ id: 9, tag_name: 'v1.2.3', draft: true }, { id: 4, tag_name: 'v1.2.3', draft: true });
        answers['DELETE /releases/9'] = () => new Response(null, { status: 204 });
        expect(await newRelease(call, { tag: 'v1.2.3', isPrerelease: true })).toEqual({ id: 4, tag_name: 'v1.2.3', draft: true });
        expect(JSON.parse(requests[0].init.body)).not.toHaveProperty('target_commitish');
        expect(requests.at(-1).route).toBe('DELETE /releases/9');

        answers['POST /releases'] = () => json(422, { message: 'Validation Failed', errors: [{ resource: 'Release', code: 'already_exists', field: 'tag_name' }] });
        answers['GET /releases/tags/v1.2.3'] = () => json(200, { id: 1, tag_name: 'v1.2.3', draft: false });
        expect(await newRelease(call, { tag: 'v1.2.3', isPrerelease: false })).toEqual({ id: 1, tag_name: 'v1.2.3', draft: false });
    });

    test('take a file in place of the asset of its name, its bytes as they are, and put it out latest unless GitHub has a newer version out', async () => {
        const file = path.join(dir, 'demo-linux-x64.deb');
        fs.writeFileSync(file, Buffer.from([0x21, 0x3c, 0x61, 0x72]));
        const release = { id: 5, upload_url: 'https://uploads.github.com/repos/demo/app/releases/5/assets{?name,label}', assets: [{ id: 50, name: 'demo-linux-x64.deb' }] };
        answers['DELETE /releases/assets/50'] = () => new Response(null, { status: 204 });
        answers['POST uploads.github.com/repos/demo/app/releases/5/assets?name=demo-linux-x64.deb'] = () => json(201, { id: 51, name: 'demo-linux-x64.deb' });
        answers['PATCH /releases/5'] = (init) => json(200, { id: 5, ...JSON.parse(init.body) });

        await uploadAsset(call, release, file, 'demo-linux-x64.deb');
        expect(await publishRelease(call, release)).toEqual({ id: 5, draft: false, make_latest: 'legacy' });

        expect(requests.map(({ route }) => route)).toEqual(['DELETE /releases/assets/50', 'POST uploads.github.com/repos/demo/app/releases/5/assets?name=demo-linux-x64.deb', 'PATCH /releases/5']);
        expect(requests[1].init.headers['content-type']).toBe('application/octet-stream');
        expect(Buffer.compare(requests[1].init.body, fs.readFileSync(file))).toBe(0);
    });

    test("keep the asset there is where the file cannot be read, and stop where GitHub renames the file's name", async () => {
        const release = { id: 5, upload_url: 'https://uploads.github.com/repos/demo/app/releases/5/assets{?name,label}', assets: [{ id: 50, name: 'demo~1.deb' }] };
        await expect(uploadAsset(call, release, path.join(dir, 'missing.deb'), 'demo~1.deb')).rejects.toThrow('ENOENT');
        expect(requests).toEqual([]);

        const file = path.join(dir, 'demo~1.deb');
        fs.writeFileSync(file, 'deb');
        answers['DELETE /releases/assets/50'] = () => new Response(null, { status: 204 });
        answers['POST uploads.github.com/repos/demo/app/releases/5/assets?name=demo~1.deb'] = () => json(201, { id: 51, name: 'demo.1.deb' });
        await expect(uploadAsset(call, release, file, 'demo~1.deb')).rejects.toThrow('crossbind: GitHub named demo~1.deb demo.1.deb, as it takes no such name');
    });

    test('say what GitHub answered a call it refused with, the field it names, and what a token lacks for it', async () => {
        answers['GET /releases/tags/v1.2.3'] = () => json(401, { message: 'Bad credentials' });
        await expect(releaseOf(call, 'v1.2.3')).rejects.toThrow("crossbind: GitHub refused the token: it has expired, or is none of GitHub's");
        answers['POST /releases'] = () => json(403, { message: 'Resource not accessible by integration' });
        await expect(newRelease(call, { tag: 'v1.2.3', isPrerelease: false })).rejects.toThrow([
            'crossbind: GitHub answered POST /repos/demo/app/releases with 403: Resource not accessible by integration',
            'crossbind: the token takes write access to the contents of demo/app: a workflow gives its GITHUB_TOKEN `permissions: contents: write`',
        ].join('\n'));
        answers['POST /releases'] = () => json(403, { message: 'You have exceeded a secondary rate limit.' });
        await expect(newRelease(call, { tag: 'v1.2.3', isPrerelease: false })).rejects.toThrow(/secondary rate limit\.$/);
        answers['POST /releases'] = () => json(422, { message: 'Validation Failed', errors: [{ resource: 'Release', field: 'target_commitish', code: 'invalid' }] });
        await expect(newRelease(call, { tag: 'v1.2.3', isPrerelease: false })).rejects
            .toThrow('crossbind: GitHub answered POST /repos/demo/app/releases with 422: Validation Failed: Release target_commitish invalid');
        await expect(call('GET', '')).rejects.toThrow('crossbind: GitHub has no repository demo/app the token sees: check its name, and that the token reaches it.');
        answers['GET /releases?per_page=100'] = () => new Response('<html>Sign in to the network</html>', { status: 200 });
        await expect(releaseOf(call, 'v9.9.9')).rejects.toThrow('crossbind: GitHub answered GET /repos/demo/app/releases with no JSON, as a proxy between might');
    });
});
