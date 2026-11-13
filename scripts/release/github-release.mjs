import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitHubCliRelease {
    constructor({ repository = process.env.GITHUB_REPOSITORY, cwd = process.cwd(), timeoutMs } = {}) {
        if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
        this.repository = repository;
        this.cwd = cwd;
        this.timeoutMs = timeoutMs;
    }

    async run(args, { allowMissing = false, encoding = 'utf8' } = {}) {
        try {
            return await execFileAsync('gh', args, {
                cwd: this.cwd,
                encoding,
                env: process.env,
                maxBuffer: 16 * 1024 * 1024,
                timeout: this.timeoutMs,
            });
        } catch (error) {
            const detail = `${error.stderr ?? ''}\n${error.stdout ?? ''}`;
            if (allowMissing && /HTTP 404|not found|release not found/i.test(detail)) return null;
            throw new Error(`gh ${args.join(' ')} failed: ${(error.stderr || error.message).toString().trim()}`, { cause: error });
        }
    }

    async api(endpoint, { allowMissing = false } = {}) {
        const result = await this.run(['api', endpoint], { allowMissing });
        return result === null ? null : JSON.parse(result.stdout);
    }

    async tagCommit(tag) {
        let reference = await this.api(`repos/${this.repository}/git/ref/tags/${encodeURIComponent(tag)}`, { allowMissing: true });
        if (!reference) return null;
        let object = reference.object;
        for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
            const annotated = await this.api(`repos/${this.repository}/git/tags/${object.sha}`);
            object = annotated.object;
        }
        if (object?.type !== 'commit' || !object.sha) throw new Error(`${tag} does not ultimately reference a commit.`);
        return object.sha;
    }

    async createTag(tag, commit) {
        await this.run(['api', '--method', 'POST', `repos/${this.repository}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${commit}`]);
    }

    release(tag) {
        return this.api(`repos/${this.repository}/releases/tags/${encodeURIComponent(tag)}`, { allowMissing: true });
    }

    async createRelease({ tag, title, bodyFile, prerelease }) {
        const args = ['release', 'create', tag, '--repo', this.repository, '--verify-tag', '--title', title, '--notes-file', bodyFile];
        if (prerelease) args.push('--prerelease');
        else args.push('--latest=false');
        await this.run(args);
    }

    // Every release in the repository, all pages. Callers filter by exact tag prefix; this is not
    // the generic latest-release endpoint and carries no notion of "latest".
    async listReleases() {
        const result = await this.run(['api', '--paginate', `repos/${this.repository}/releases?per_page=100`, '--jq', '.[]']);
        return result.stdout
            .split('\n')
            .filter((line) => line.trim())
            .map((line) => JSON.parse(line));
    }

    // The raw bytes of one repository file at an exact ref; null when the path is absent there.
    async rawFile(file, ref) {
        const endpoint = `repos/${this.repository}/contents/${file}?ref=${encodeURIComponent(ref)}`;
        const result = await this.run(['api', endpoint, '-H', 'Accept: application/vnd.github.raw+json'], { allowMissing: true, encoding: null });
        return result === null ? null : result.stdout;
    }

    async downloadAsset(asset) {
        const result = await this.run(['api', asset.url, '-H', 'Accept: application/octet-stream'], { encoding: null });
        return result.stdout;
    }

    async uploadAsset(tag, file) {
        await this.run(['release', 'upload', tag, file, '--repo', this.repository]);
    }
}

// GitHub can answer a read with what it held before a write it has just acknowledged: the beta 72 train read three tags
// it had just created as absent, each there minutes later. A read after a write is repeated for half a minute first.
const READ_BACK_ATTEMPTS = 6;
const READ_BACK_FIRST_WAIT_MS = 1000;
const pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

// The first answer of read that isShown takes, else the last one once the reads are spent.
async function readBack(read, isShown, sleep, attempt = 1) {
    const answer = await read();
    if (isShown(answer) || attempt === READ_BACK_ATTEMPTS) return answer;
    await sleep(READ_BACK_FIRST_WAIT_MS * 2 ** (attempt - 1));
    return readBack(read, isShown, sleep, attempt + 1);
}

export async function ensureGitTag({ github, tag, commit, apply = false, log = console.log, sleep = pause }) {
    const existing = await github.tagCommit(tag);
    if (existing === commit) {
        log(`${tag} already points to ${commit}; reusing it.`);
        return 'reused';
    }
    if (existing) {
        throw new Error(`${tag} points to ${existing}, expected ${commit}. Refusing to move the existing tag.`);
    }
    if (!apply) {
        log(`${tag} would be created at ${commit}.`);
        return 'planned';
    }
    try {
        await github.createTag(tag, commit);
    } catch (error) {
        // The train pushes its tags with git, which the API can show a moment later.
        if (!/Reference already exists/i.test(error.message)) throw error;
    }
    const created = await readBack(() => github.tagCommit(tag), Boolean, sleep);
    if (created !== commit) throw new Error(`${tag} settled at ${created ?? '(absent)'}, expected ${commit}.`);
    log(`${tag} created at ${commit}.`);
    return 'created';
}

// The remote's tags through git: one ls-remote reads them all, where the API answers one tag a call.
export class GitRemoteTags {
    constructor({ cwd = process.cwd(), remote = 'origin' } = {}) {
        this.cwd = cwd;
        this.remote = remote;
    }

    async run(args) {
        try {
            const { stdout } = await execFileAsync('git', args, { cwd: this.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
            return stdout;
        } catch (error) {
            throw new Error(`git ${args.join(' ')} failed: ${(error.stderr || error.message).toString().trim()}`, { cause: error });
        }
    }

    // Each tag and the commit it points to; an annotated tag's peeled line names its commit.
    async list() {
        const tags = new Map();
        for (const line of (await this.run(['ls-remote', '--tags', this.remote])).split('\n')) {
            const [sha, ref] = line.split('\t');
            if (!ref?.startsWith('refs/tags/')) continue;
            const peeled = ref.endsWith('^{}');
            const name = ref.slice('refs/tags/'.length, peeled ? -3 : undefined);
            if (peeled || !tags.has(name)) tags.set(name, sha);
        }
        return tags;
    }

    async push(tags, commit) {
        await this.run(['push', '--atomic', '--quiet', this.remote, ...tags.map((tag) => `${commit}:refs/tags/${tag}`)]);
    }
}

const TAGS_PER_PUSH = 64;

// Every tag at commit: the ones already there are reused, the missing ones pushed together. Nothing moves a tag.
export async function ensureGitTags({ git, tags, commit, apply = false, log = console.log, sleep = pause }) {
    const existing = await git.list();
    const moved = tags.filter((tag) => existing.has(tag) && existing.get(tag) !== commit);
    if (moved.length) {
        throw new Error(
            `${moved.map((tag) => `${tag} points to ${existing.get(tag)}`).join(', ')}, expected ${commit}. Refusing to move existing tags.`,
        );
    }
    const missing = tags.filter((tag) => !existing.has(tag));
    const reused = tags.length - missing.length;
    if (!apply || !missing.length) {
        log(`${reused} tag(s) already point to ${commit}${missing.length ? `; ${missing.length} would be created` : ''}.`);
        return { reused, created: 0 };
    }
    for (let index = 0; index < missing.length; index += TAGS_PER_PUSH) await git.push(missing.slice(index, index + TAGS_PER_PUSH), commit);
    const unsettled = (shown) => missing.filter((tag) => shown.get(tag) !== commit);
    const shown = await readBack(
        () => git.list(),
        (answer) => unsettled(answer).length === 0,
        sleep,
    );
    const absent = unsettled(shown);
    if (absent.length) throw new Error(`${absent.map((tag) => `${tag} settled at ${shown.get(tag) ?? '(absent)'}`).join(', ')}, expected ${commit}.`);
    log(`${reused} tag(s) reused and ${missing.length} created at ${commit}.`);
    return { reused, created: missing.length };
}

function normalizeMarkdown(value) {
    return String(value).replaceAll('\r\n', '\n').trim();
}

export async function ensureGitHubRelease({
    github,
    tag,
    title,
    body,
    bodyFile,
    prerelease,
    assets,
    apply = false,
    log = console.log,
    sleep = pause,
}) {
    let release = await github.release(tag);
    if (release) {
        if (release.tag_name !== tag) throw new Error(`GitHub returned release tag ${release.tag_name}, expected ${tag}.`);
        if (release.draft) throw new Error(`${tag} exists as a draft; refusing to publish or rewrite it automatically.`);
        if (Boolean(release.prerelease) !== prerelease) {
            throw new Error(`${tag} prerelease=${release.prerelease}, expected ${prerelease}; refusing to rewrite its classification.`);
        }
        if (release.name !== title) throw new Error(`${tag} title conflicts with the canonical release title.`);
        if (normalizeMarkdown(release.body) !== normalizeMarkdown(body)) {
            throw new Error(`${tag} body conflicts with the canonical release notes; refusing to overwrite it.`);
        }
        log(`${tag} GitHub Release already matches; checking generated assets.`);
    } else {
        if (!apply) {
            log(`${tag} GitHub ${prerelease ? 'prerelease' : 'release'} would be created.`);
            return { action: 'planned', release: null, assets: {} };
        }
        await github.createRelease({ tag, title, bodyFile, prerelease });
        release = await readBack(() => github.release(tag), Boolean, sleep);
        if (!release) throw new Error(`GitHub Release ${tag} was not visible after creation.`);
        log(`${tag} GitHub ${prerelease ? 'prerelease' : 'release'} created.`);
    }

    const resolvedAssets = {};
    for (const asset of assets) {
        const existingAsset = release.assets?.find((candidate) => candidate.name === asset.name);
        if (existingAsset) {
            const current = await github.downloadAsset(existingAsset);
            const expected = fs.readFileSync(asset.file);
            if (!Buffer.from(current).equals(expected)) {
                throw new Error(`${tag} asset ${asset.name} conflicts with the generated file; refusing to overwrite it.`);
            }
            log(`${tag} asset ${asset.name} already matches; reusing it.`);
            resolvedAssets[asset.name] = existingAsset.browser_download_url;
            continue;
        }
        if (!apply) {
            log(`${tag} asset ${asset.name} would be uploaded.`);
            continue;
        }
        await github.uploadAsset(tag, asset.file);
        const named = (candidate) => candidate.name === asset.name;
        release = await readBack(
            () => github.release(tag),
            (current) => Boolean(current?.assets?.some(named)),
            sleep,
        );
        const uploaded = release?.assets?.find(named);
        if (!uploaded) throw new Error(`${tag} asset ${asset.name} was not visible after upload.`);
        log(`${tag} asset ${asset.name} uploaded.`);
        resolvedAssets[asset.name] = uploaded.browser_download_url;
    }
    return { action: 'completed', release, assets: resolvedAssets };
}
