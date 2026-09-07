import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class GitHubCliRelease {
    constructor({ repository = process.env.GITHUB_REPOSITORY, cwd = process.cwd() } = {}) {
        if (!repository) throw new Error('GITHUB_REPOSITORY is required.');
        this.repository = repository;
        this.cwd = cwd;
    }

    async run(args, { allowMissing = false, encoding = 'utf8' } = {}) {
        try {
            return await execFileAsync('gh', args, {
                cwd: this.cwd,
                encoding,
                env: process.env,
                maxBuffer: 16 * 1024 * 1024,
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
        return this.release(tag);
    }

    async downloadAsset(asset) {
        const result = await this.run(['api', asset.url, '-H', 'Accept: application/octet-stream'], { encoding: null });
        return result.stdout;
    }

    async uploadAsset(tag, file) {
        await this.run(['release', 'upload', tag, file, '--repo', this.repository]);
    }
}

export async function ensureGitTag({ github, tag, commit, apply = false, log = console.log }) {
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
    await github.createTag(tag, commit);
    const created = await github.tagCommit(tag);
    if (created !== commit) throw new Error(`${tag} settled at ${created ?? '(absent)'}, expected ${commit}.`);
    log(`${tag} created at ${commit}.`);
    return 'created';
}

function normalizeMarkdown(value) {
    return String(value).replaceAll('\r\n', '\n').trim();
}

export async function ensureGitHubRelease({ github, tag, title, body, bodyFile, prerelease, assets, apply = false, log = console.log }) {
    let release = await github.release(tag);
    if (release) {
        if (release.tag_name !== tag) throw new Error(`GitHub returned release tag ${release.tag_name}, expected ${tag}.`);
        if (release.draft) throw new Error(`${tag} exists as a draft; refusing to publish or rewrite it automatically.`);
        if (Boolean(release.prerelease) !== prerelease) {
            throw new Error(`${tag} prerelease=${release.prerelease}, expected ${prerelease}; refusing to rewrite its classification.`);
        }
        if (release.name !== title) throw new Error(`${tag} title conflicts with the canonical release-note title.`);
        if (normalizeMarkdown(release.body) !== normalizeMarkdown(body)) {
            throw new Error(`${tag} body conflicts with the canonical release notes; refusing to overwrite it.`);
        }
        log(`${tag} GitHub Release already matches; checking generated assets.`);
    } else {
        if (!apply) {
            log(`${tag} GitHub ${prerelease ? 'prerelease' : 'release'} would be created.`);
            return { action: 'planned', release: null, assets: {} };
        }
        release = await github.createRelease({ tag, title, bodyFile, prerelease });
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
        release = await github.release(tag);
        const uploaded = release.assets?.find((candidate) => candidate.name === asset.name);
        if (!uploaded) throw new Error(`${tag} asset ${asset.name} was not visible after upload.`);
        log(`${tag} asset ${asset.name} uploaded.`);
        resolvedAssets[asset.name] = uploaded.browser_download_url;
    }
    return { action: 'completed', release, assets: resolvedAssets };
}
