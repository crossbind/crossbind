#!/usr/bin/env node
// npm configures a Trusted Publisher only on a package that already exists, so a workspace package
// npm has never seen cannot make its first release through the OIDC train. This gives each such
// name a placeholder version under its own dist-tag and trusts the release workflow for it. It
// runs as the maintainer, whose npm login confirms every write with 2FA; the release workflow
// itself stays token-free.
//
// Every placeholder goes out first, so npm's five-minute 2FA window is spent on writes rather than on
// the minutes npm takes to serve a new package. Then the trust of each name is checked and the
// missing ones are set. A name stays selected until a real release lands, so a run that stopped
// continues when it runs again. When npm asks for 2FA, the script prints the approval link and
// waits for it, so it needs no terminal.
//
//   node scripts/release/bootstrap-npm-packages.mjs                       # list what is left
//   node scripts/release/bootstrap-npm-packages.mjs --trust-only          # check which trust the workflow
//   node scripts/release/bootstrap-npm-packages.mjs --apply               # placeholders, then the missing trusts
//   node scripts/release/bootstrap-npm-packages.mjs --apply --trust-only  # only the missing trusts
//   node scripts/release/bootstrap-npm-packages.mjs --apply --package @crossbind/port-zlib-linux

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WORKSPACE_RELEASE_WORKFLOW, WORKSPACE_REPOSITORY, discoverPublishablePackages } from './workspace-release.mjs';

export const BOOTSTRAP_VERSION = '0.0.0-bootstrap.0';
export const BOOTSTRAP_TAG = 'bootstrap';
// The npm the release workflow installs: `npm trust --allow-publish` needs 11.15 or newer.
const NPM_WRITER = ['npx', '--yes', 'npm@12.0.2'];
const RELEASE_ENVIRONMENT = 'npm-release';
// npm asks for a pause between trust calls to stay under its rate limit.
const TRUST_PAUSE_MS = 2000;
// npm serves a new package minutes after it accepts the publish; trust wants it served.
const VISIBILITY_PAUSE_MS = 15000;
const VISIBILITY_ATTEMPTS = 40;
const RERUN = 'Run the same command again: it picks up where this one stopped.';
const SCAN_CONCURRENCY = 8;
// Read one by one, the trusts of every new name outlast the five-minute 2FA window.
const TRUST_CHECK_CONCURRENCY = 4;
const SCAN_PROGRESS_EVERY = 50;
const TRUST_PROGRESS_EVERY = 25;
const APPROVAL_POLL_SECONDS = 3;
const APPROVAL_TIMEOUT_SECONDS = 600;
const MAX_APPROVALS = 3;
const log = (message) => console.log(`bootstrap-npm-packages: ${message}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_SLUG = new URL(WORKSPACE_REPOSITORY).pathname.replace(/^\//, '').replace(/\.git$/, '');
const WORKFLOW_FILE = path.basename(WORKSPACE_RELEASE_WORKFLOW);

export function selectPackages(candidates, { requested, isPending }) {
    if (requested.length === 0) return candidates.filter((candidate) => isPending(candidate.name));
    const byName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
    const unknown = requested.filter((name) => !byName.has(name));
    if (unknown.length > 0) throw new Error(`Not a publishable workspace package: ${unknown.join(', ')}.`);
    return requested.map((name) => byName.get(name));
}

export function placeholderManifest(candidate) {
    return {
        name: candidate.name,
        version: BOOTSTRAP_VERSION,
        description: `Placeholder that let npm trust the crossbind release workflow; install ${candidate.name}@beta.`,
        license: candidate.manifest.license,
        repository: candidate.manifest.repository,
    };
}

export function publishCommand(directory) {
    return ['publish', directory, '--access', 'public', '--tag', BOOTSTRAP_TAG, '--provenance=false', '--json'];
}

// npm keeps one trust configuration per package and refuses a second, so this runs only for a package without one.
export function trustCommand(name) {
    return [
        'trust',
        'github',
        name,
        '--repo',
        REPOSITORY_SLUG,
        '--file',
        WORKFLOW_FILE,
        '--env',
        RELEASE_ENVIRONMENT,
        '--allow-publish',
        '--yes',
        '--json',
    ];
}

export function trustListCommand(name) {
    return ['trust', 'list', name, '--json'];
}

// npm's cache keeps a 404 for a while, so a package published minutes ago would still look missing.
export function versionsCommand(name) {
    return ['view', name, 'versions', '--json', '--prefer-online'];
}

export function versionsOn(view) {
    if (view.status === 0) return [JSON.parse(view.stdout)].flat();
    if (/\bE404\b/.test(view.stderr)) return [];
    throw new Error(`npm view failed: ${view.stderr.trim()}`);
}

// Never published, or holding only the placeholder and the 0.0.0-stage entry npm's staged publish
// leaves behind: the name still waits for its first release.
export const isPlaceholderOnly = (versions) => versions.every((version) => version.startsWith('0.0.0-'));

// npm --json prints one pretty-printed document after another, each opening at the start of a line.
const jsonDocuments = (output) =>
    output
        .split(/^(?=\{)/m)
        .map((block) => block.trim())
        .filter(Boolean);

// npm prints one JSON object per trust configuration, and nothing for a package without one.
export function trustsReleaseWorkflow(output) {
    return jsonDocuments(output)
        .map((block) => JSON.parse(block))
        .some((config) => config.repository === REPOSITORY_SLUG && path.basename(config.file ?? '') === WORKFLOW_FILE);
}

const parseOrNull = (block) => {
    try {
        return JSON.parse(block);
    } catch {
        return null;
    }
};

// `npm trust github` prints the configuration it is about to create before the error.
function jsonError(stdout) {
    return (
        jsonDocuments(stdout)
            .map(parseOrNull)
            .find((document) => document?.error)?.error ?? null
    );
}

// Under --json npm names the page that approves a 2FA prompt and the URL that then hands out the
// one-time password, so the approval needs no terminal.
export function otpChallenge(stdout) {
    const error = jsonError(stdout);
    return error?.code === 'EOTP' && error.authUrl && error.doneUrl ? { authUrl: error.authUrl, doneUrl: error.doneUrl } : null;
}

export function npmError({ stdout, stderr }) {
    const error = jsonError(stdout);
    if (error?.summary) return [error.summary, error.detail].filter(Boolean).join(' ');
    return (
        stderr
            .split('\n')
            .filter((line) => line.startsWith('npm error'))
            .join(' ') || 'npm printed no error.'
    );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForApproval(doneUrl, { request = fetch, pause = sleep } = {}) {
    let waited = 0;
    while (waited < APPROVAL_TIMEOUT_SECONDS) {
        const response = await request(doneUrl);
        if (response.status === 200) {
            const { token } = await response.json();
            if (!token) throw new Error(`npm approved the 2FA prompt but sent no one-time password. ${RERUN}`);
            return token;
        }
        // npm drops a prompt nobody approved within five minutes.
        if (response.status === 404) return undefined;
        if (response.status !== 202) throw new Error(`npm answered the 2FA check with HTTP ${response.status}. ${RERUN}`);
        const seconds = Number(response.headers.get('retry-after')) || APPROVAL_POLL_SECONDS;
        await pause(seconds * 1000);
        waited += seconds;
    }
    throw new Error(`The 2FA prompt was not approved within ${APPROVAL_TIMEOUT_SECONDS / 60} minutes. ${RERUN}`);
}

let approval;

// Calls that hit the prompt together share one approval; with the five-minute option ticked, the
// others then go through without a password of their own.
export function approve(challenge, { wait = waitForApproval } = {}) {
    if (approval) return approval.then(() => undefined);
    log(`npm asks for 2FA: approve ${challenge.authUrl} and tick the five-minute option so the next calls go through too.`);
    approval = wait(challenge.doneUrl).finally(() => {
        approval = undefined;
    });
    return approval.then((otp) => {
        log(otp ? '2FA approved.' : 'The 2FA link expired unapproved; asking npm for a new one.');
        return otp;
    });
}

function spawnCaptured(command, args, env = process.env) {
    return new Promise((resolve) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (error) => resolve({ status: 1, stdout, stderr: String(error) }));
        child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
}

function runWriter(args, otp) {
    const env = otp ? { ...process.env, npm_config_otp: otp } : process.env;
    return spawnCaptured(NPM_WRITER[0], [...NPM_WRITER.slice(1), ...args], env);
}

export async function npmAuthorized(args, { run = runWriter, approveChallenge = approve } = {}) {
    let result = await run(args);
    for (let approvals = 0; approvals < MAX_APPROVALS; approvals += 1) {
        const challenge = otpChallenge(result.stdout);
        if (!challenge) return result;
        result = await run(args, await approveChallenge(challenge));
    }
    if (otpChallenge(result.stdout)) throw new Error(`npm still asks for 2FA after ${MAX_APPROVALS} prompts. ${RERUN}`);
    return result;
}

async function runNpm(name, step) {
    const result = await npmAuthorized(step);
    if (result.status === 0) return result.stdout;
    throw new Error(`npm ${step.slice(0, 2).join(' ')} failed for ${name}: ${npmError(result)} ${RERUN}`);
}

const isServed = async (name) => versionsOn(await spawnCaptured('npm', versionsCommand(name))).length > 0;

export async function waitUntilPublished(name, { isPublished = isServed, pause = sleep, attempts = VISIBILITY_ATTEMPTS, onWait = () => {} } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (await isPublished(name)) return;
        if (attempt === 1) onWait();
        if (attempt < attempts) await pause(VISIBILITY_PAUSE_MS);
    }
    throw new Error(`npm does not serve ${name} yet. ${RERUN}`);
}

function placeholderReadme(name) {
    return `# ${name}

This version, ${BOOTSTRAP_VERSION}, holds no code. npm lets a trusted publisher be configured only for a
package that exists, so it reserves the name for the crossbind release workflow.

Install the real package: \`npm install ${name}@beta\`. Source: https://github.com/crossbind/crossbind
`;
}

async function publishPlaceholder(candidate) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bootstrap-'));
    try {
        fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(placeholderManifest(candidate), null, 4)}\n`);
        fs.writeFileSync(path.join(directory, 'README.md'), placeholderReadme(candidate.name));
        await runNpm(candidate.name, publishCommand(directory));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

// Without the publish phase, a name that has no placeholder yet cannot take a trust and waits for a full run.
export function trustTargets(selected, fresh, { trustOnly }) {
    if (!trustOnly) return { targets: selected, leftOut: [] };
    return { targets: selected.filter((candidate) => !fresh.includes(candidate)), leftOut: fresh };
}

// npm answers for one name per request, so a few requests run side by side; the first failure stops the rest.
async function forEachConcurrently(items, limit, task) {
    let next = 0;
    let failed = false;
    const worker = async () => {
        while (next < items.length && !failed) {
            try {
                await task(items[next++]);
            } catch (error) {
                failed = true;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: limit }, worker));
}

async function scanVersions(names) {
    const versions = new Map();
    await forEachConcurrently(names, SCAN_CONCURRENCY, async (name) => {
        versions.set(name, versionsOn(await spawnCaptured('npm', versionsCommand(name))));
        if (versions.size % SCAN_PROGRESS_EVERY === 0) log(`checked ${versions.size}/${names.length}`);
    });
    return versions;
}

async function checkTrust(targets, publishedNow) {
    const trusted = new Set();
    let checked = 0;
    await forEachConcurrently(targets, TRUST_CHECK_CONCURRENCY, async (candidate) => {
        if (publishedNow.has(candidate))
            await waitUntilPublished(candidate.name, { onWait: () => log(`waiting for npm to serve ${candidate.name}…`) });
        if (trustsReleaseWorkflow(await runNpm(candidate.name, trustListCommand(candidate.name)))) trusted.add(candidate);
        checked += 1;
        if (checked % TRUST_PROGRESS_EVERY === 0) log(`checked the trust of ${checked}/${targets.length}`);
    });
    return targets.filter((candidate) => !trusted.has(candidate));
}

async function main(args) {
    const apply = args.includes('--apply');
    const trustOnly = args.includes('--trust-only');
    const requested = args.flatMap((arg, index) => (args[index - 1] === '--package' ? [arg] : []));
    const candidates = discoverPublishablePackages(ROOT);
    const names = requested.length > 0 ? requested : candidates.map((candidate) => candidate.name);
    log(`checking ${names.length} package(s) on npm`);
    const versions = await scanVersions(names);
    const selected = selectPackages(candidates, { requested, isPending: (name) => isPlaceholderOnly(versions.get(name)) });
    if (selected.length === 0) {
        log('every publishable workspace package has a release on npm.');
        return;
    }
    const fresh = selected.filter((candidate) => !versions.get(candidate.name).includes(BOOTSTRAP_VERSION));
    log(`${selected.length} package(s) have no release on npm; ${fresh.length} of them have no placeholder yet.`);
    if (!apply && !trustOnly) {
        selected.forEach((candidate) => console.log(`  ${candidate.name}${fresh.includes(candidate) ? '' : ' (placeholder)'}`));
        console.log('Run again logged in to npm as a maintainer: --apply bootstraps them, --trust-only checks their trust.');
        return;
    }
    const publishedNow = new Set();
    if (apply && !trustOnly && fresh.length > 0) {
        log(`phase 1/2: publishing ${fresh.length} placeholder(s)`);
        for (const [index, candidate] of fresh.entries()) {
            await publishPlaceholder(candidate);
            publishedNow.add(candidate);
            log(`published ${candidate.name}@${BOOTSTRAP_VERSION} (${index + 1}/${fresh.length})`);
        }
    }
    const { targets, leftOut } = trustTargets(selected, fresh, { trustOnly });
    if (leftOut.length > 0) log(`${leftOut.length} package(s) have no placeholder yet and are left out; run --apply without --trust-only for them.`);
    log(`phase 2/2: checking which of ${targets.length} package(s) trust ${WORKSPACE_RELEASE_WORKFLOW}`);
    const missing = await checkTrust(targets, publishedNow);
    log(`${targets.length - missing.length} already trust it, ${missing.length} do not.`);
    if (!apply) {
        missing.forEach((candidate) => console.log(`  ${candidate.name}`));
        if (missing.length > 0) console.log('Run again with --apply --trust-only to set them.');
        return;
    }
    for (const [index, candidate] of missing.entries()) {
        await sleep(TRUST_PAUSE_MS);
        await runNpm(candidate.name, trustCommand(candidate.name));
        log(`${candidate.name} trusts the workflow (${index + 1}/${missing.length})`);
    }
    log(`done: ${publishedNow.size} placeholder(s) published, ${missing.length} trust(s) set, ${targets.length - missing.length} already in place.`);
    console.log(
        'Check `npm view <package> dist-tags`: if npm pointed latest at the placeholder, move it to the release once the train has published.',
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        await main(process.argv.slice(2));
    } catch (error) {
        console.error(`bootstrap-npm-packages: ${error.message}`);
        process.exitCode = 1;
    }
}
