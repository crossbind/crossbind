import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import getOsUserAndGroupId from './getOsUserAndGroupId.js';
import makeTreeWritable from './makeTreeWritable.js';
import pullDockerImage, { getDockerImage, getDockerContainerName, imageRoleFor } from './pullDockerImage.js';
import { DOCKER_RUN_SECURITY_ARGS } from './dockerSecurity.js';
import assertExecContainer from './execContainer.js';
import { IOS_DEVELOPER_DIR, XCODE_TOOLCHAIN_BIN } from './iosToolchain.js';

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
// What conan can build on the host: wasm with a host Emscripten, iOS with Xcode.
const HOST_PLATFORMS = ['wasm', 'ios'];
// Where a container sees conanRoot(): an exec container mounts all of it here, a run container only
// the store and its own work directory, at the same places.
const CONTAINER_ROOT = '/var/cache/crossbind/conan';
// A recipe's build log is the whole compiler output of a library.
const MAX_BUFFER = 256 * 1024 * 1024;
// The JSON graph carries conandata, the source URL and SHA-256 of the license rows, from 2.19 on.
const MIN_CONAN_VERSION = [2, 19];

export function conanRunner(config, target) {
    const runner = config.system?.RUNNER ?? 'DOCKER_RUN';
    if (!RUNNERS.includes(runner)) {
        throw new Error(`crossbind: the runner ${runner} is invalid; RUNNER is one of ${RUNNERS.join(', ')}.`);
    }
    // Xcode runs on the Mac alone, so iOS packages build there whatever runner the rest use.
    return target?.platform === 'ios' ? 'LOCAL' : runner;
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

// The Xcode every crossbind iOS archive builds with, whichever one xcode-select points at.
const iosEnv = () => ({ ...allowedEnv(), DEVELOPER_DIR: IOS_DEVELOPER_DIR });

// A GNU ar or nm ahead of Apple's on a Mac's PATH (Homebrew's binutils) writes archives Apple's linker
// cannot read, and recipes, the build tools they build and Meson all take these tools by name. So the
// run gets links to Xcode's first on its PATH.
const APPLE_TOOLS = {
    ar: 'ar', as: 'as', nm: 'llvm-nm', ranlib: 'ranlib', strip: 'strip',
};

function withAppleTools(work, env) {
    if (process.platform !== 'darwin') return env;
    const dir = path.join(work.dir, 'apple-tools');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        Object.entries(APPLE_TOOLS).forEach(([name, tool]) => fs.symlinkSync(path.join(XCODE_TOOLCHAIN_BIN, tool), path.join(dir, name)));
    }
    return { ...env, PATH: [dir, env.PATH].filter(Boolean).join(path.delimiter) };
}

const toolVersions = new Map();
// The first line a tool prints for --version, asked once.
function toolVersion(command, env = allowedEnv(), cwd = undefined) {
    const key = command.join(' ');
    if (!toolVersions.has(key)) {
        const [program, ...args] = command;
        const result = spawnSync(program, [...args, '--version'], { encoding: 'utf8', env, cwd });
        toolVersions.set(key, `${result.stdout ?? ''}`.split('\n')[0].trim());
    }
    return toolVersions.get(key);
}

// conan migrates the home it starts in, even for --version, so it is asked from a home of crossbind's
// instead of the user's ~/.conan2.
function conanVersion() {
    const dir = path.join(conanRoot('LOCAL'), 'probe');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.conanrc'), 'conan_home=./home\n');
    return toolVersion(['conan'], allowedEnv(), dir);
}

// What a host conan builds with; for a container the image digest says the same.
export function localToolchainIdentity(target) {
    const compiler = target?.platform === 'ios' ? toolVersion(['xcrun', 'clang'], iosEnv()) : toolVersion(['emcc']);
    return `${compiler}\n${conanVersion()}`;
}

function assertLocalConan(target) {
    const conan = conanVersion();
    const [major, minor] = (conan.match(/(\d+)\.(\d+)/) ?? []).slice(1).map(Number);
    const [needMajor, needMinor] = MIN_CONAN_VERSION;
    if (major > needMajor || (major === needMajor && minor >= needMinor)) return;
    const need = `Conan ${MIN_CONAN_VERSION.join('.')} or later; found ${conan || 'none'}.`;
    throw new Error(target.platform === 'ios'
        ? `crossbind: Conan packages for iOS build on this Mac, with the conan on the PATH, which must be ${need} Install or upgrade it with \`brew install conan\` (\`brew upgrade conan\`) or \`pipx install conan\`.`
        : `crossbind: RUNNER=LOCAL runs conan from the PATH and needs ${need}`);
}

export default function runConan(args, { config, target, work }) {
    const options = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: MAX_BUFFER };
    const role = imageRoleFor(target);
    if (work.runner === 'LOCAL') {
        if (!HOST_PLATFORMS.includes(target.platform)) {
            throw new Error(`crossbind: Conan packages for ${target.platform} build in the ${role} image, which RUNNER=LOCAL does not use.`);
        }
        if (target.platform === 'ios' && process.platform !== 'darwin') {
            throw new Error('crossbind: Conan packages for iOS build with Xcode, on a Mac.');
        }
        assertLocalConan(target);
        const env = withAppleTools(work, { ...(target.platform === 'ios' ? iosEnv() : allowedEnv()), CONAN_HOME: path.join(work.dir, 'home') });
        return spawnSync('conan', args, { ...options, cwd: work.dir, env });
    }

    // Google ships the linux NDK for x86_64 only.
    const platform = target.platform === 'android' ? 'linux/amd64' : undefined;
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
        pullDockerImage(role, platform);
        runnerArgs = [
            'run',
            '--rm',
            ...(platform ? ['--platform', platform] : []),
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
            getDockerImage(role, platform),
        ];
    }
    return spawnSync('docker', [...runnerArgs, 'conan', ...args], options);
}
