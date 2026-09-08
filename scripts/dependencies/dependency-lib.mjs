import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SHA256_RE = /^[0-9a-f]{64}$/;
export const SHA1_RE = /^[0-9a-f]{40}$/;
export const COMMIT_RE = /^[0-9a-f]{40}$/;
export const VERSION_RE = /^\d+(?:\.\d+){0,3}(?:-[0-9A-Za-z.-]+)?$/;

export function assertSafeId(value, label = 'identifier') {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(value))) {
        throw new Error(`${label} is not safe: ${JSON.stringify(value)}`);
    }
    return String(value);
}

export function assertVersion(value, label = 'version') {
    if (!VERSION_RE.test(String(value))) throw new Error(`${label} is not a supported version: ${JSON.stringify(value)}`);
    return String(value);
}

export function versionParts(version) {
    const [core, prerelease = ''] = String(version).replace(/^v/, '').split('-', 2);
    return {
        core: core.split('.').map((part) => Number(part)),
        prerelease,
    };
}

export function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
        const av = a.core[index] ?? 0;
        const bv = b.core[index] ?? 0;
        if (av !== bv) return av > bv ? 1 : -1;
    }
    if (!a.prerelease && b.prerelease) return 1;
    if (a.prerelease && !b.prerelease) return -1;
    return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

export function updateRisk(current, target) {
    const a = versionParts(current).core;
    const b = versionParts(target).core;
    if ((a[0] ?? 0) !== (b[0] ?? 0)) return 'major';
    if ((a[1] ?? 0) !== (b[1] ?? 0)) return 'minor';
    if ((a[2] ?? 0) !== (b[2] ?? 0)) return 'patch';
    return 'digest';
}

export function readText(root, relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

export function writeText(root, relativePath, content) {
    fs.writeFileSync(path.join(root, relativePath), content);
}

export function matchOne(text, pattern, label) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length !== 1) throw new Error(`${label}: expected exactly one match, found ${matches.length}.`);
    return matches[0];
}

export function replaceOne(text, pattern, replacement, label) {
    const match = matchOne(text, pattern, label);
    const updated = text.slice(0, match.index) + replacement(match) + text.slice(match.index + match[0].length);
    if (updated === text) throw new Error(`${label}: replacement made no change.`);
    return updated;
}

export async function fetchWithRetry(url, options = {}, dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl ?? fetch;
    const attempts = dependencies.attempts ?? 3;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
                ...options,
                headers: {
                    'User-Agent': 'crossbind-dependency-watch',
                    ...options.headers,
                },
                signal: options.signal ?? AbortSignal.timeout(30_000),
            });
            if (response.ok) return response;
            lastError = new Error(`GET ${url} -> HTTP ${response.status}`);
            if (response.status < 500 && response.status !== 429) break;
        } catch (error) {
            lastError = error;
        }
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
    throw lastError ?? new Error(`GET ${url} failed.`);
}

export async function fetchJson(url, options = {}, dependencies = {}) {
    return (await fetchWithRetry(url, options, dependencies)).json();
}

export async function fetchText(url, options = {}, dependencies = {}) {
    return (await fetchWithRetry(url, options, dependencies)).text();
}

export function githubHeaders(token = process.env.GITHUB_TOKEN) {
    return {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
}

export async function githubJson(endpoint, dependencies = {}) {
    const base = dependencies.githubApiBase ?? 'https://api.github.com';
    try {
        return await fetchJson(`${base}${endpoint}`, { headers: githubHeaders(dependencies.githubToken) }, dependencies);
    } catch (error) {
        if (/HTTP 403/.test(error.message) && !(dependencies.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN)) {
            throw new Error(`${error.message}. GitHub's anonymous API limit was reached; set GITHUB_TOKEN and retry.`, { cause: error });
        }
        throw error;
    }
}

export async function githubCommitForRef(repository, ref, dependencies = {}) {
    const encoded = ref
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/');
    const resolved = await githubJson(`/repos/${repository}/git/ref/${encoded}`, dependencies);
    let object = resolved.object;
    if (object?.type === 'tag') {
        object = (await githubJson(`/repos/${repository}/git/tags/${object.sha}`, dependencies)).object;
    }
    if (object?.type !== 'commit' || !COMMIT_RE.test(object.sha ?? '')) {
        throw new Error(`${repository} ${ref} did not resolve to a commit.`);
    }
    return object.sha;
}

export async function githubLatestStableRelease(repository, normalize, dependencies = {}) {
    const releases = await githubJson(`/repos/${repository}/releases?per_page=100`, dependencies);
    const versions = releases
        .filter((release) => !release.draft && !release.prerelease)
        .map((release) => ({ release, version: normalize(release.tag_name) }))
        .filter((entry) => entry.version && VERSION_RE.test(entry.version))
        .sort((a, b) => compareVersions(b.version, a.version));
    if (!versions[0]) throw new Error(`${repository}: no stable release matched the configured version format.`);
    return versions[0];
}

export async function sha256Url(url, dependencies = {}) {
    const response = await fetchWithRetry(url, {}, { ...dependencies, attempts: dependencies.attempts ?? 2 });
    const hash = crypto.createHash('sha256');
    for await (const chunk of response.body) hash.update(chunk);
    return hash.digest('hex');
}

export async function dockerHubDigest(image, tag, dependencies = {}) {
    assertSafeId(tag, 'Docker tag');
    const repository = image.includes('/') ? image : `library/${image}`;
    const tokenResponse = await fetchJson(
        `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(`repository:${repository}:pull`)}`,
        {},
        dependencies,
    );
    if (!tokenResponse.token) throw new Error(`${image}:${tag}: Docker Hub did not return a pull token.`);
    const response = await fetchWithRetry(
        `https://registry-1.docker.io/v2/${repository}/manifests/${encodeURIComponent(tag)}`,
        {
            method: 'HEAD',
            headers: {
                Authorization: `Bearer ${tokenResponse.token}`,
                Accept: [
                    'application/vnd.oci.image.index.v1+json',
                    'application/vnd.docker.distribution.manifest.list.v2+json',
                    'application/vnd.oci.image.manifest.v1+json',
                ].join(', '),
            },
        },
        dependencies,
    );
    const digest = response.headers.get('docker-content-digest');
    if (!/^sha256:[0-9a-f]{64}$/.test(digest ?? '')) throw new Error(`${image}:${tag}: registry returned no valid manifest digest.`);
    return digest;
}

export function proposalId(...parts) {
    return parts
        .join('-')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 100);
}

export function encodeProposal(proposal) {
    return Buffer.from(JSON.stringify(proposal), 'utf8').toString('base64url');
}

const TOOLCHAIN_COMPONENTS = new Set(['node', 'rust', 'emscripten', 'wasi-sdk', 'android-command-line-tools', 'android-ndk', 'swig']);
const ANDROID_TOOLS_ARCHIVE_RE = /^commandlinetools-linux-\d+_latest\.zip$/;

// Encoded proposals cross a workflow boundary; this is the single place their shape is trusted.
function assertProposalFields(value) {
    if (value.kind === 'native') {
        if (typeof value.unit !== 'string') throw new Error(`${value.id}: native proposal needs a native family.`);
        assertSafeId(value.unit, 'native family');
        return;
    }
    if (value.kind !== 'toolchain') throw new Error(`${value.id}: unsupported proposal kind ${JSON.stringify(value.kind)}.`);
    if (!TOOLCHAIN_COMPONENTS.has(value.component)) {
        throw new Error(`${value.id}: unsupported toolchain component ${JSON.stringify(value.component)}.`);
    }
    if (
        value.component === 'android-command-line-tools' &&
        (!ANDROID_TOOLS_ARCHIVE_RE.test(value.archive ?? '') || !SHA1_RE.test(value.sha1 ?? ''))
    ) {
        throw new Error(`${value.id}: Android command-line tools proposal has invalid archive metadata.`);
    }
    if (value.component === 'emscripten' && (!COMMIT_RE.test(value.forkRevision ?? '') || !SHA256_RE.test(value.embindSha256 ?? ''))) {
        throw new Error(`${value.id}: Emscripten proposal needs a full fork revision and a libembind SHA-256.`);
    }
}

export function decodeProposal(encoded) {
    const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    assertSafeId(value.id, 'proposal id');
    assertSafeId(value.kind, 'proposal kind');
    assertProposalFields(value);
    if (value.valueType === 'commit') {
        if (!COMMIT_RE.test(value.current ?? '') || !COMMIT_RE.test(value.target ?? '')) {
            throw new Error(`${value.id}: current and target must be full commit SHAs.`);
        }
    } else {
        assertVersion(value.current, 'current version');
        assertVersion(value.target, 'target version');
    }
    return value;
}
