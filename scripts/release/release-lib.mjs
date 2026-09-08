import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PACKAGE_NAME = 'crossbind';
export const PACKAGE_JSON_SOURCE = 'core/crossbind/package.json';
export const PACKAGE_REPOSITORY = 'https://github.com/crossbind/crossbind.git';
export const RELEASE_NOTES_DIRECTORY = 'releases/crossbind';
export const MANIFEST_SCHEMA_SOURCE = 'releases/crossbind/manifest.schema.json';
export const TOOLCHAIN_DIGEST_SOURCE = 'core/crossbind/src/assets/toolchain-digests.json';
export const MANIFEST_ASSET_NAME = 'crossbind-release.json';
export const NPM_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

const CORE_PATTERN = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
const BUILD_PATTERN = '(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?';
const SUPPORTED_VERSION = new RegExp(`^${CORE_PATTERN}(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?${BUILD_PATTERN}$`);
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`Cannot read JSON from ${file}: ${error.message}`, { cause: error });
    }
}

export function semverChannelPolicy(version) {
    const match = SUPPORTED_VERSION.exec(String(version));
    if (!match) throw new Error(`Invalid semantic version "${version}".`);

    const prereleaseIdentifier = match[4];
    if (prereleaseIdentifier === undefined) {
        return {
            version,
            channel: 'stable',
            npmDistTag: 'latest',
            prerelease: false,
            githubRelease: 'release',
            promotionRequired: false,
        };
    }

    const parts = prereleaseIdentifier.split('.');
    const validNumber = parts.length === 2 && /^(0|[1-9][0-9]*)$/.test(parts[1]);
    if (!validNumber || !['beta', 'rc'].includes(parts[0])) {
        throw new Error(`Unsupported prerelease identifier in "${version}". Use -beta.<number>, -rc.<number>, or a stable version.`);
    }

    const beta = parts[0] === 'beta';
    return {
        version,
        channel: beta ? 'beta' : 'rc',
        npmDistTag: beta ? 'beta' : 'next',
        prerelease: true,
        githubRelease: 'prerelease',
        promotionRequired: false,
    };
}

export function releasePolicy(version) {
    return { ...semverChannelPolicy(version), gitTag: `${PACKAGE_NAME}@${version}` };
}

export function releaseNotesSource(version) {
    return `${RELEASE_NOTES_DIRECTORY}/${version}.md`;
}

export function parseReleaseNotes(markdown, source = 'release notes') {
    const normalized = String(markdown).replaceAll('\r\n', '\n');
    const match = /^---\n([\s\S]*?)\n---\n(?:\n)?([\s\S]*)$/.exec(normalized);
    if (!match) throw new Error(`${source}: expected YAML frontmatter delimited by --- at the start of the file.`);

    const metadata = {};
    for (const [index, line] of match[1].split('\n').entries()) {
        if (!line.trim()) continue;
        const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(line);
        if (!field) throw new Error(`${source}: invalid frontmatter on line ${index + 2}. Use unquoted single-line values.`);
        if (Object.hasOwn(metadata, field[1])) throw new Error(`${source}: duplicate frontmatter field "${field[1]}".`);
        metadata[field[1]] = field[2].trim();
    }

    const required = ['package', 'version', 'title', 'summary'];
    for (const field of required) {
        if (!metadata[field]) throw new Error(`${source}: missing frontmatter field "${field}".`);
    }
    const body = match[2].trim();
    if (!body) throw new Error(`${source}: the human-authored Markdown body is empty.`);
    return { metadata, body };
}

export function loadReleaseNotes(root, version, explicitSource) {
    const source = explicitSource ?? releaseNotesSource(version);
    const absolute = path.resolve(root, source);
    if (!fs.existsSync(absolute)) {
        throw new Error(
            `Missing release notes for ${PACKAGE_NAME}@${version}: ${source}. Copy ${RELEASE_NOTES_DIRECTORY}/TEMPLATE.md, ` +
                'replace its placeholders, and keep this as the only version-specific release-note source.',
        );
    }
    const notes = parseReleaseNotes(fs.readFileSync(absolute, 'utf8'), source);
    if (notes.metadata.package !== PACKAGE_NAME) {
        throw new Error(`${source}: frontmatter package is "${notes.metadata.package}", expected "${PACKAGE_NAME}".`);
    }
    if (notes.metadata.version !== version) {
        throw new Error(`${source}: frontmatter version is "${notes.metadata.version}", expected "${version}".`);
    }

    const directory = path.resolve(root, RELEASE_NOTES_DIRECTORY);
    const duplicates = fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'TEMPLATE.md')
        .map((entry) => path.join(RELEASE_NOTES_DIRECTORY, entry.name))
        .filter((candidate) => candidate !== source)
        .filter((candidate) => {
            try {
                const candidateNotes = parseReleaseNotes(fs.readFileSync(path.resolve(root, candidate), 'utf8'), candidate);
                return candidateNotes.metadata.package === PACKAGE_NAME && candidateNotes.metadata.version === version;
            } catch {
                return false;
            }
        });
    if (duplicates.length) {
        throw new Error(`${source}: release ${version} has duplicate version-specific notes: ${duplicates.join(', ')}.`);
    }
    return { ...notes, source, absolute };
}

export function validateToolchainDigestTable(table, source = TOOLCHAIN_DIGEST_SOURCE) {
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error(`${source}: expected an object.`);
    if (typeof table.version !== 'string' || !table.version) throw new Error(`${source}: version is required.`);
    if (typeof table.registry !== 'string' || !table.registry) throw new Error(`${source}: registry is required.`);
    for (const role of ['rust-sysroot', 'base', 'web', 'android']) {
        const image = table.images?.[role];
        if (!image || !DIGEST.test(image.index ?? '')) throw new Error(`${source}: ${role} index digest is missing or malformed.`);
        const platforms = image.platforms;
        if (!platforms || typeof platforms !== 'object' || !DIGEST.test(platforms['linux/amd64'] ?? '')) {
            throw new Error(`${source}: ${role} linux/amd64 digest is missing or malformed.`);
        }
        for (const [platform, digest] of Object.entries(platforms)) {
            if (!DIGEST.test(digest)) throw new Error(`${source}: ${role} ${platform} digest is malformed.`);
        }
    }
    return table;
}

export function sha256File(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function valueType(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
}

export function validateAgainstSchema(value, schema, location = '$') {
    const errors = [];
    const visit = (current, rule, at) => {
        if (Object.hasOwn(rule, 'const') && current !== rule.const) errors.push(`${at}: expected ${JSON.stringify(rule.const)}.`);
        if (rule.enum && !rule.enum.includes(current)) errors.push(`${at}: expected one of ${rule.enum.join(', ')}.`);
        if (rule.type && valueType(current) !== rule.type) {
            errors.push(`${at}: expected ${rule.type}, got ${valueType(current)}.`);
            return;
        }
        if (typeof current === 'string') {
            if (rule.pattern && !new RegExp(rule.pattern).test(current)) errors.push(`${at}: does not match ${rule.pattern}.`);
            if (
                rule.format === 'date-time' &&
                (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(current) || Number.isNaN(Date.parse(current)))
            ) {
                errors.push(`${at}: expected an RFC 3339 date-time.`);
            }
        }
        if (rule.type === 'object' && current && !Array.isArray(current)) {
            for (const required of rule.required ?? []) {
                if (!Object.hasOwn(current, required)) errors.push(`${at}: missing required property "${required}".`);
            }
            if (rule.additionalProperties === false) {
                for (const key of Object.keys(current)) {
                    if (!Object.hasOwn(rule.properties ?? {}, key)) errors.push(`${at}: unexpected property "${key}".`);
                }
            }
            for (const [key, child] of Object.entries(rule.properties ?? {})) {
                if (Object.hasOwn(current, key)) visit(current[key], child, `${at}.${key}`);
            }
        }
    };
    visit(value, schema, location);
    if (errors.length) throw new Error(`JSON Schema validation failed:\n- ${errors.join('\n- ')}`);
    return value;
}

export function createReleaseManifest({ version, publishedAt, gitCommit, digestSha256, npmMetadata = {} }) {
    const policy = releasePolicy(version);
    return {
        schemaVersion: 1,
        package: PACKAGE_NAME,
        version,
        channel: policy.channel,
        prerelease: policy.prerelease,
        publishedAt,
        npm: {
            distTag: policy.npmDistTag,
            url: `https://www.npmjs.com/package/${PACKAGE_NAME}/v/${version}`,
            tarball: npmMetadata.tarball ?? '<confirmed npm registry tarball URL>',
            integrity: npmMetadata.integrity ?? '<confirmed npm registry integrity>',
            provenance: npmMetadata.provenance ?? {
                url: '<confirmed npm registry attestation URL>',
                predicateType: NPM_PROVENANCE_PREDICATE,
            },
        },
        git: {
            tag: policy.gitTag,
            commit: gitCommit,
        },
        releaseNotes: {
            source: releaseNotesSource(version),
        },
        toolchainDigestTable: {
            source: TOOLCHAIN_DIGEST_SOURCE,
            sha256: digestSha256,
        },
    };
}

export function validateReleaseManifest(manifest, options = {}) {
    const root = options.root ?? process.cwd();
    const schemaPath = path.resolve(root, options.schemaSource ?? MANIFEST_SCHEMA_SOURCE);
    const schema = options.schema ?? readJson(schemaPath);
    validateAgainstSchema(manifest, schema);

    const policy = releasePolicy(manifest.version);
    const semanticErrors = [];
    if (manifest.channel !== policy.channel) semanticErrors.push(`channel must be ${policy.channel}.`);
    if (manifest.prerelease !== policy.prerelease) semanticErrors.push(`prerelease must be ${policy.prerelease}.`);
    if (manifest.npm.distTag !== policy.npmDistTag) semanticErrors.push(`npm.distTag must be ${policy.npmDistTag}.`);
    if (manifest.npm.url !== `https://www.npmjs.com/package/${PACKAGE_NAME}/v/${manifest.version}`) {
        semanticErrors.push('npm.url must address the exact package version.');
    }
    if (manifest.npm.tarball !== `https://registry.npmjs.org/${PACKAGE_NAME}/-/${PACKAGE_NAME}-${manifest.version}.tgz`) {
        semanticErrors.push('npm.tarball must be the registry URL for the exact package version.');
    }
    if (manifest.npm.provenance.url !== `https://registry.npmjs.org/-/npm/v1/attestations/${PACKAGE_NAME}@${manifest.version}`) {
        semanticErrors.push('npm.provenance.url must address the exact package attestation bundle.');
    }
    if (manifest.npm.provenance.predicateType !== NPM_PROVENANCE_PREDICATE) {
        semanticErrors.push(`npm.provenance.predicateType must be ${NPM_PROVENANCE_PREDICATE}.`);
    }
    if (manifest.git.tag !== policy.gitTag) semanticErrors.push(`git.tag must be ${policy.gitTag}.`);
    if (manifest.releaseNotes.source !== releaseNotesSource(manifest.version)) {
        semanticErrors.push(`releaseNotes.source must be ${releaseNotesSource(manifest.version)}.`);
    }
    if (manifest.toolchainDigestTable.source !== TOOLCHAIN_DIGEST_SOURCE) {
        semanticErrors.push(`toolchainDigestTable.source must be ${TOOLCHAIN_DIGEST_SOURCE}.`);
    }
    if (semanticErrors.length) throw new Error(`Release manifest is internally inconsistent:\n- ${semanticErrors.join('\n- ')}`);

    if (options.verifySources !== false) {
        loadReleaseNotes(root, manifest.version);
        const digestPath = path.resolve(root, TOOLCHAIN_DIGEST_SOURCE);
        validateToolchainDigestTable(readJson(digestPath));
        const actualDigest = sha256File(digestPath);
        if (manifest.toolchainDigestTable.sha256 !== actualDigest) {
            throw new Error(`Toolchain digest-table hash mismatch: manifest has ${manifest.toolchainDigestTable.sha256}, actual ${actualDigest}.`);
        }
    }
    return manifest;
}

export function buildReleasePlan({ root = process.cwd(), gitCommit, publishedAt, npmMetadata, releaseNotes: explicitSource, schemaSource } = {}) {
    const packageJson = readJson(path.resolve(root, PACKAGE_JSON_SOURCE));
    if (packageJson.name !== PACKAGE_NAME) {
        throw new Error(`${PACKAGE_JSON_SOURCE}: package name is "${packageJson.name}", expected "${PACKAGE_NAME}".`);
    }
    if (packageJson.repository !== PACKAGE_REPOSITORY) {
        throw new Error(
            `${PACKAGE_JSON_SOURCE}: repository is ${JSON.stringify(packageJson.repository)}, expected ${JSON.stringify(PACKAGE_REPOSITORY)} ` +
                'for npm GitHub Actions Trusted Publishing.',
        );
    }
    const version = packageJson.version;
    const policy = releasePolicy(version);
    const notes = loadReleaseNotes(root, version, explicitSource);
    const digestPath = path.resolve(root, TOOLCHAIN_DIGEST_SOURCE);
    const digestTable = validateToolchainDigestTable(readJson(digestPath));
    const digestSha256 = sha256File(digestPath);
    if (!/^[0-9a-f]{40}$/.test(gitCommit ?? '')) throw new Error('A full 40-character release commit SHA is required.');

    const manifest = createReleaseManifest({
        version,
        publishedAt: publishedAt ?? '<confirmed npm registry timestamp>',
        gitCommit,
        digestSha256,
        npmMetadata,
    });
    if (publishedAt) validateReleaseManifest(manifest, { root, schemaSource });

    return {
        package: PACKAGE_NAME,
        version,
        policy,
        notes,
        digestTable,
        digestPath,
        digestSha256,
        manifest,
    };
}

export function renderGitHubReleaseBody(plan) {
    return `${plan.notes.metadata.summary}\n\n${plan.notes.body}\n\n---\n\nPackage: [${PACKAGE_NAME}@${plan.version}](${plan.manifest.npm.url})\n`;
}

export function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

const GITHUB_OUTPUT_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function appendGitHubOutput(file, outputs) {
    if (!file) return;
    const lines = Object.entries(outputs).map(([key, value]) => {
        if (!GITHUB_OUTPUT_KEY_RE.test(key)) throw new Error(`${JSON.stringify(key)} is not a safe GitHub output key.`);
        const text = String(value);
        if (!/[\r\n]/.test(text)) return `${key}=${text}`;
        // A newline inside a value would otherwise start a second key=value line.
        let delimiter = `crossbind_${crypto.randomUUID()}`;
        while (text.includes(delimiter)) delimiter = `crossbind_${crypto.randomUUID()}`;
        return `${key}<<${delimiter}\n${text}\n${delimiter}`;
    });
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
}
