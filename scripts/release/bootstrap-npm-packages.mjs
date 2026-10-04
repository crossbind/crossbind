#!/usr/bin/env node
// npm configures a Trusted Publisher only on a package that already exists, so a workspace package
// npm has never seen cannot make its first release through the OIDC train. This gives each such
// name a placeholder version under its own dist-tag and trusts the release workflow for it. It
// runs as the maintainer, whose npm login confirms every write with 2FA; the release workflow
// itself stays token-free.
//
//   node scripts/release/bootstrap-npm-packages.mjs                      # list what npm lacks
//   node scripts/release/bootstrap-npm-packages.mjs --apply              # bootstrap all of them
//   node scripts/release/bootstrap-npm-packages.mjs --apply --package @crossbind/port-zlib-linux

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPOSITORY_SLUG = new URL(WORKSPACE_REPOSITORY).pathname.replace(/^\//, '').replace(/\.git$/, '');

export function selectPackages(candidates, { requested, isPublished }) {
    if (requested.length === 0) return candidates.filter((candidate) => !isPublished(candidate.name));
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

// Trust comes last: npm keeps one trust configuration per package and refuses a second, so a run
// that stopped anywhere earlier can be repeated for that package as it is.
export function bootstrapCommands(name, directory) {
    return [
        ['publish', directory, '--access', 'public', '--tag', BOOTSTRAP_TAG, '--provenance=false'],
        [
            'trust',
            'github',
            name,
            '--repo',
            REPOSITORY_SLUG,
            '--file',
            path.basename(WORKSPACE_RELEASE_WORKFLOW),
            '--env',
            RELEASE_ENVIRONMENT,
            '--allow-publish',
            '--yes',
        ],
    ];
}

export function isPublishedOn(view) {
    if (view.status === 0) return true;
    if (/\bE404\b/.test(view.stderr)) return false;
    throw new Error(`npm view failed: ${view.stderr.trim()}`);
}

// npm's cache keeps a 404 for a while, so a package published minutes ago would still look missing.
export function viewCommand(name) {
    return ['view', name, 'name', '--prefer-online'];
}

function isPublished(name) {
    return isPublishedOn(spawnSync('npm', viewCommand(name), { encoding: 'utf8' }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntilPublished(name, { isPublished: check = isPublished, pause = sleep, attempts = VISIBILITY_ATTEMPTS } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (check(name)) return;
        if (attempt < attempts) await pause(VISIBILITY_PAUSE_MS);
    }
    throw new Error(`npm does not serve ${name} yet; run again for it in a few minutes.`);
}

function placeholderReadme(name) {
    return `# ${name}

This version, ${BOOTSTRAP_VERSION}, holds no code. npm lets a trusted publisher be configured only for a
package that exists, so it reserves the name for the crossbind release workflow.

Install the real package: \`npm install ${name}@beta\`. Source: https://github.com/crossbind/crossbind
`;
}

async function bootstrap(candidate, remaining) {
    const runNpm = (step) => {
        if (spawnSync(NPM_WRITER[0], [...NPM_WRITER.slice(1), ...step], { stdio: 'inherit' }).status === 0) return;
        const rerun = remaining.map((name) => `--package ${name}`).join(' ');
        throw new Error(
            `npm ${step[0]} failed for ${candidate.name}. Continue with:\n  node scripts/release/bootstrap-npm-packages.mjs --apply ${rerun}`,
        );
    };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bootstrap-'));
    try {
        fs.writeFileSync(path.join(directory, 'package.json'), `${JSON.stringify(placeholderManifest(candidate), null, 4)}\n`);
        fs.writeFileSync(path.join(directory, 'README.md'), placeholderReadme(candidate.name));
        const [publish, trust] = bootstrapCommands(candidate.name, directory);
        if (!isPublished(candidate.name)) {
            runNpm(publish);
            await waitUntilPublished(candidate.name);
        }
        await sleep(TRUST_PAUSE_MS);
        runNpm(trust);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

async function main(args) {
    const requested = args.flatMap((arg, index) => (args[index - 1] === '--package' ? [arg] : []));
    const selected = selectPackages(discoverPublishablePackages(ROOT), { requested, isPublished });
    if (selected.length === 0) {
        console.log('bootstrap-npm-packages: npm already has every publishable workspace package.');
        return;
    }
    if (!args.includes('--apply')) {
        console.log(`bootstrap-npm-packages: ${selected.length} package(s) npm has never published:`);
        selected.forEach((candidate) => console.log(`  ${candidate.name}`));
        console.log('Run again with --apply while logged in to npm as a maintainer; npm confirms the writes with 2FA.');
        return;
    }
    for (const [index, candidate] of selected.entries()) {
        await bootstrap(
            candidate,
            selected.slice(index).map((entry) => entry.name),
        );
        console.log(`bootstrap-npm-packages: ${candidate.name} trusts ${WORKSPACE_RELEASE_WORKFLOW} (${index + 1}/${selected.length}).`);
    }
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
