import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { PACKAGE_NAME } from './release-lib.mjs';

// The beta 56 train saw npm take over five minutes to expose a publish twice; ten minutes with
// the same five-to-thirty-second backoff covers what was observed with room to spare.
export const REGISTRY_MAX_ATTEMPTS = 22;
export const REGISTRY_MAX_DURATION_MS = 10 * 60 * 1000;
export const REGISTRY_INITIAL_BACKOFF_MS = 5 * 1000;
export const REGISTRY_MAX_BACKOFF_MS = 30 * 1000;
export const PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
export const PROVENANCE_REPOSITORY = 'https://github.com/crossbind/crossbind';
export const PROVENANCE_WORKFLOW = '.github/workflows/release-crossbind.yml';

const execFileAsync = promisify(execFile);
const FORBIDDEN_PUBLISH_CREDENTIALS = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'NPM_AUTH_TOKEN'];

export function trustedPublishingEnvironment(environment = process.env) {
    const configuredCredentials = Object.keys(environment).filter(
        (name) =>
            Boolean(environment[name]) &&
            (FORBIDDEN_PUBLISH_CREDENTIALS.includes(name) || (/^npm_config_/i.test(name) && /(?:_auth|authToken)/i.test(name))),
    );
    if (configuredCredentials.length) {
        throw new Error(
            `Trusted Publishing refuses long-lived npm credentials: ${configuredCredentials.join(', ')}. ` +
                'Remove them and authorize this GitHub Actions workflow as the npm Trusted Publisher.',
        );
    }
    if (environment.GITHUB_ACTIONS !== 'true' || !environment.ACTIONS_ID_TOKEN_REQUEST_URL || !environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
        throw new Error(
            'npm publication requires GitHub Actions OIDC Trusted Publishing. ' +
                'Run the protected release-crossbind.yml publish job with id-token: write.',
        );
    }
    return { ...environment };
}

// npm 12 prints every `view <pkg>@<spec> <field> --json` result as an array, even for an exact
// version; npm 11 printed the scalar. A single match is the value either way.
export function parseNpmJson(stdout) {
    const value = stdout.trim();
    if (!value) return null;
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch {
        return value;
    }
    return Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
}

export class NpmCliRegistry {
    constructor({ cwd = process.cwd(), registry = 'https://registry.npmjs.org', packageName = PACKAGE_NAME } = {}) {
        this.cwd = cwd;
        this.registry = registry;
        this.packageName = packageName;
    }

    async run(args, { allowMissing = false, environment = process.env } = {}) {
        try {
            const result = await execFileAsync('npm', [...args, '--registry', this.registry], {
                cwd: this.cwd,
                encoding: 'utf8',
                env: environment,
                maxBuffer: 8 * 1024 * 1024,
            });
            return parseNpmJson(result.stdout);
        } catch (error) {
            const detail = `${error.stderr ?? ''}\n${error.stdout ?? ''}`;
            if (allowMissing && /E404|404 Not Found|is not in this registry/i.test(detail)) return null;
            throw new Error(`npm ${args.join(' ')} failed: ${(error.stderr || error.message).trim()}`, { cause: error });
        }
    }

    version(version) {
        return this.run(['view', `${this.packageName}@${version}`, 'version', '--json'], { allowMissing: true });
    }

    distTag(tag) {
        return this.run(['view', `${this.packageName}@${tag}`, 'version', '--json'], { allowMissing: true });
    }

    integrity(version) {
        return this.run(['view', `${this.packageName}@${version}`, 'dist.integrity', '--json'], { allowMissing: true });
    }

    tarball(version) {
        return this.run(['view', `${this.packageName}@${version}`, 'dist.tarball', '--json'], { allowMissing: true });
    }

    attestations(version) {
        return this.run(['view', `${this.packageName}@${version}`, 'dist.attestations', '--json'], { allowMissing: true });
    }

    async attestationBundle(url) {
        const expectedRegistry = new URL(this.registry);
        const target = new URL(url);
        if (target.origin !== expectedRegistry.origin || !target.pathname.startsWith('/-/npm/v1/attestations/')) {
            throw new Error(`npm returned an unexpected attestation URL: ${url}.`);
        }
        const response = await fetch(target);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Cannot read npm provenance attestation ${url}: HTTP ${response.status}.`);
        return response.json();
    }

    async publishedAt(version) {
        const times = await this.run(['view', this.packageName, 'time', '--json']);
        return times?.[version] ?? null;
    }

    async publish(tarball, distTag) {
        const environment = trustedPublishingEnvironment();
        const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-oidc-npm-'));
        const userConfig = path.join(temporary, 'npmrc');
        fs.writeFileSync(userConfig, `registry=${this.registry}\n`);
        environment.NPM_CONFIG_USERCONFIG = userConfig;
        environment.npm_config_userconfig = userConfig;
        try {
            // Trusted Publishing supplies the short-lived OIDC credential. Keep --provenance
            // explicit as part of this repository's artifact contract; the propagation gate then
            // verifies the resulting signed statement against this exact tarball and git commit.
            return await this.run(['publish', tarball, '--tag', distTag, '--access', 'public', '--provenance'], { environment });
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    }
}

export function expectedRegistryTarball(version, packageName = PACKAGE_NAME) {
    const tarballName = packageName.includes('/') ? packageName.slice(packageName.lastIndexOf('/') + 1) : packageName;
    return `https://registry.npmjs.org/${packageName}/-/${tarballName}-${version}.tgz`;
}

export function expectedAttestationUrl(version, packageName = PACKAGE_NAME) {
    const registryName = packageName.replaceAll('/', '%2f');
    return `https://registry.npmjs.org/-/npm/v1/attestations/${registryName}@${version}`;
}

function integrityHex(integrity) {
    const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity ?? '');
    if (!match) throw new Error(`npm returned malformed SHA-512 integrity: ${integrity ?? '(missing)'}.`);
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length !== 64) throw new Error(`npm returned a SHA-512 integrity with ${bytes.length} bytes, expected 64.`);
    return bytes.toString('hex');
}

export function verifyProvenanceAttestation({ summary, response, version, integrity, gitCommit, packageName = PACKAGE_NAME }) {
    if (summary?.url !== expectedAttestationUrl(version, packageName) || summary?.provenance?.predicateType !== PROVENANCE_PREDICATE) {
        throw new Error(`npm provenance metadata for ${packageName}@${version} is missing or unexpected.`);
    }
    const attestation = response?.attestations?.find((candidate) => candidate.predicateType === PROVENANCE_PREDICATE);
    if (!attestation?.bundle?.dsseEnvelope?.payload) {
        throw new Error(`npm provenance bundle for ${packageName}@${version} has no ${PROVENANCE_PREDICATE} statement.`);
    }
    if (!attestation.bundle.dsseEnvelope.signatures?.length || !attestation.bundle.verificationMaterial?.tlogEntries?.length) {
        throw new Error(`npm provenance bundle for ${packageName}@${version} has no signature or transparency-log entry.`);
    }

    let statement;
    try {
        statement = JSON.parse(Buffer.from(attestation.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
    } catch (error) {
        throw new Error(`npm provenance statement for ${packageName}@${version} is not valid base64 JSON.`, { cause: error });
    }
    const purlName = packageName.startsWith('@') ? `%40${packageName.slice(1)}` : packageName;
    const expectedSubject = `pkg:npm/${purlName}@${version}`;
    const expectedDigest = integrityHex(integrity);
    const subject = statement.subject?.find((candidate) => candidate.name === expectedSubject);
    if (statement.predicateType !== PROVENANCE_PREDICATE || subject?.digest?.sha512 !== expectedDigest) {
        throw new Error(`npm provenance statement does not bind ${expectedSubject} to the published SHA-512 integrity.`);
    }

    const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
    if (workflow?.repository !== PROVENANCE_REPOSITORY || workflow?.path !== PROVENANCE_WORKFLOW) {
        throw new Error(`npm provenance statement was not produced by ${PROVENANCE_REPOSITORY}/${PROVENANCE_WORKFLOW}.`);
    }
    const resolved = statement.predicate?.buildDefinition?.resolvedDependencies ?? [];
    if (!resolved.some((dependency) => dependency?.digest?.gitCommit === gitCommit)) {
        throw new Error(`npm provenance statement does not resolve to release commit ${gitCommit}.`);
    }

    return { url: summary.url, predicateType: PROVENANCE_PREDICATE };
}

export async function waitForRegistry({
    registry,
    expectedVersion,
    expectedDistTag,
    expectedGitCommit,
    maxAttempts = REGISTRY_MAX_ATTEMPTS,
    maxDurationMs = REGISTRY_MAX_DURATION_MS,
    initialBackoffMs = REGISTRY_INITIAL_BACKOFF_MS,
    maxBackoffMs = REGISTRY_MAX_BACKOFF_MS,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    now = () => Date.now(),
    log = (message) => process.stdout.write(`${message}\n`),
}) {
    const packageName = registry.packageName ?? PACKAGE_NAME;
    const startedAt = now();
    let lastVersion = null;
    let lastDistTag = null;
    let lastProvenance = 'absent';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (now() - startedAt > maxDurationMs) break;
        [lastVersion, lastDistTag] = await Promise.all([registry.version(expectedVersion), registry.distTag(expectedDistTag)]);
        if (lastVersion === expectedVersion && lastDistTag === expectedVersion) {
            const [publishedAt, integrity, tarball, attestations] = await Promise.all([
                registry.publishedAt(expectedVersion),
                registry.integrity(expectedVersion),
                registry.tarball(expectedVersion),
                registry.attestations(expectedVersion),
            ]);
            if (!publishedAt) throw new Error(`npm returned ${expectedVersion} without a publication timestamp.`);
            if (tarball !== expectedRegistryTarball(expectedVersion, packageName)) {
                throw new Error(`npm returned tarball ${tarball ?? '(missing)'}, expected ${expectedRegistryTarball(expectedVersion, packageName)}.`);
            }
            if (attestations) {
                if (
                    attestations.url !== expectedAttestationUrl(expectedVersion, packageName) ||
                    attestations.provenance?.predicateType !== PROVENANCE_PREDICATE
                ) {
                    throw new Error(`npm provenance metadata for ${packageName}@${expectedVersion} is missing or unexpected.`);
                }
                let bundle;
                try {
                    bundle = await registry.attestationBundle(attestations.url);
                } catch (error) {
                    lastProvenance = `temporarily unavailable (${error.message})`;
                }
                if (bundle) {
                    const provenance = verifyProvenanceAttestation({
                        summary: attestations,
                        response: bundle,
                        version: expectedVersion,
                        integrity,
                        gitCommit: expectedGitCommit,
                        packageName,
                    });
                    lastProvenance = 'verified';
                    log(
                        `npm propagation attempt ${attempt}/${maxAttempts}: ` +
                            `${packageName}@${expectedVersion}=${lastVersion}, ${expectedDistTag}=${lastDistTag}, provenance=${lastProvenance}`,
                    );
                    return { version: expectedVersion, distTag: expectedDistTag, publishedAt, integrity, tarball, provenance, attempts: attempt };
                }
            }
        }

        log(
            `npm propagation attempt ${attempt}/${maxAttempts}: ` +
                `${packageName}@${expectedVersion}=${lastVersion ?? '(absent)'}, ` +
                `${expectedDistTag}=${lastDistTag ?? '(absent)'}, provenance=${lastProvenance}`,
        );

        if (attempt === maxAttempts) break;
        const elapsed = now() - startedAt;
        const delay = Math.min(initialBackoffMs * 2 ** (attempt - 1), maxBackoffMs, maxDurationMs - elapsed);
        if (delay <= 0) break;
        await sleep(delay);
    }

    throw Object.assign(
        new Error(
            `npm did not expose both ${packageName}@${expectedVersion} and ${expectedDistTag}=${expectedVersion} ` +
                `with verified provenance within ${maxAttempts} attempts / ${Math.round(maxDurationMs / 1000)} seconds. ` +
                `Last response: exact=${lastVersion ?? '(absent)'}, ${expectedDistTag}=${lastDistTag ?? '(absent)'}, provenance=${lastProvenance}.`,
        ),
        { lastVersion, lastDistTag, lastProvenance },
    );
}

export async function ensurePackagePublished({
    registry,
    version,
    distTag,
    integrity,
    tarball,
    gitCommit,
    apply = false,
    log = console.log,
    wait = {},
}) {
    const packageName = registry.packageName ?? PACKAGE_NAME;
    const existingVersion = await registry.version(version);
    let action;

    if (existingVersion === version) {
        const existingIntegrity = await registry.integrity(version);
        if (existingIntegrity !== integrity) {
            throw new Error(
                `${packageName}@${version} already exists with integrity ${existingIntegrity ?? '(missing)'}, ` +
                    `but the release tarball is ${integrity}. Refusing to overwrite conflicting package data.`,
            );
        }
        log(`${packageName}@${version} already exists with matching integrity; it will not be republished.`);
        action = 'reused';
    } else if (existingVersion === null) {
        if (!apply) throw new Error(`${packageName}@${version} is not published; apply mode is required.`);
        await registry.publish(tarball, distTag);
        action = 'published';
    } else {
        throw new Error(`npm returned version ${existingVersion} when ${version} was requested.`);
    }

    let verified;
    try {
        verified = await waitForRegistry({
            registry,
            expectedVersion: version,
            expectedDistTag: distTag,
            expectedGitCommit: gitCommit,
            log,
            ...wait,
        });
    } catch (error) {
        // npm's read-after-write lag makes a stale dist-tag on a resumed run indistinguishable from
        // an external change until the poll is exhausted; only then is it reported as tampering.
        if (action === 'reused' && error.lastVersion === version && error.lastDistTag !== version) {
            throw new Error(
                `${packageName}@${version} exists with matching integrity, but npm dist-tag ${distTag} still points to ` +
                    `${error.lastDistTag ?? '(absent)'} after polling. Trusted Publishing cannot mutate dist-tags, so this workflow ` +
                    'will not repair or overwrite that state. Investigate the external tag change without adding an automation token.',
                { cause: error },
            );
        }
        throw error;
    }
    if (verified.integrity !== integrity) {
        throw new Error(`Registry integrity changed after publication: expected ${integrity}, received ${verified.integrity ?? '(missing)'}.`);
    }
    return { ...verified, action };
}
