import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GitHubCliRelease } from './github-release.mjs';
import { expectedRegistryTarball, NpmCliRegistry } from './npm-registry.mjs';
import {
    MANIFEST_ASSET_NAME,
    PACKAGE_NAME,
    parseReleaseNotes,
    releasePolicy,
    validateReleaseManifest,
    validateToolchainDigestTable,
} from './release-lib.mjs';
import { releaseNotesBlocks } from './release-notes-blocks.mjs';

// Resolves the one release snapshot the landing site is built from. The configured channel is
// resolved to an exact `crossbind` version once; every later lookup addresses exact versions,
// exact git tags and the GitHub Releases of those tags. GitHub's generic latest-release endpoint
// is never consulted, so other release streams in the same repository cannot leak in. Every
// check fails closed: a missing or inconsistent piece of metadata stops the build rather than
// substituting an older version, a fixture or a guess.
//
// Besides the current release the snapshot carries every earlier `crossbind@*` GitHub Release
// that has a manifest, verified the same way, so /changelog/<version>/ links keep working after
// the channel moves on. It also records the versions the same dist-tag resolves for the packages
// the Quick Start installs alongside `crossbind`, and proves the plugin's `crossbind` range
// admits the resolved version instead of copying one version onto every package.

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GITHUB_REPOSITORY = 'crossbind/crossbind';
export const SITE_CHANNELS = Object.freeze({ beta: 'beta', rc: 'next', stable: 'latest' });
export const SNAPSHOT_SOURCES = Object.freeze(['live', 'fixture']);
export const COMPANION_PLUGIN = '@crossbind/plugin-vite';
export const COMPANION_CREATOR = 'create-crossbind';
export const FIXTURE_ENVIRONMENT_VARIABLE = 'CROSSBIND_SITE_RELEASE_FIXTURE';
// The resolver hands this token to the build it spawns, and the generated module carries the same
// value; vite.config.js refuses a snapshot whose token is not the one in its environment, so a
// bare `vite build` cannot reuse a generated file left behind by an earlier run.
export const BUILD_TOKEN_ENVIRONMENT_VARIABLE = 'CROSSBIND_SITE_BUILD_TOKEN';
// A site build is interactive, not a publication gate: three tries with a short backoff cover a
// flaky connection without holding a laptop for the release train's ten-minute window.
export const SITE_RESOLVE_ATTEMPTS = 3;
export const SITE_RETRY_BACKOFF_MS = 2000;
export const SITE_CLIENT_TIMEOUT_MS = 30 * 1000;

const COMMIT_SHA = /^[0-9a-f]{40}$/;
const TAG_PREFIX = `${PACKAGE_NAME}@`;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-(beta|rc)\.(\d+))?$/;
const CARET_RANGE = /^\^(\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?)$/;
const PRERELEASE_ORDER = { beta: 0, rc: 1 };

export function channelDistTag(channel) {
    const distTag = SITE_CHANNELS[channel];
    if (!distTag) throw new Error(`Unknown site release channel "${channel}". Use one of: ${Object.keys(SITE_CHANNELS).join(', ')}.`);
    return distTag;
}

export function distTagSuffix(channel) {
    const distTag = channelDistTag(channel);
    return distTag === 'latest' ? '' : `@${distTag}`;
}

export function badgeLabel({ channel, version }) {
    if (channel === 'beta') return `Beta · v${version}`;
    if (channel === 'rc') return `RC · v${version}`;
    channelDistTag(channel);
    return `v${version}`;
}

function parseVersion(version) {
    const match = VERSION.exec(String(version));
    if (!match) throw new Error(`Unsupported version "${version}"; expected X.Y.Z, X.Y.Z-beta.N or X.Y.Z-rc.N.`);
    const tuple = [Number(match[1]), Number(match[2]), Number(match[3])];
    const prerelease = match[4] ? [PRERELEASE_ORDER[match[4]], Number(match[5])] : null;
    return { tuple, prerelease };
}

function compareLists(left, right) {
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
}

// The workspace publishes plain caret ranges, so only that form is understood; anything else
// fails closed rather than being guessed at. Follows npm semver: a prerelease version only
// satisfies a range whose base has the same X.Y.Z tuple and an equal-or-lower prerelease.
export function satisfiesCaret(range, version) {
    const base = CARET_RANGE.exec(String(range));
    if (!base) throw new Error(`Unsupported dependency range "${range}"; only ^X.Y.Z[-beta.N|-rc.N] is understood.`);
    const wanted = parseVersion(base[1]);
    const actual = parseVersion(version);
    if (wanted.tuple[0] !== actual.tuple[0]) return false;
    const tuples = compareLists(actual.tuple, wanted.tuple);
    if (actual.prerelease) {
        return tuples === 0 && wanted.prerelease !== null && compareLists(actual.prerelease, wanted.prerelease) >= 0;
    }
    return tuples >= 0;
}

function githubReleaseUrl(tag) {
    return `https://github.com/${GITHUB_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`;
}

async function withRetry(label, operation, { attempts, backoffMs, sleep, log }) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === attempts) break;
            log(`${label} failed (attempt ${attempt}/${attempts}): ${error.message}. Retrying in ${backoffMs * attempt}ms.`);
            await sleep(backoffMs * attempt);
        }
    }
    throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`, { cause: lastError });
}

function parseManifestBytes(bytes, tag) {
    try {
        return JSON.parse(Buffer.from(bytes).toString('utf8'));
    } catch (error) {
        throw new Error(`${tag} asset ${MANIFEST_ASSET_NAME} is not valid JSON: ${error.message}`, { cause: error });
    }
}

// Verifies one exact release end to end and returns what the site renders for it.
async function verifyRelease({ release, registry, github, root, call }) {
    const tag = release.tag_name;
    const version = tag.slice(TAG_PREFIX.length);
    const policy = releasePolicy(version);
    if (release.draft) throw new Error(`${tag} is a draft GitHub Release; the site only builds from published releases.`);
    if (Boolean(release.prerelease) !== policy.prerelease) {
        throw new Error(`${tag} GitHub Release has prerelease=${Boolean(release.prerelease)}, expected ${policy.prerelease}.`);
    }

    // Registry facts about that exact version.
    const [registryVersion, registryIntegrity, registryTarball] = await Promise.all([
        call(`npm view ${PACKAGE_NAME}@${version}`, () => registry.version(version)),
        call(`npm integrity ${version}`, () => registry.integrity(version)),
        call(`npm tarball ${version}`, () => registry.tarball(version)),
    ]);
    if (registryVersion !== version) throw new Error(`npm returned version ${registryVersion ?? '(absent)'} for ${PACKAGE_NAME}@${version}.`);
    if (registryTarball !== expectedRegistryTarball(version)) {
        throw new Error(`npm returned tarball ${registryTarball ?? '(missing)'}, expected ${expectedRegistryTarball(version)}.`);
    }
    if (!registryIntegrity) throw new Error(`npm returned no integrity for ${PACKAGE_NAME}@${version}.`);

    // The manifest asset: schema plus its own consistency, then against the registry. The schema
    // is the one in this checkout on purpose: the site is built from this repository, and a
    // manifest an older release wrote must still satisfy what the site expects today.
    const asset = release.assets?.find((candidate) => candidate.name === MANIFEST_ASSET_NAME);
    if (!asset) throw new Error(`${tag} GitHub Release has no ${MANIFEST_ASSET_NAME} asset.`);
    const manifest = parseManifestBytes(await call(`asset ${MANIFEST_ASSET_NAME} of ${tag}`, () => github.downloadAsset(asset)), tag);
    validateReleaseManifest(manifest, { root, verifySources: false });
    if (manifest.version !== version) throw new Error(`${tag} manifest describes ${manifest.version}, expected ${version}.`);
    if (manifest.npm.integrity !== registryIntegrity) {
        throw new Error(`${tag} manifest integrity ${manifest.npm.integrity} differs from the registry integrity ${registryIntegrity}.`);
    }

    // The exact tag must point at the manifest's commit; annotated tags are peeled by the client.
    const tagCommit = await call(`git tag ${tag}`, () => github.tagCommit(tag));
    if (!tagCommit) throw new Error(`Git tag ${tag} does not exist.`);
    if (tagCommit !== manifest.git.commit) {
        throw new Error(`Git tag ${tag} points to ${tagCommit}, but the manifest records ${manifest.git.commit}.`);
    }
    const commit = manifest.git.commit;

    // The canonical sources at that commit: release notes and the toolchain digest table.
    const notesSource = manifest.releaseNotes.source;
    const notesBytes = await call(`file ${notesSource}`, () => github.rawFile(notesSource, commit));
    if (notesBytes === null) throw new Error(`Release notes ${notesSource} were not found at commit ${commit}.`);
    const notes = parseReleaseNotes(Buffer.from(notesBytes).toString('utf8'), notesSource);
    if (notes.metadata.package !== PACKAGE_NAME) {
        throw new Error(`${notesSource}: frontmatter package is "${notes.metadata.package}", expected "${PACKAGE_NAME}".`);
    }
    if (notes.metadata.version !== version) {
        throw new Error(`${notesSource}: frontmatter version is "${notes.metadata.version}", expected "${version}".`);
    }

    const digestSource = manifest.toolchainDigestTable.source;
    const digestBytes = await call(`file ${digestSource}`, () => github.rawFile(digestSource, commit));
    if (digestBytes === null) throw new Error(`Toolchain digest table ${digestSource} was not found at commit ${commit}.`);
    const digestSha256 = crypto.createHash('sha256').update(Buffer.from(digestBytes)).digest('hex');
    if (digestSha256 !== manifest.toolchainDigestTable.sha256) {
        throw new Error(
            `Toolchain digest-table hash mismatch: manifest has ${manifest.toolchainDigestTable.sha256}, ${digestSource} at ${commit} hashes to ${digestSha256}.`,
        );
    }
    let digestTable;
    try {
        digestTable = validateToolchainDigestTable(JSON.parse(Buffer.from(digestBytes).toString('utf8')), digestSource);
    } catch (error) {
        throw new Error(`${digestSource} at ${commit}: ${error.message}`, { cause: error });
    }

    return {
        version,
        channel: policy.channel,
        prerelease: policy.prerelease,
        distTag: policy.npmDistTag,
        badge: badgeLabel({ channel: policy.channel, version }),
        publishedAt: manifest.publishedAt,
        npmUrl: manifest.npm.url,
        githubReleaseUrl: githubReleaseUrl(tag),
        gitTag: tag,
        gitCommit: commit,
        releaseNotes: {
            source: notesSource,
            title: notes.metadata.title,
            summary: notes.metadata.summary,
            blocks: releaseNotesBlocks(notes.body, notesSource),
        },
        toolchainDigestTable: digestTable,
    };
}

// The packages the Quick Start installs next to `crossbind`, resolved through the same dist-tag.
// Their versions are reported as they are; the plugin's own `crossbind` range must admit the
// resolved version, which is the compatibility proof the page relies on.
async function resolveCompanions({ distTag, version, registry, call }) {
    const [pluginVersion, creatorVersion] = await Promise.all([
        call(`npm view ${COMPANION_PLUGIN}@${distTag}`, () => registry.viewVersion(COMPANION_PLUGIN, distTag)),
        call(`npm view ${COMPANION_CREATOR}@${distTag}`, () => registry.viewVersion(COMPANION_CREATOR, distTag)),
    ]);
    if (!pluginVersion)
        throw new Error(`npm dist-tag ${distTag} for ${COMPANION_PLUGIN} is absent; the Quick Start install command would not resolve.`);
    if (!creatorVersion)
        throw new Error(`npm dist-tag ${distTag} for ${COMPANION_CREATOR} is absent; the Quick Start create command would not resolve.`);
    const dependencies = await call(`npm view ${COMPANION_PLUGIN}@${pluginVersion} dependencies`, () =>
        registry.viewDependencies(COMPANION_PLUGIN, pluginVersion),
    );
    const crossbindRange = dependencies?.[PACKAGE_NAME];
    if (!crossbindRange) throw new Error(`${COMPANION_PLUGIN}@${pluginVersion} declares no ${PACKAGE_NAME} dependency.`);
    if (!satisfiesCaret(crossbindRange, version)) {
        throw new Error(`${COMPANION_PLUGIN}@${pluginVersion} requires ${PACKAGE_NAME} ${crossbindRange}, which does not admit ${version}.`);
    }
    return {
        [COMPANION_PLUGIN]: { version: pluginVersion, crossbindRange },
        [COMPANION_CREATOR]: { version: creatorVersion },
    };
}

export async function resolveSiteRelease({
    channel,
    registry,
    github,
    root = REPOSITORY_ROOT,
    source = 'live',
    attempts = SITE_RESOLVE_ATTEMPTS,
    backoffMs = SITE_RETRY_BACKOFF_MS,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    log = (message) => process.stdout.write(`${message}\n`),
    now = () => new Date(),
}) {
    const distTag = channelDistTag(channel);
    if (!SNAPSHOT_SOURCES.includes(source)) throw new Error(`Unknown snapshot source "${source}".`);
    const call = (label, operation) => withRetry(label, operation, { attempts, backoffMs, sleep, log });

    // 1. The configured channel resolves to one exact version. This is the only dist-tag query
    //    for `crossbind`.
    const version = await call(`npm dist-tag ${distTag}`, () => registry.distTag(distTag));
    if (!version) throw new Error(`npm dist-tag ${distTag} for ${PACKAGE_NAME} is absent; nothing to build the site from.`);
    const policy = releasePolicy(version);
    if (policy.channel !== channel) {
        throw new Error(`npm dist-tag ${distTag} resolves to ${version}, which is classified as ${policy.channel}, not ${channel}.`);
    }
    log(`${PACKAGE_NAME}@${distTag} resolves to ${version} (${policy.githubRelease}).`);

    // 2. Every published `crossbind@*` GitHub Release with a manifest, selected by exact tag
    //    prefix from the full release list; the current version must be one of them.
    const releases = await call('GitHub releases', () => github.listReleases());
    const candidates = releases.filter(
        (release) => typeof release.tag_name === 'string' && release.tag_name.startsWith(TAG_PREFIX) && !release.draft,
    );
    const withManifest = candidates.filter((release) => release.assets?.some((asset) => asset.name === MANIFEST_ASSET_NAME));
    for (const release of candidates) {
        if (!withManifest.includes(release))
            log(`${release.tag_name} has no ${MANIFEST_ASSET_NAME} asset; it predates the manifest and gets no page.`);
    }
    if (!withManifest.some((release) => release.tag_name === policy.gitTag)) {
        throw new Error(`No GitHub Release with a ${MANIFEST_ASSET_NAME} asset exists for ${policy.gitTag}.`);
    }
    const entries = [];
    for (const release of withManifest) {
        entries.push(await verifyRelease({ release, registry, github, root, call }));
    }
    const history = entries.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
    const current = history.find((entry) => entry.version === version);

    // 3. What installs next to the current version.
    const companions = await resolveCompanions({ distTag, version, registry, call });

    return {
        schemaVersion: 2,
        source,
        resolvedAt: now().toISOString(),
        package: PACKAGE_NAME,
        ...current,
        distTagSuffix: distTagSuffix(channel),
        companions,
        history,
    };
}

// In-memory clients over one JSON document, shaped like the live answers. Used by the tests and
// by CROSSBIND_SITE_RELEASE_FIXTURE for offline development; the snapshot they produce is
// marked source=fixture and the deploy step refuses it.
export function createFixtureClients(fixture) {
    const npm = fixture?.npm ?? {};
    const github = fixture?.github ?? {};
    const assetBytes = (asset) => {
        const content = asset.content;
        return Buffer.from(typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
    };
    return {
        registry: {
            packageName: PACKAGE_NAME,
            distTag: async (tag) => npm.distTags?.[tag] ?? null,
            version: async (version) => (npm.versions?.[version] ? version : null),
            integrity: async (version) => npm.versions?.[version]?.integrity ?? null,
            tarball: async (version) => npm.versions?.[version]?.tarball ?? null,
            viewVersion: async (packageName, spec) => {
                const entry = npm.packages?.[packageName];
                return entry?.distTags?.[spec] ?? (entry?.versions?.[spec] ? spec : null);
            },
            viewDependencies: async (packageName, version) => npm.packages?.[packageName]?.versions?.[version]?.dependencies ?? null,
        },
        github: {
            repository: GITHUB_REPOSITORY,
            listReleases: async () => Object.values(github.releases ?? {}),
            release: async (tag) => github.releases?.[tag] ?? null,
            tagCommit: async (tag) => github.tags?.[tag] ?? null,
            downloadAsset: async (asset) => assetBytes(asset),
            rawFile: async (file, ref) => {
                const content = github.files?.[ref]?.[file];
                return content === undefined ? null : Buffer.from(content);
            },
        },
    };
}

export function createLiveClients() {
    return {
        registry: new NpmCliRegistry({ timeoutMs: SITE_CLIENT_TIMEOUT_MS }),
        github: new GitHubCliRelease({ repository: GITHUB_REPOSITORY, timeoutMs: SITE_CLIENT_TIMEOUT_MS }),
    };
}

export async function resolveSiteReleaseForBuild({ channel, env = process.env, root, createLiveClients: liveClients = createLiveClients, log }) {
    const fixtureFile = env[FIXTURE_ENVIRONMENT_VARIABLE];
    if (fixtureFile) {
        const absolute = path.resolve(fixtureFile);
        let fixture;
        try {
            fixture = JSON.parse(fs.readFileSync(absolute, 'utf8'));
        } catch (error) {
            throw new Error(`${FIXTURE_ENVIRONMENT_VARIABLE}=${fixtureFile} is not a readable JSON fixture: ${error.message}`, { cause: error });
        }
        log?.(`Resolving the site release from fixture ${absolute}; this build cannot be deployed.`);
        return resolveSiteRelease({ channel, ...createFixtureClients(fixture), root, source: 'fixture', log });
    }
    return resolveSiteRelease({ channel, ...liveClients(), root, source: 'live', log });
}

// Guards the site build against a generated snapshot that was not produced for this run.
export function assertSnapshotMatchesConfig(snapshot, { channel, buildToken, environmentToken }) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('The release snapshot is missing.');
    if (snapshot.channel !== channel) {
        throw new Error(
            `The generated release snapshot was resolved for the ${snapshot.channel} channel, but release.config.js selects ${channel}. Use pnpm run build or pnpm run dev.`,
        );
    }
    if (!environmentToken) {
        throw new Error(
            `${BUILD_TOKEN_ENVIRONMENT_VARIABLE} is not set: run the site through pnpm run build or pnpm run dev, which resolve the release first.`,
        );
    }
    if (!buildToken || environmentToken !== buildToken) {
        throw new Error(
            'The generated release snapshot belongs to another run. Use pnpm run build or pnpm run dev, which resolve the release first.',
        );
    }
    return snapshot;
}

export function assertDeployableSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new Error('The release snapshot is missing.');
    if (snapshot.source !== 'live') {
        throw new Error(
            `The site was built from ${snapshot.source ?? 'an unknown'} release data and cannot be deployed. Rebuild without ${FIXTURE_ENVIRONMENT_VARIABLE}.`,
        );
    }
    channelDistTag(snapshot.channel);
    if (typeof snapshot.version !== 'string' || !snapshot.version) throw new Error('The release snapshot has no version.');
    if (!COMMIT_SHA.test(snapshot.gitCommit ?? '')) throw new Error('The release snapshot has no full release commit.');
    return snapshot;
}

// The token is a separate named export so the site bundle, which imports only the default, does
// not carry it.
export function renderSnapshotModule(snapshot, { buildToken } = {}) {
    return (
        '// Generated by scripts/release/resolve-site-release.mjs before every site build. Do not edit.\n' +
        `export const BUILD_TOKEN = ${JSON.stringify(buildToken ?? null)};\n` +
        `export default ${JSON.stringify(snapshot, null, 4)};\n`
    );
}

async function loadChannel(configFile) {
    const { default: config } = await import(pathToFileURL(path.resolve(configFile)).href);
    if (!config || typeof config.channel !== 'string') throw new Error(`${configFile} must export { channel }.`);
    return config.channel;
}

async function main(argv) {
    const valueOf = (flag) => {
        const index = argv.indexOf(flag);
        return index === -1 ? undefined : argv[index + 1];
    };
    const configFile = valueOf('--config');
    const channel = valueOf('--channel') ?? (configFile ? await loadChannel(configFile) : undefined);
    if (!channel) throw new Error('Pass --channel <beta|rc|stable> or --config <file exporting { channel }>.');
    const snapshot = await resolveSiteReleaseForBuild({ channel, log: (message) => process.stderr.write(`${message}\n`) });
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exit(1);
        });
}
