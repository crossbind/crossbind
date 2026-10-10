// Assembles the compiler image's build context in .build/ and builds it: the Dockerfile, the compiler and
// crossbind from this repository with the dependencies the workspace lockfile pins, on the web toolchain image that
// crossbind pins. The context's hash goes to .build/version. Beside it go the contexts of the cloud runners,
// .build/runner-<image>/; wrangler builds every image from these contexts on deploy.
// usage: node scripts/build-image.mjs [--amd64] [--tag <name>] [--context-only]
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDockerImage } from '../../../core/crossbind/src/utils/pullDockerImage.js';
import { RUNNER_IMAGES } from '../worker/runner-api.js';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = path.resolve(PACKAGE_DIR, '../..');
const CLI_DIR = path.join(REPO_DIR, 'core', 'crossbind');
// The lockfile and the settings it was resolved under: the overrides and the release-age policy.
const WORKSPACE_FILES = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'];
const CONTEXT = path.join(PACKAGE_DIR, '.build');
const RUNNER_TEMPLATE = path.join(PACKAGE_DIR, 'runner');
const RUNNER_SOURCE = path.join(CLI_DIR, 'src', 'runner');
const DEFAULT_TAG = 'crossbind-playground-compiler:dev';
const CLI_CONTEXT = path.join(CONTEXT, 'crossbind');
// What pnpm records of an install, with timestamps: the image needs none of it, and the hash must not move with it.
const PNPM_STATE = ['.modules.yaml', '.pnpm-workspace-state-v1.json'];

const argValue = (name, fallback) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? fallback : process.argv[at + 1];
};
const platform = process.argv.includes('--amd64') ? 'linux/amd64' : undefined;
const tag = argValue('--tag', DEFAULT_TAG);
const baseImage = getDockerImage('web', platform);

const filesBelow = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();

// crossbind with every version the workspace lockfile pins, for linux on either CPU, so the image build fetches nothing
// and runs no install script; hoisted lays the packages out as npm does. pnpm deploys from a lockfile only with
// injected workspace packages, of which crossbind has none. It records its settings as the install state of the
// workspace it runs in, after which pnpm would reinstall that workspace before running a script, so it runs in a copy
// holding the lockfile, its settings and crossbind alone.
function deployCli(target) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-cli-'));
    const cli = path.join(workspace, path.relative(REPO_DIR, CLI_DIR));
    try {
        WORKSPACE_FILES.forEach((file) => fs.copyFileSync(path.join(REPO_DIR, file), path.join(workspace, file)));
        fs.cpSync(CLI_DIR, cli, { recursive: true, filter: (source) => path.basename(source) !== 'node_modules' });
        execFileSync('pnpm', [
            '--silent', '--filter', 'crossbind', 'deploy', '--prod', '--frozen-lockfile', '--ignore-scripts',
            '--config.inject-workspace-packages=true', '--config.node-linker=hoisted', '--os', 'linux', '--cpu', 'x64', '--cpu', 'arm64', target,
        ], { cwd: cli, stdio: 'inherit' });
    } finally {
        fs.rmSync(workspace, { recursive: true, force: true });
    }
    PNPM_STATE.forEach((file) => fs.rmSync(path.join(target, 'node_modules', file), { force: true }));
}

fs.rmSync(CONTEXT, { recursive: true, force: true });
fs.mkdirSync(CONTEXT, { recursive: true });
// wrangler passes no build arguments, so the base image is written into the Dockerfile itself.
const dockerfile = fs.readFileSync(path.join(PACKAGE_DIR, 'Dockerfile'), 'utf8').replace(/^ARG BASE_IMAGE$/m, `ARG BASE_IMAGE=${baseImage}`);
fs.writeFileSync(path.join(CONTEXT, 'Dockerfile'), dockerfile);
fs.cpSync(path.join(PACKAGE_DIR, 'compiler'), path.join(CONTEXT, 'compiler'), { recursive: true });
deployCli(CLI_CONTEXT);

const hash = crypto.createHash('sha256');
filesBelow(CONTEXT).forEach((file) => hash.update(path.relative(CONTEXT, file)).update(fs.readFileSync(file)));
fs.writeFileSync(path.join(CONTEXT, 'version'), `${hash.digest('hex').slice(0, 16)}\n`);

// After the hash, so a runner change never retires the playground's cached compiles. A runner names its toolchain as a
// build does, android by its amd64 digest (src/actions/run.js), or the runner refuses the build's steps.
function writeRunnerContext(role) {
    const dir = path.join(CONTEXT, `runner-${role}`);
    const image = getDockerImage(role, role === 'android' ? 'linux/amd64' : undefined);
    fs.mkdirSync(path.join(dir, 'runner'), { recursive: true });
    const runnerDockerfile = fs.readFileSync(path.join(RUNNER_TEMPLATE, 'Dockerfile'), 'utf8')
        .replace(/^ARG BASE_IMAGE$/m, `ARG BASE_IMAGE=${image}`)
        .replace(/^ARG RUNNER_ROLE$/m, `ARG RUNNER_ROLE=${role}`);
    fs.writeFileSync(path.join(dir, 'Dockerfile'), runnerDockerfile);
    fs.copyFileSync(path.join(RUNNER_TEMPLATE, 'entrypoint.sh'), path.join(dir, 'entrypoint.sh'));
    fs.readdirSync(RUNNER_SOURCE).filter((file) => file.endsWith('.js'))
        .forEach((file) => fs.copyFileSync(path.join(RUNNER_SOURCE, file), path.join(dir, 'runner', file)));
}
RUNNER_IMAGES.forEach(writeRunnerContext);

if (!process.argv.includes('--context-only')) {
    execFileSync('docker', ['build', ...(platform ? ['--platform', platform] : []), '--tag', tag, CONTEXT], { stdio: 'inherit' });
    process.stdout.write(`built ${tag}\n`);
}
