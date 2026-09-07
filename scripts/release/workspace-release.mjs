import fs from 'node:fs';
import path from 'node:path';
import { loadReleaseNotes, semverChannelPolicy } from './release-lib.mjs';

export const WORKSPACE_REPOSITORY = 'https://github.com/crossbind/crossbind.git';
export const WORKSPACE_RELEASE_WORKFLOW = '.github/workflows/release-crossbind.yml';
export const WORKSPACE_RELEASE_SCHEMA_VERSION = 1;
export const STABLE_ENTRYPOINTS_SOURCE = 'releases/npm/stable-entrypoints.json';

const WORKSPACE_LAYOUT = [
    ['core', 1],
    ['tooling', 1],
    ['plugins', 1],
    ['ports', 2],
    ['examples', 1],
    ['e2e', 1],
];

const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies'];
const RELEASE_DEPENDENCY_FIELDS = [...RUNTIME_DEPENDENCY_FIELDS, 'peerDependencies'];

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function packageDirectories(root, parent, depth) {
    if (depth === 0) return fs.existsSync(path.join(parent, 'package.json')) ? [parent] : [];
    if (!fs.existsSync(parent)) return [];
    return fs
        .readdirSync(parent, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .flatMap((entry) => packageDirectories(root, path.join(parent, entry.name), depth - 1));
}

export function discoverPublishablePackages(root = process.cwd()) {
    const directories = WORKSPACE_LAYOUT.flatMap(([directory, depth]) => packageDirectories(root, path.join(root, directory), depth));
    const packages = directories
        .map((directory) => {
            const manifestPath = path.join(directory, 'package.json');
            const manifest = readJson(manifestPath);
            return {
                name: manifest.name,
                version: manifest.version,
                path: path.relative(root, directory).split(path.sep).join('/'),
                manifestPath: path.relative(root, manifestPath).split(path.sep).join('/'),
                manifest,
            };
        })
        .filter((candidate) => candidate.manifest.private !== true);

    const byName = new Map();
    for (const candidate of packages) {
        if (!candidate.name || !candidate.version) throw new Error(`${candidate.manifestPath}: publishable packages require name and version.`);
        if (byName.has(candidate.name)) throw new Error(`Duplicate publishable workspace package name: ${candidate.name}.`);
        if (candidate.manifest.repository !== WORKSPACE_REPOSITORY) {
            throw new Error(
                `${candidate.manifestPath}: repository must be ${WORKSPACE_REPOSITORY} for npm Trusted Publishing, got ` +
                    `${JSON.stringify(candidate.manifest.repository)}.`,
            );
        }
        byName.set(candidate.name, candidate);
    }

    for (const candidate of packages) {
        candidate.localDependencies = Object.fromEntries(
            RELEASE_DEPENDENCY_FIELDS.flatMap((field) =>
                Object.entries(candidate.manifest[field] ?? {})
                    .filter(([name]) => byName.has(name))
                    .map(([name, range]) => [name, { range, field }]),
            ),
        );
        candidate.runtimeLocalDependencies = [
            ...new Set(RUNTIME_DEPENDENCY_FIELDS.flatMap((field) => Object.keys(candidate.manifest[field] ?? {}).filter((name) => byName.has(name)))),
        ];
        candidate.publishLocalDependencies = [...candidate.runtimeLocalDependencies];
        candidate.policy = semverChannelPolicy(candidate.version);
        candidate.gitTag = `${candidate.name}@${candidate.version}`;
        candidate.buildKind = classifyBuild(candidate);
    }
    const generator = byName.get('create-crossbind');
    if (generator) {
        const templateManifest = readJson(path.join(root, generator.path, 'src', 'manifest.json'));
        for (const entry of templateManifest) {
            const sourceManifest = readJson(path.join(root, entry.source, 'package.json'));
            for (const field of RELEASE_DEPENDENCY_FIELDS) {
                for (const [name, range] of Object.entries(sourceManifest[field] ?? {})) {
                    if (!byName.has(name)) continue;
                    generator.localDependencies[name] = { range, field: `template.${entry.key}.${field}` };
                    if (!generator.publishLocalDependencies.includes(name)) generator.publishLocalDependencies.push(name);
                }
            }
        }
        generator.publishLocalDependencies.sort();
    }
    return packages.sort((left, right) => left.name.localeCompare(right.name));
}

export function fixedWorkspaceVersion(packages) {
    const versions = new Map();
    for (const candidate of packages) {
        const names = versions.get(candidate.version) ?? [];
        names.push(candidate.name);
        versions.set(candidate.version, names);
    }
    if (versions.size !== 1) {
        const details = [...versions]
            .sort(([left], [right]) => compareSupportedVersions(left, right))
            .map(([version, names]) => `${version}: ${names.length} package(s) (${names.slice(0, 5).join(', ')}${names.length > 5 ? ', ...' : ''})`)
            .join('\n- ');
        throw new Error(
            `Fixed-version policy requires every publishable workspace package to have one version. Found:\n- ${details}\n` +
                'Choose a version newer than every existing package and run pnpm release:version -- --version <version> --apply.',
        );
    }
    return versions.keys().next().value;
}

export function classifyBuild(candidate) {
    const lifecycle = candidate.manifest.scripts?.prepublishOnly;
    if (!lifecycle) return 'linux';
    if (candidate.path === 'examples/lib-prebuilt-matrix' && lifecycle.trim() === 'crossbind build') return 'multi-platform';
    if (/\bcrossbind\s+build\b[^\n]*\s-p\s+ios(?:\s|$)/.test(lifecycle)) return 'macos';
    if (/\bcrossbind\s+build\b[^\n]*\s-p\s+android(?:\s|$)/.test(lifecycle)) return 'android';
    if (/\bcrossbind\s+build\b[^\n]*\s-p\s+wasi(?:\s|$)/.test(lifecycle)) return 'wasi';
    if (/\bcrossbind\s+build\b[^\n]*\s-p\s+wasm(?:\s|$)/.test(lifecycle)) return 'wasm';
    if (/\bcrossbind\s+build\b/.test(lifecycle) && !/\s-p\s+(?:wasm|wasi|android)(?:\s|$)/.test(lifecycle)) {
        throw new Error(
            `${candidate.manifestPath}: unclassified crossbind build lifecycle ${JSON.stringify(lifecycle)}. ` +
                'Declare an explicit platform or add a reviewed multi-platform assembly rule.',
        );
    }
    return 'linux';
}

function semverParts(version) {
    semverChannelPolicy(version);
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([^.]+)\.(\d+))?(?:\+.*)?$/.exec(version);
    if (!match) throw new Error(`Cannot compare unsupported semantic version ${version}.`);
    return {
        core: match.slice(1, 4).map(Number),
        prerelease: match[4] ? [match[4], Number(match[5])] : null,
    };
}

export function compareSupportedVersions(left, right) {
    const a = semverParts(left);
    const b = semverParts(right);
    for (let index = 0; index < 3; index += 1) {
        if (a.core[index] !== b.core[index]) return Math.sign(a.core[index] - b.core[index]);
    }
    if (a.prerelease === null || b.prerelease === null) {
        if (a.prerelease === b.prerelease) return 0;
        return a.prerelease === null ? 1 : -1;
    }
    const rank = { beta: 0, rc: 1 };
    if (rank[a.prerelease[0]] !== rank[b.prerelease[0]]) return Math.sign(rank[a.prerelease[0]] - rank[b.prerelease[0]]);
    return Math.sign(a.prerelease[1] - b.prerelease[1]);
}

function topologicalOrder(packages, selectedNames) {
    const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
    const selected = new Set(selectedNames);
    const remaining = new Set(selectedNames);
    const complete = new Set();
    const result = [];
    while (remaining.size) {
        const ready = [...remaining]
            .filter((name) =>
                byName
                    .get(name)
                    .publishLocalDependencies.filter((dependency) => selected.has(dependency))
                    .every((dependency) => complete.has(dependency)),
            )
            .sort((left, right) => {
                if (left === 'crossbind') return -1;
                if (right === 'crossbind') return 1;
                return left.localeCompare(right);
            });
        if (!ready.length) throw new Error(`Workspace release dependency graph contains a cycle: ${[...remaining].sort().join(', ')}.`);
        for (const name of ready) {
            remaining.delete(name);
            complete.add(name);
            result.push(name);
        }
    }
    return result;
}

function dependencyClosure(packages, candidateNames, { publish = false } = {}) {
    const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
    const closure = new Set(candidateNames);
    const pending = [...candidateNames];
    while (pending.length) {
        const current = byName.get(pending.pop());
        const dependencies = publish ? current.publishLocalDependencies : current.runtimeLocalDependencies;
        for (const dependency of dependencies) {
            if (!closure.has(dependency)) {
                closure.add(dependency);
                pending.push(dependency);
            }
        }
    }
    return closure;
}

function walkFiles(directory, predicate) {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(target, predicate));
        else if (predicate(target)) files.push(target);
    }
    return files;
}

function validateStableConsumerSurfaces(root) {
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    if (/(?:@beta|@next)\b/.test(readme)) {
        throw new Error('README.md still requires the beta/next npm channel; update stable install commands before publication.');
    }
    const manifests = walkFiles(path.join(root, 'tooling', 'create-app', 'templates'), (file) =>
        ['package.json', 'package-lock.json'].includes(path.basename(file)),
    );
    const problems = [];
    const visit = (value, key, source) => {
        if (typeof value === 'string' && (key === 'crossbind' || key.startsWith('@crossbind/')) && /-(?:beta|rc)\./.test(value)) {
            problems.push(`${path.relative(root, source)}: ${key}=${value}`);
        } else if (value && typeof value === 'object') {
            for (const [childKey, child] of Object.entries(value)) visit(child, childKey, source);
        }
    };
    for (const source of manifests) visit(readJson(source), '', source);
    if (problems.length) {
        throw new Error(`create-crossbind templates still require prerelease Crossbind packages:\n- ${problems.join('\n- ')}`);
    }
}

export function provenanceCommitFromBundle(bundle, packageName, version) {
    const encodedName = packageName.startsWith('@') ? `%40${packageName.slice(1)}` : packageName;
    const expectedSubject = `pkg:npm/${encodedName}@${version}`;
    for (const attestation of bundle?.attestations ?? []) {
        const payload = attestation?.bundle?.dsseEnvelope?.payload;
        if (!payload) continue;
        try {
            const statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
            if (statement.predicateType !== 'https://slsa.dev/provenance/v1') continue;
            if (!statement.subject?.some((subject) => subject.name === expectedSubject)) continue;
            const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
            if (workflow?.repository !== 'https://github.com/crossbind/crossbind' || workflow?.path !== WORKSPACE_RELEASE_WORKFLOW) continue;
            const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.find((item) =>
                /^[0-9a-f]{40}$/.test(item?.digest?.gitCommit),
            );
            if (dependency) return dependency.digest.gitCommit;
        } catch {
            // A malformed or unrelated public attestation is not accepted as a resumable train.
        }
    }
    return null;
}

export class PublicNpmWorkspaceRegistry {
    constructor({ registry = 'https://registry.npmjs.org' } = {}) {
        this.registry = registry.replace(/\/$/, '');
    }

    async packageDocument(packageName) {
        const response = await fetch(`${this.registry}/${encodeURIComponent(packageName)}`);
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Cannot read npm metadata for ${packageName}: HTTP ${response.status}.`);
        return response.json();
    }

    async status(candidate, gitCommit) {
        const document = await this.packageDocument(candidate.name);
        const version = document?.versions?.[candidate.version] ?? null;
        const channelVersion = document?.['dist-tags']?.[candidate.policy.npmDistTag] ?? null;
        let provenanceCommit = null;
        const attestationUrl = version?.dist?.attestations?.url;
        if (attestationUrl) {
            const target = new URL(attestationUrl);
            if (target.origin !== new URL(this.registry).origin || !target.pathname.startsWith('/-/npm/v1/attestations/')) {
                throw new Error(`${candidate.name}@${candidate.version}: npm returned an unexpected attestation URL ${attestationUrl}.`);
            }
            const response = await fetch(target);
            if (response.ok) provenanceCommit = provenanceCommitFromBundle(await response.json(), candidate.name, candidate.version);
            else if (response.status !== 404) throw new Error(`Cannot read npm attestation for ${candidate.name}: HTTP ${response.status}.`);
        }
        return {
            exactVersion: version ? candidate.version : null,
            channelVersion,
            provenanceCommit,
            integrity: version?.dist?.integrity ?? null,
            gitCommit,
        };
    }
}

function publicPackage(candidate) {
    return {
        name: candidate.name,
        version: candidate.version,
        path: candidate.path,
        manifestPath: candidate.manifestPath,
        channel: candidate.policy.channel,
        npmDistTag: candidate.policy.npmDistTag,
        prerelease: candidate.policy.prerelease,
        gitTag: candidate.gitTag,
        buildKind: candidate.buildKind,
        prepublishOnly: candidate.manifest.scripts?.prepublishOnly ?? null,
        localDependencies: candidate.localDependencies,
        runtimeLocalDependencies: candidate.runtimeLocalDependencies,
        publishLocalDependencies: candidate.publishLocalDependencies,
        reason: candidate.reason ?? null,
    };
}

export async function buildWorkspaceReleasePlan({
    root = process.cwd(),
    channel,
    gitCommit,
    registry = new PublicNpmWorkspaceRegistry(),
    log = () => {},
} = {}) {
    if (!['beta', 'rc', 'stable'].includes(channel)) throw new Error(`Release channel must be beta, rc or stable; got ${channel ?? '(missing)'}.`);
    if (!/^[0-9a-f]{40}$/.test(gitCommit ?? '')) throw new Error('A full 40-character release commit SHA is required.');

    const packages = discoverPublishablePackages(root);
    const workspaceVersion = fixedWorkspaceVersion(packages);
    const workspacePolicy = semverChannelPolicy(workspaceVersion);
    if (workspacePolicy.channel !== channel) {
        throw new Error(
            `Fixed workspace version ${workspaceVersion} belongs to ${workspacePolicy.channel}, but this train was dispatched for ${channel}.`,
        );
    }
    const statuses = new Map();
    const concurrency = 8;
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(concurrency, packages.length) }, async () => {
            while (next < packages.length) {
                const candidate = packages[next++];
                statuses.set(candidate.name, await registry.status(candidate, gitCommit));
            }
        }),
    );

    const candidates = [];
    for (const candidate of packages) {
        const status = statuses.get(candidate.name);
        let reason = null;
        if (!status.channelVersion) reason = 'new-package';
        else {
            const comparison = compareSupportedVersions(candidate.version, status.channelVersion);
            if (comparison < 0) {
                throw new Error(
                    `${candidate.manifestPath}: ${candidate.name}@${candidate.version} is older than npm ` +
                        `${candidate.policy.npmDistTag}=${status.channelVersion}. Bump the package instead of moving a channel backwards.`,
                );
            }
            if (comparison > 0) reason = 'version-bump';
            else if (status.provenanceCommit === gitCommit) reason = 'resume';
        }
        if (!reason) continue;
        if (candidate.policy.channel !== channel) {
            throw new Error(
                `${candidate.manifestPath}: ${candidate.name}@${candidate.version} needs publication on ${candidate.policy.channel}, ` +
                    `but this train was dispatched for ${channel}. Keep one semantic channel per release train.`,
            );
        }
        candidates.push({ ...candidate, reason, registry: status });
    }

    if (candidates.length > 0 && candidates.length !== packages.length) {
        const selectedNames = new Set(candidates.map((candidate) => candidate.name));
        const historical = packages.filter((candidate) => !selectedNames.has(candidate.name)).map((candidate) => candidate.name);
        throw new Error(
            `Fixed ${workspaceVersion} train would publish only ${candidates.length}/${packages.length} packages. ` +
                `The same version already belongs to another release commit for: ${historical.slice(0, 8).join(', ')}` +
                `${historical.length > 8 ? ', ...' : ''}. Bump every public package to a new fixed version.`,
        );
    }

    const candidateNames = new Set(candidates.map((candidate) => candidate.name));
    if (candidateNames.has('crossbind')) loadReleaseNotes(root, packages.find((candidate) => candidate.name === 'crossbind').version);
    for (const candidate of candidates) {
        for (const [dependencyName, declaration] of Object.entries(candidate.localDependencies)) {
            const dependency = packages.find((item) => item.name === dependencyName);
            const dependencyStatus = statuses.get(dependencyName);
            if (!candidateNames.has(dependencyName) && dependencyStatus.exactVersion !== dependency.version) {
                throw new Error(
                    `${candidate.name}@${candidate.version} ${declaration.field} requires workspace ${dependencyName}@${dependency.version}, ` +
                        'but that exact dependency is neither published nor included in this train.',
                );
            }
            if (candidate.policy.channel === 'stable' && dependency.policy.prerelease) {
                throw new Error(
                    `Stable ${candidate.name}@${candidate.version} cannot depend on prerelease workspace package ` +
                        `${dependencyName}@${dependency.version} (${declaration.field}).`,
                );
            }
        }
    }

    if (channel === 'stable' && candidates.length) {
        validateStableConsumerSurfaces(root);
        const stableEntrypointsPath = path.join(root, STABLE_ENTRYPOINTS_SOURCE);
        if (!fs.existsSync(stableEntrypointsPath)) throw new Error(`Missing stable product closure: ${STABLE_ENTRYPOINTS_SOURCE}.`);
        const stableConfiguration = readJson(stableEntrypointsPath);
        if (stableConfiguration?.schemaVersion !== 1) throw new Error(`${STABLE_ENTRYPOINTS_SOURCE}: unsupported schemaVersion.`);
        const stableEntrypoints = stableConfiguration.packages;
        if (!Array.isArray(stableEntrypoints) || !stableEntrypoints.length || new Set(stableEntrypoints).size !== stableEntrypoints.length) {
            throw new Error(`${STABLE_ENTRYPOINTS_SOURCE}: packages must be a non-empty unique array.`);
        }
        const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
        for (const name of stableEntrypoints) {
            if (!byName.has(name)) throw new Error(`${STABLE_ENTRYPOINTS_SOURCE}: unknown publishable package ${name}.`);
        }
        const stableClosure = dependencyClosure(packages, stableEntrypoints, { publish: true });
        for (const name of stableClosure) {
            const candidate = byName.get(name);
            if (candidate.policy.prerelease) {
                throw new Error(`Stable product closure requires ${name}, but its local version is prerelease ${candidate.version}.`);
            }
            if (!candidateNames.has(name) && statuses.get(name).exactVersion !== candidate.version) {
                throw new Error(`Stable product closure requires unpublished ${name}@${candidate.version}, but it is not in this train.`);
            }
        }
    }

    const publishOrder = topologicalOrder(packages, candidateNames);
    const buildClosure = dependencyClosure(packages, candidateNames);
    const orderedClosure = topologicalOrder(packages, buildClosure);
    const byName = new Map(packages.map((candidate) => [candidate.name, candidate]));
    const buildOrderByRunner = Object.fromEntries(
        ['linux', 'wasm', 'android', 'wasi', 'macos'].map((runner) => [
            runner,
            orderedClosure.filter(
                (name) => byName.get(name).buildKind === runner && (candidateNames.has(name) || byName.get(name).manifest.scripts?.prepublishOnly),
            ),
        ]),
    );
    const multiPlatform = orderedClosure.filter((name) => byName.get(name).buildKind === 'multi-platform');

    for (const candidate of candidates) {
        log(
            `${candidate.reason === 'resume' ? 'resume' : 'publish'} ${candidate.name}@${candidate.version}: ` +
                `${candidate.policy.channel}/${candidate.policy.npmDistTag}, build=${candidate.buildKind}`,
        );
    }
    if (!candidates.length) log(`No ${channel} package versions require publication.`);

    return {
        schemaVersion: WORKSPACE_RELEASE_SCHEMA_VERSION,
        gitCommit,
        channel,
        workspaceVersion,
        packageCount: candidates.length,
        publishOrder,
        buildOrderByRunner,
        linuxShards: ['linux', 'wasm', 'android', 'wasi'].filter(
            (runner) => buildOrderByRunner[runner].length > 0 || (runner !== 'linux' && multiPlatform.length > 0),
        ),
        multiPlatform,
        packages: candidates.map(publicPackage),
        workspacePackages: Object.fromEntries(packages.map((candidate) => [candidate.name, publicPackage(candidate)])),
    };
}

export function validateWorkspaceReleasePlan(plan, { root } = {}) {
    if (plan?.schemaVersion !== WORKSPACE_RELEASE_SCHEMA_VERSION) throw new Error('Unsupported workspace release-plan schema.');
    if (!/^[0-9a-f]{40}$/.test(plan.gitCommit ?? '')) throw new Error('Workspace release plan has no full git commit.');
    if (!['beta', 'rc', 'stable'].includes(plan.channel)) throw new Error('Workspace release plan has an invalid channel.');
    if (semverChannelPolicy(plan.workspaceVersion).channel !== plan.channel) {
        throw new Error('Workspace release plan fixed version does not match its channel.');
    }
    if (!Array.isArray(plan.packages) || plan.packageCount !== plan.packages.length)
        throw new Error('Workspace release plan package count conflicts.');
    const names = new Set(plan.packages.map((candidate) => candidate.name));
    if (names.size !== plan.packages.length) throw new Error('Workspace release plan contains duplicate packages.');
    if (plan.publishOrder.length !== names.size || !plan.publishOrder.every((name) => names.has(name))) {
        throw new Error('Workspace release plan publish order does not exactly cover the candidate packages.');
    }
    for (const runner of ['linux', 'wasm', 'android', 'wasi', 'macos']) {
        if (!Array.isArray(plan.buildOrderByRunner?.[runner])) throw new Error(`Workspace release plan has no ${runner} build order.`);
    }
    if (!Array.isArray(plan.linuxShards) || !Array.isArray(plan.multiPlatform)) {
        throw new Error('Workspace release plan platform shards are malformed.');
    }
    if (root) {
        const canonical = discoverPublishablePackages(root);
        if (fixedWorkspaceVersion(canonical) !== plan.workspaceVersion) {
            throw new Error('Workspace release plan fixed version does not match the release checkout.');
        }
        const plannedNames = Object.keys(plan.workspacePackages ?? {}).sort();
        const canonicalNames = canonical.map((candidate) => candidate.name).sort();
        if (JSON.stringify(plannedNames) !== JSON.stringify(canonicalNames)) {
            throw new Error('Workspace release plan package inventory does not match the release checkout.');
        }
        for (const candidate of canonical) {
            const planned = plan.workspacePackages[candidate.name];
            const expected = publicPackage(candidate);
            for (const field of [
                'name',
                'version',
                'path',
                'manifestPath',
                'channel',
                'npmDistTag',
                'prerelease',
                'gitTag',
                'buildKind',
                'prepublishOnly',
            ]) {
                if (planned?.[field] !== expected[field]) {
                    throw new Error(`Workspace release plan ${candidate.name}.${field} does not match the release checkout.`);
                }
            }
        }
        const expectedPublishOrder = topologicalOrder(canonical, names);
        const closure = dependencyClosure(canonical, names);
        const expectedClosure = topologicalOrder(canonical, closure);
        const byName = new Map(canonical.map((candidate) => [candidate.name, candidate]));
        const expectedBuildOrder = Object.fromEntries(
            ['linux', 'wasm', 'android', 'wasi', 'macos'].map((runner) => [
                runner,
                expectedClosure.filter(
                    (name) => byName.get(name).buildKind === runner && (names.has(name) || byName.get(name).manifest.scripts?.prepublishOnly),
                ),
            ]),
        );
        const expectedMulti = expectedClosure.filter((name) => byName.get(name).buildKind === 'multi-platform');
        const expectedLinuxShards = ['linux', 'wasm', 'android', 'wasi'].filter(
            (runner) => expectedBuildOrder[runner].length > 0 || (runner !== 'linux' && expectedMulti.length > 0),
        );
        if (
            JSON.stringify(plan.publishOrder) !== JSON.stringify(expectedPublishOrder) ||
            JSON.stringify(plan.buildOrderByRunner) !== JSON.stringify(expectedBuildOrder) ||
            JSON.stringify(plan.multiPlatform) !== JSON.stringify(expectedMulti) ||
            JSON.stringify(plan.linuxShards) !== JSON.stringify(expectedLinuxShards)
        ) {
            throw new Error('Workspace release plan dependency or platform order does not match the release checkout.');
        }
    }
    return plan;
}
