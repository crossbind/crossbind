#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    COMMIT_RE,
    SHA1_RE,
    assertVersion,
    compareVersions,
    dockerHubDigest,
    encodeProposal,
    fetchJson,
    fetchText,
    fetchWithRetry,
    githubCommitForRef,
    githubLatestStableRelease,
    matchOne,
    proposalId,
    readText,
    sha256Url,
    updateRisk,
} from './dependency-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.env.CROSSBIND_DEPENDENCY_ROOT ?? path.resolve(SCRIPT_DIR, '../..'));
const POLICY_PATH = path.join(SCRIPT_DIR, 'update-policy.json');

function option(name, fallback = null) {
    const index = process.argv.indexOf(name);
    return index === -1 ? fallback : process.argv[index + 1];
}

export function dockerFrom(text, image, label) {
    const escaped = image.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = matchOne(text, new RegExp(`^FROM ${escaped}:([^@\\s]+)@(sha256:[0-9a-f]{64})(?:\\s+AS\\s+\\w+)?$`, 'gim'), label);
    return { tag: match[1], digest: match[2], full: match[0] };
}

export function parseRustStableToml(text) {
    const match = /\[pkg\.rust\][\s\S]*?^version\s*=\s*"(\d+\.\d+\.\d+)\s+\([^\n]+"$/m.exec(text);
    if (!match) throw new Error('Rust stable channel did not contain a pkg.rust version.');
    return assertVersion(match[1], 'Rust stable version');
}

function xmlValue(body, name) {
    return new RegExp(`<${name}[^>]*>([^<]+)</${name}>`).exec(body)?.[1]?.trim() ?? null;
}

function revisionOf(body) {
    const revision = /<revision>([\s\S]*?)<\/revision>/.exec(body)?.[1] ?? '';
    const major = Number(xmlValue(revision, 'major') ?? 0);
    const minor = Number(xmlValue(revision, 'minor') ?? 0);
    const micro = Number(xmlValue(revision, 'micro') ?? 0);
    const preview = xmlValue(revision, 'preview');
    return { major, minor, micro, preview, version: `${major}.${minor}.${micro}` };
}

export function parseAndroidRepository(xml) {
    const entries = [...xml.matchAll(/<remotePackage\s+path="([^"]+)"[^>]*>([\s\S]*?)<\/remotePackage>/g)].map((match) => ({
        path: match[1],
        body: match[2],
        revision: revisionOf(match[2]),
    }));

    const commandLineTools = entries
        .filter((entry) => /^cmdline-tools;\d/.test(entry.path) && !entry.revision.preview)
        .map((entry) => {
            const archives = [...entry.body.matchAll(/<archive>([\s\S]*?)<\/archive>/g)].map((match) => match[1]);
            const linux = archives.find((archive) => xmlValue(archive, 'host-os') === 'linux');
            if (!linux) return null;
            const url = xmlValue(linux, 'url');
            const sha1 = /<checksum[^>]*type="sha-?1"[^>]*>([0-9a-f]{40})<\/checksum>/i.exec(linux)?.[1]?.toLowerCase();
            if (!url || !SHA1_RE.test(sha1 ?? '')) return null;
            const build = /commandlinetools-linux-(\d+)_latest\.zip/.exec(url)?.[1];
            if (!build) return null;
            return { revision: entry.revision.version, build, file: url, sha1 };
        })
        .filter(Boolean)
        .sort((a, b) => compareVersions(b.revision, a.revision));

    const ndks = entries
        .filter((entry) => entry.path.startsWith('ndk;') && !entry.revision.preview)
        .map((entry) => ({ version: entry.path.slice(4), revision: entry.revision }))
        .filter((entry) => /^\d+\.\d+\.\d+$/.test(entry.version))
        .sort((a, b) => compareVersions(b.version, a.version));

    if (!commandLineTools[0]) throw new Error('Android repository XML contained no stable Linux command-line tools archive.');
    if (!ndks[0]) throw new Error('Android repository XML contained no stable NDK.');
    return { commandLineTools: commandLineTools[0], ndks };
}

function currentArg(text, name, label) {
    return matchOne(text, new RegExp(`^(?:ARG|ENV) ${name}=([^\\s]+)$`, 'gm'), label)[1];
}

function addVersionProposal(proposals, proposal) {
    if (compareVersions(proposal.target, proposal.current) <= 0 && proposal.currentDigest === proposal.targetDigest) return;
    proposals.push({
        ...proposal,
        id: proposal.id ?? proposalId(proposal.kind, proposal.component ?? proposal.unit, proposal.target, proposal.targetDigest?.slice(7, 19) ?? ''),
        risk: proposal.risk ?? updateRisk(proposal.current, proposal.target),
        macos: Boolean(proposal.macos),
    });
}

function runNativeInventory(root, output) {
    execFileSync(process.execPath, [path.join(root, 'scripts/check-native-versions.js'), '--json', output], {
        cwd: root,
        stdio: ['ignore', 'ignore', 'inherit'],
        env: process.env,
    });
    return JSON.parse(fs.readFileSync(output, 'utf8'));
}

async function planNode(root, policy, proposals, dependencies) {
    const current = readText(root, '.nvmrc').trim().replace(/^v/, '');
    const releases = await (dependencies.fetchJson ?? ((url) => fetchJson(url, {}, dependencies)))('https://nodejs.org/dist/index.json');
    const target = releases
        .filter((release) => release.lts && /^v\d+\.\d+\.\d+$/.test(release.version))
        .map((release) => release.version.slice(1))
        .sort((a, b) => compareVersions(b, a))[0];
    if (!target) throw new Error('Node release index contained no LTS release.');
    const from = dockerFrom(readText(root, 'tooling/docker/base.Dockerfile'), 'node', 'Node Docker image');
    const targetTag = `${target}${policy.dockerSuffix}`;
    const targetDigest = await dockerHubDigest(policy.dockerImage, targetTag, dependencies);
    addVersionProposal(proposals, {
        kind: 'toolchain',
        component: 'node',
        current,
        target,
        currentDigest: from.digest,
        targetDigest,
        targetTag,
        sourceUrl: 'https://nodejs.org/en/about/previous-releases',
        reason: current === target ? 'digest-refresh' : 'new-lts',
        macos: true,
    });
}

async function planRust(root, policy, proposals, dependencies) {
    const base = readText(root, 'tooling/docker/base.Dockerfile');
    const current = currentArg(base, 'RUST_VERSION', 'base Rust version');
    const channel = await (dependencies.fetchText ?? ((url) => fetchText(url, {}, dependencies)))(
        'https://static.rust-lang.org/dist/channel-rust-stable.toml',
    );
    const target = parseRustStableToml(channel);
    const from = dockerFrom(base, 'rust', 'Rust bootstrap Docker image');
    const targetDigest = await dockerHubDigest(policy.bootstrapDockerImage, from.tag, dependencies);
    addVersionProposal(proposals, {
        kind: 'toolchain',
        component: 'rust',
        current,
        target,
        currentDigest: from.digest,
        targetDigest,
        bootstrapTag: from.tag,
        sourceUrl: 'https://www.rust-lang.org/tools/install',
        reason: current === target ? 'digest-refresh' : 'new-stable',
    });
}

async function planEmscripten(root, policy, proposals, blockers, dependencies) {
    const web = readText(root, 'tooling/docker/web.Dockerfile');
    const current = currentArg(web, 'EMSDK_VERSION', 'Emscripten version');
    const { version: target, release } = await githubLatestStableRelease(
        policy.upstreamRepository,
        (tag) => /^(\d+\.\d+\.\d+)$/.exec(tag)?.[1] ?? null,
        dependencies,
    );
    const from = dockerFrom(web.replace(/\$\{EMSDK_VERSION\}/g, current), policy.dockerImage, 'Emscripten Docker image');
    const targetDigest = await dockerHubDigest(policy.dockerImage, target, dependencies);
    if (target === current) {
        addVersionProposal(proposals, {
            kind: 'toolchain',
            component: 'emscripten',
            current,
            target,
            currentDigest: from.digest,
            targetDigest,
            forkRevision: currentArg(web, 'CROSSBIND_EMSCRIPTEN_REV', 'Crossbind Emscripten revision'),
            embindSha256: currentArg(web, 'CROSSBIND_EMBIND_SHA256', 'Crossbind libembind hash'),
            sourceUrl: release.html_url,
            reason: 'digest-refresh',
            risk: 'digest',
        });
        return;
    }
    const forkRef = `tags/${policy.forkTagPrefix}${target}`;
    try {
        const forkRevision = await githubCommitForRef(policy.forkRepository, forkRef, dependencies);
        const embindUrl = `https://raw.githubusercontent.com/${policy.forkRepository}/${forkRevision}/src/lib/libembind.js`;
        const embindSha256 = await sha256Url(embindUrl, dependencies);
        addVersionProposal(proposals, {
            kind: 'toolchain',
            component: 'emscripten',
            current,
            target,
            currentDigest: from.digest,
            targetDigest,
            forkRevision,
            embindSha256,
            sourceUrl: release.html_url,
            reason: 'new-stable-with-reviewed-fork',
        });
    } catch (error) {
        blockers.push({
            component: 'emscripten',
            current,
            target,
            reason: `Create ${policy.forkRepository} tag ${policy.forkTagPrefix}${target} after rebasing libembind.js: ${error.message}`,
            sourceUrl: release.html_url,
        });
    }
}

async function planWasi(root, policy, proposals, dependencies) {
    const current = currentArg(readText(root, 'tooling/docker/web.Dockerfile'), 'WASI_SDK_VERSION', 'wasi-sdk version');
    const { version: target, release } = await githubLatestStableRelease(
        policy.repository,
        (tag) => new RegExp(`^${policy.tagPrefix}(\\d+)$`).exec(tag)?.[1] ?? null,
        dependencies,
    );
    addVersionProposal(proposals, {
        kind: 'toolchain',
        component: 'wasi-sdk',
        current,
        target,
        sourceUrl: release.html_url,
        reason: 'new-stable',
    });
}

async function planAndroid(root, policy, proposals, blockers, dependencies) {
    const xml = await (dependencies.fetchText ?? ((url) => fetchText(url, {}, dependencies)))(policy.repositoryXml);
    const repository = parseAndroidRepository(xml);
    const android = readText(root, 'tooling/docker/android.Dockerfile');
    const currentToolsFile = currentArg(android, 'CMDLINE_TOOLS', 'Android command-line tools archive');
    const currentTools = /commandlinetools-linux-(\d+)_latest\.zip/.exec(currentToolsFile)?.[1];
    if (!currentTools) throw new Error('Current Android command-line tools archive is not recognized.');
    addVersionProposal(proposals, {
        kind: 'toolchain',
        component: 'android-command-line-tools',
        current: currentTools,
        target: repository.commandLineTools.build,
        archive: repository.commandLineTools.file,
        sha1: repository.commandLineTools.sha1,
        sourceUrl: policy.repositoryXml,
        reason: 'new-stable',
    });

    const currentNdk = currentArg(android, 'NDK_VERSION', 'Android NDK version');
    const sameMajor = repository.ndks.find((entry) => Number(entry.version.split('.')[0]) === policy.ndkTrackMajor);
    if (sameMajor) {
        addVersionProposal(proposals, {
            kind: 'toolchain',
            component: 'android-ndk',
            current: currentNdk,
            target: sameMajor.version,
            sourceUrl: 'https://developer.android.com/ndk/downloads/revision_history',
            reason: 'new-stable-in-reviewed-major',
        });
    }
    const newest = repository.ndks[0];
    if (Number(newest.version.split('.')[0]) > policy.ndkTrackMajor) {
        blockers.push({
            component: 'android-ndk-major',
            current: currentNdk,
            target: newest.version,
            reason: `NDK major ${newest.version.split('.')[0]} is available; policy intentionally tracks reviewed major ${policy.ndkTrackMajor}.`,
            sourceUrl: 'https://developer.android.com/ndk/downloads/revision_history',
        });
    }
}

async function planSwig(root, policy, proposals, dependencies) {
    const base = readText(root, 'tooling/docker/base.Dockerfile');
    const current = currentArg(base, 'SWIG_REV', 'Crossbind SWIG revision');
    if (!COMMIT_RE.test(current)) throw new Error('Current Crossbind SWIG revision is not a full commit SHA.');
    const target = await githubCommitForRef(policy.repository, `heads/${policy.branch}`, dependencies);
    if (target !== current) {
        proposals.push({
            id: proposalId('toolchain', 'swig', target.slice(0, 12)),
            kind: 'toolchain',
            component: 'swig',
            valueType: 'commit',
            current,
            target,
            sourceUrl: `https://github.com/${policy.repository}/compare/${current}...${target}`,
            reason: 'reviewed-fork-advanced',
            risk: 'source',
            macos: false,
        });
    }
}

function planNative(inventory, proposals, blockers) {
    const byFamily = new Map();
    for (const row of inventory.rows) {
        if (!byFamily.has(row.library)) byFamily.set(row.library, []);
        byFamily.get(row.library).push(row);
    }
    for (const [family, rows] of byFamily) {
        const statuses = new Set(rows.map((row) => row.status));
        if (statuses.has('unknown')) {
            blockers.push({
                component: `native-${family}`,
                current: rows[0].nativeVersion,
                target: 'unknown',
                reason: rows.find((row) => row.error)?.error ?? 'Upstream version could not be resolved.',
                sourceUrl: rows[0].homepage,
            });
            continue;
        }
        const outdated = rows.find((row) => row.status === 'outdated');
        if (!outdated) continue;
        addVersionProposal(proposals, {
            kind: 'native',
            unit: family,
            current: outdated.nativeVersion,
            target: outdated.latestVersion,
            sourceUrl: outdated.homepage,
            reason: 'new-upstream-stable',
            macos: rows.some((row) => row.path.includes('/ios/')),
        });
    }
}

export function nativeTag(identity, version) {
    return identity.tag.replaceAll('{version}', version).replaceAll('{versionUnderscore}', version.replaceAll('.', '_'));
}

async function osvCommitVulnerabilities(commit, dependencies) {
    const response = await fetchWithRetry(
        'https://api.osv.dev/v1/query',
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ commit }),
        },
        dependencies,
    );
    const result = await response.json();
    return (result.vulns ?? []).filter((vulnerability) => !vulnerability.withdrawn);
}

async function planNativeSecurity(inventory, policy, proposals, blockers, errors, dependencies) {
    const resolveCommit = dependencies.githubCommitForRef ?? githubCommitForRef;
    const queryCommit = dependencies.osvCommitVulnerabilities ?? osvCommitVulnerabilities;
    const removeProposal = (library) => {
        const index = proposals.findIndex((entry) => entry.kind === 'native' && entry.unit === library);
        if (index !== -1) proposals.splice(index, 1);
    };
    const rows = [...new Map(inventory.rows.map((row) => [row.library, row])).values()];
    await Promise.all(
        rows.map(async (row) => {
            const identity = policy[row.library];
            if (!identity || identity.manual) {
                removeProposal(row.library);
                blockers.push({
                    component: `native-security-${row.library}`,
                    current: row.nativeVersion,
                    target: 'manual-review',
                    reason: identity?.reason ?? 'No reviewed OSV commit identity is configured.',
                    sourceUrl: row.homepage,
                });
                return;
            }
            try {
                const currentTag = nativeTag(identity, row.nativeVersion);
                const currentCommit = await resolveCommit(identity.repository, `tags/${currentTag}`, dependencies);
                const vulnerabilities = await queryCommit(currentCommit, dependencies);
                if (vulnerabilities.length === 0) return;
                const proposal = proposals.find((entry) => entry.kind === 'native' && entry.unit === row.library);
                const advisoryIds = vulnerabilities.map((entry) => entry.id).sort();
                if (proposal) {
                    const targetTag = nativeTag(identity, proposal.target);
                    const targetCommit = await resolveCommit(identity.repository, `tags/${targetTag}`, dependencies);
                    const targetVulnerabilities = await queryCommit(targetCommit, dependencies);
                    if (targetVulnerabilities.length === 0) {
                        proposal.risk = 'security';
                        proposal.advisories = advisoryIds;
                        proposal.reason = 'security-fix-and-new-upstream-stable';
                        return;
                    }
                }
                blockers.push({
                    component: `native-security-${row.library}`,
                    current: row.nativeVersion,
                    target: proposal?.target ?? 'no-fixed-release',
                    reason: `OSV reports the pinned commit as affected: ${advisoryIds.join(', ')}. No checked clean target is available.`,
                    sourceUrl: `https://osv.dev/list?q=${encodeURIComponent(advisoryIds[0])}`,
                });
                removeProposal(row.library);
            } catch (error) {
                removeProposal(row.library);
                errors.push({ component: `native-security-${row.library}`, error: error.message });
            }
        }),
    );
}

export async function createDependencyPlan({ root = ROOT, dependencies = {} } = {}) {
    const policy = JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'));
    const proposals = [];
    const blockers = [];
    const errors = [];
    const inventoryPath = path.join(os.tmpdir(), `crossbind-native-inventory-${process.pid}.json`);
    try {
        const inventory = dependencies.nativeInventory ?? runNativeInventory(root, inventoryPath);
        planNative(inventory, proposals, blockers);
        if (!dependencies.skipNativeSecurity) {
            await planNativeSecurity(inventory, policy.nativeSecurity, proposals, blockers, errors, dependencies);
        }
    } finally {
        fs.rmSync(inventoryPath, { force: true });
    }

    const checks = dependencies.skipToolchains
        ? []
        : [
              ['node', () => planNode(root, policy.toolchains.node, proposals, dependencies)],
              ['rust', () => planRust(root, policy.toolchains.rust, proposals, dependencies)],
              ['emscripten', () => planEmscripten(root, policy.toolchains.emscripten, proposals, blockers, dependencies)],
              ['wasi-sdk', () => planWasi(root, policy.toolchains.wasiSdk, proposals, dependencies)],
              ['android', () => planAndroid(root, policy.toolchains.android, proposals, blockers, dependencies)],
              ['swig', () => planSwig(root, policy.toolchains.swig, proposals, dependencies)],
          ];
    await Promise.all(
        checks.map(async ([component, check]) => {
            try {
                await check();
            } catch (error) {
                errors.push({ component, error: error.message });
            }
        }),
    );

    blockers.sort((a, b) => a.component.localeCompare(b.component));
    errors.sort((a, b) => a.component.localeCompare(b.component));

    const priority = { security: 0, patch: 1, digest: 2, minor: 3, source: 4, major: 5 };
    proposals.sort((a, b) => (priority[a.risk] ?? 9) - (priority[b.risk] ?? 9) || a.id.localeCompare(b.id));
    const selected = proposals.slice(0, policy.schedule.maximumPullRequestsPerRun);
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        proposals,
        selected,
        deferred: proposals.slice(selected.length),
        blockers,
        errors,
        matrix: {
            include: selected.map((proposal) => ({
                id: proposal.id,
                encoded: encodeProposal(proposal),
                kind: proposal.kind,
                component: proposal.component ?? proposal.unit,
                macos: proposal.macos,
            })),
        },
    };
}

async function main() {
    const output = path.resolve(option('--output', path.join(os.tmpdir(), 'crossbind-dependency-plan.json')));
    const plan = await createDependencyPlan();
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`);
    process.stdout.write(
        `${output}: ${plan.proposals.length} proposal(s), ${plan.blockers.length} manual blocker(s), ${plan.errors.length} error(s).\n`,
    );
    for (const proposal of plan.selected) process.stdout.write(`  PR ${proposal.id}: ${proposal.current} -> ${proposal.target}\n`);
    for (const blocker of plan.blockers) process.stdout.write(`  REVIEW ${blocker.component}: ${blocker.reason}\n`);
    for (const error of plan.errors) process.stderr.write(`  ERROR ${error.component}: ${error.error}\n`);
    if (process.argv.includes('--github-output')) {
        if (!process.env.GITHUB_OUTPUT) throw new Error('--github-output requires GITHUB_OUTPUT.');
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(plan.matrix)}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `count=${plan.selected.length}\n`);
        fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_findings=${plan.blockers.length + plan.errors.length > 0}\n`);
        fs.appendFileSync(
            process.env.GITHUB_OUTPUT,
            `report=${Buffer.from(JSON.stringify({ blockers: plan.blockers, errors: plan.errors })).toString('base64url')}\n`,
        );
    }
    if (plan.errors.length > 0 && process.argv.includes('--strict')) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error);
        process.exit(1);
    });
}
