import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import config from '../crossbind.config.mjs';

// Runs the shared conformance suite where Node.js loads each addon this host can reach: the glibc one
// on Debian and the musl one on Alpine wherever docker runs, the Windows and macOS ones on such a host.
const RUN_TIMEOUT_MS = 300000;
const GLIBC_IMAGE = 'node:24-bookworm-slim';
const MUSL_IMAGE = 'node:24-alpine';
// Shared conformance list: pass must equal run (backreference); skips are explicit lines.
const CONFORMANCE = /^CONFORMANCE (\d+)\/\1\b.*$/m;
// The suite imports its headers and crates through the hooks the build writes beside the addon's entry.
const APP = ['--import', './dist/node/napi.register.mjs', 'src/index.mjs'];

const root = resolve(import.meta.dirname, '..');
// The suite imports the workspace's conformance kit, so a container sees the whole repository.
const repo = resolve(root, '../..');
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const hasAddon = (platform) => existsSync(join(root, 'dist', `${config.general.name}.${platform}-${arch}.node`));

function fail(message) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
}

let ran = 0;
function check(label, command, args) {
    let out;
    try {
        out = execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout: RUN_TIMEOUT_MS });
    } catch (error) {
        fail(`${label} did not run:\n${error.stdout ?? ''}${error.stderr ?? error.message}`);
    }
    const summary = out.match(CONFORMANCE);
    if (!summary) fail(`${label} failed the conformance suite:\n${out}`);
    console.log(`ok: ${label}: ${summary[0]}`);
    ran += 1;
}

function isDockerAvailable() {
    try {
        execFileSync('docker', ['info'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

// The image variant must match the addon, whichever one an earlier pull left under the tag.
const inContainer = (image) => [
    'run', '--rm', '--platform', `linux/${arch === 'arm64' ? 'arm64' : 'amd64'}`,
    '-v', `${repo}:${repo}:ro`, '-w', root, image, 'node', ...APP,
];

if ((process.platform === 'win32' || process.platform === 'darwin') && hasAddon(process.platform)) {
    check(`${process.platform}-${arch} on this host`, process.execPath, APP);
}
if (process.platform !== 'win32' && (hasAddon('linux') || hasAddon('linuxmusl'))) {
    if (isDockerAvailable()) {
        if (hasAddon('linux')) check(`linux-${arch} on ${GLIBC_IMAGE}`, 'docker', inContainer(GLIBC_IMAGE));
        if (hasAddon('linuxmusl')) check(`linuxmusl-${arch} on ${MUSL_IMAGE}`, 'docker', inContainer(MUSL_IMAGE));
    } else if (process.env.CI) {
        fail('docker is not available, so the Linux addons cannot run');
    } else {
        console.log('SKIP: docker not available - the Linux addons were not run.');
    }
}
if (ran === 0) fail('no addon this host can run - `pnpm build` makes the Linux and Windows ones, `pnpm build:darwin` the macOS one.');
