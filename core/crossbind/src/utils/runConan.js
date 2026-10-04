import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import getOsUserAndGroupId from './getOsUserAndGroupId.js';
import makeTreeWritable from './makeTreeWritable.js';
import pullDockerImage, { getDockerImage, getDockerContainerName, imageRoleFor } from './pullDockerImage.js';
import { DOCKER_RUN_SECURITY_ARGS } from './dockerSecurity.js';
import assertExecContainer from './execContainer.js';

// Every conan invocation crossbind makes goes through here. The config is passed in instead of read
// from state, because state attaches the staged Conan packages while it is still being built.
//
// A Conan home holds code conan runs (plugins, hooks) and settings every recipe obeys (global.conf,
// remotes), and the recipes it builds can write to it. So every run gets a home of its own, made in a
// fresh work directory and deleted with it; only the package store outlives a run. On the host the
// environment is rebuilt from an allowlist, so CONAN_DEFAULT_PROFILE, a stray CC or a remote's
// credentials never reach conan.
const ALLOWED_ENV = [
    /^PATH$/,
    /^HOME$/,
    /^USER$/,
    /^LOGNAME$/,
    /^SHELL$/,
    /^TERM$/,
    /^TMPDIR$/,
    /^TEMP$/,
    /^TMP$/,
    /^LANG$/,
    /^LC_[A-Z_]+$/,
    /^(HTTP|HTTPS|ALL|NO)_PROXY$/i,
    /^SSL_CERT_(FILE|DIR)$/,
    /^REQUESTS_CA_BUNDLE$/,
    // A host Emscripten under RUNNER=LOCAL.
    /^EMSDK(_NODE|_PYTHON)?$/,
    /^EM_(CONFIG|CACHE)$/,
    /^SYSTEMROOT$/i,
    /^WINDIR$/i,
    /^USERPROFILE$/i,
    /^PROGRAMDATA$/i,
];

const RUNNERS = ['DOCKER_RUN', 'DOCKER_EXEC', 'LOCAL'];
// Where a container sees conanRoot(): an exec container mounts all of it here, a run container only
// the store and its own work directory, at the same places.
const CONTAINER_ROOT = '/var/cache/crossbind/conan';
// A recipe's build log is the whole compiler output of a library.
const MAX_BUFFER = 256 * 1024 * 1024;
// The JSON graph carries conandata, the source URL and SHA-256 of the license rows, from 2.19 on.
const MIN_CONAN_VERSION = [2, 19];

export function conanRunner(config) {
    const runner = config.system?.RUNNER ?? 'DOCKER_RUN';
    if (!RUNNERS.includes(runner)) {
        throw new Error(`crossbind: the runner ${runner} is invalid; RUNNER is one of ${RUNNERS.join(', ')}.`);
    }
    return runner;
}

// Machine-wide like the cargo cache: built packages are reused by every project, and `pnpm run clear`
// in one project must not throw them away. Containers write to the store and conan runs the recipes
// it keeps there, so conan on the host never shares a store with them.
export function conanRoot(runner = 'DOCKER_RUN') {
    return path.join(os.homedir(), '.crossbind', runner === 'LOCAL' ? 'conan-local' : 'conan');
}

// The directory one conan run reads its inputs from and writes its outputs to, with the home it runs
// with. conanPath names a file of it as conan sees it.
export function createConanWork(runner) {
    const root = conanRoot(runner);
    const store = path.join(root, 'store');
    fs.mkdirSync(store, { recursive: true });
    fs.mkdirSync(path.join(root, 'work'), { recursive: true });
    const dir = fs.mkdtempSync(path.join(root, 'work', 'run-'));
    const conanDir = runner === 'LOCAL' ? dir : `${CONTAINER_ROOT}/work/${path.basename(dir)}`;
    const conanPath = (file) => (runner === 'LOCAL' ? path.join(dir, file) : `${conanDir}/${file}`);
    // conan takes its home from the first .conanrc at or above its working directory, ahead of
    // CONAN_HOME; one in the working directory itself is always that first one.
    fs.writeFileSync(path.join(dir, '.conanrc'), 'conan_home=./home\n');
    fs.mkdirSync(path.join(dir, 'home'));
    fs.writeFileSync(path.join(dir, 'home', 'global.conf'), [
        `core.cache:storage_path=${runner === 'LOCAL' ? store : `${CONTAINER_ROOT}/store`}`,
        'core:non_interactive=True',
        '',
    ].join('\n'));
    return {
        runner, root, store, dir, conanDir, conanPath,
    };
}

function removeTree(dir) {
    if (!fs.existsSync(dir)) return;
    makeTreeWritable(dir);
    fs.rmSync(dir, { recursive: true, force: true });
}

export const removeConanWork = (work) => removeTree(work.dir);

// What runs that were killed left behind. Only while holding the install lock: no run is going then.
export const clearConanWork = (runner) => removeTree(path.join(conanRoot(runner), 'work'));

// conan reports paths as it sees them. In a container that is through the mounts, which all sit under
// CONTAINER_ROOT, so mapping the prefix back is exact; a path anywhere else is none crossbind gave it.
export function toHostPath(reported, work) {
    if (work.runner === 'LOCAL') return path.resolve(reported);
    const clean = path.posix.normalize(reported);
    // A backslash is a separator again once the path is joined on a Windows host.
    if (reported.includes('\\') || !clean.startsWith(`${CONTAINER_ROOT}/`)) {
        throw new Error(`crossbind: conan reported ${JSON.stringify(reported)}, outside the directories crossbind mounts for it.`);
    }
    return path.join(work.root, clean.slice(CONTAINER_ROOT.length + 1));
}

function allowedEnv() {
    return Object.fromEntries(Object.entries(process.env).filter(([key]) => ALLOWED_ENV.some((allowed) => allowed.test(key))));
}

let localTools;
function localToolVersions() {
    localTools ??= Object.fromEntries(['emcc', 'conan'].map((program) => {
        const result = spawnSync(program, ['--version'], { encoding: 'utf8', env: allowedEnv() });
        return [program, `${result.stdout ?? ''}`.split('\n')[0].trim()];
    }));
    return localTools;
}

// What a host conan builds with; for a container the image digest says the same.
export const localToolchainIdentity = () => `${localToolVersions().emcc}\n${localToolVersions().conan}`;

function assertLocalConan() {
    const { conan } = localToolVersions();
    const [major, minor] = (conan.match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
    const [needMajor, needMinor] = MIN_CONAN_VERSION;
    if (!(major > needMajor || (major === needMajor && minor >= needMinor))) {
        throw new Error(`crossbind: RUNNER=LOCAL runs conan from the PATH and needs Conan ${MIN_CONAN_VERSION.join('.')} or later; found ${conan || 'none'}.`);
    }
}

export default function runConan(args, { config, target, work }) {
    const options = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: MAX_BUFFER };
    if (work.runner === 'LOCAL') {
        assertLocalConan();
        return spawnSync('conan', args, { ...options, cwd: work.dir, env: { ...allowedEnv(), CONAN_HOME: path.join(work.dir, 'home') } });
    }

    const role = imageRoleFor(target);
    const env = ['-e', `CONAN_HOME=${work.conanPath('home')}`];
    let runnerArgs;
    if (work.runner === 'DOCKER_EXEC') {
        const name = getDockerContainerName(config.paths.base, role);
        assertExecContainer({
            name,
            mounts: [[CONTAINER_ROOT, work.root]],
            workdir: work.conanDir,
            hint: `Recreate it with \`crossbind docker stop ${role}\`, \`crossbind docker delete ${role}\` and \`crossbind docker create ${role}\`, which mount ${work.root} at ${CONTAINER_ROOT}.`,
            mountNote: 'It predates the conan mount.',
        });
        runnerArgs = ['exec', ...env, '--user', getOsUserAndGroupId(), '--workdir', work.conanDir, name];
    } else {
        pullDockerImage(role);
        runnerArgs = [
            'run',
            '--rm',
            ...DOCKER_RUN_SECURITY_ARGS,
            '-v',
            `${work.store}:${CONTAINER_ROOT}/store`,
            '-v',
            `${work.dir}:${work.conanDir}`,
            ...env,
            '--user',
            getOsUserAndGroupId(),
            '--workdir',
            work.conanDir,
            getDockerImage(role),
        ];
    }
    return spawnSync('docker', [...runnerArgs, 'conan', ...args], options);
}
