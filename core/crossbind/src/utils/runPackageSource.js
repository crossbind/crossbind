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
import { DARWIN_CC, DARWIN_TOOLS_BIN } from './darwinToolchain.js';
import { HOST_BUILT_PLATFORMS } from './targets.js';
import { remoteExecParams } from './remoteRunner.js';
import { runnerFor } from './selectRunner.js';

// Every run of a package source's tool goes through here. The config is passed in instead of read from
// state, because state attaches the staged packages while it is still being built.
//
// The tool runs recipes, which are code, and can write wherever the tool keeps its settings and plugins.
// So every run gets a fresh work directory, deleted with the run, for whatever of the tool must not
// outlive it; only the package store does. On the host the environment is rebuilt from an allowlist, so
// the tool's own variables, a stray CC or a remote's credentials never reach it.
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

// What a tool can build on the host: wasm with a host Emscripten, iOS and macOS with Xcode.
const HOST_PLATFORMS = ['wasm', 'ios', 'darwin'];
const APPLE_PLATFORM_NAMES = { ios: 'iOS', darwin: 'macOS' };
// Where a container sees sourceRoot(): an exec container mounts all of it here, a run container only
// the store and its own work directory, at the same places.
export const containerRootOf = (name) => `/var/cache/crossbind/${name}`;
// A recipe's build log is the whole compiler output of a library.
const MAX_BUFFER = 256 * 1024 * 1024;
const SPAWN_OPTIONS = { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: MAX_BUFFER };

export function sourceRunner(config, target) {
    const { runner } = runnerFor(imageRoleFor(target), config.system);
    // Xcode runs on the Mac alone, so iOS and macOS packages build there whatever runner the rest use.
    return HOST_BUILT_PLATFORMS.includes(target?.platform) ? 'LOCAL' : runner;
}

// Machine-wide like the cargo cache: built packages are reused by every project, and `pnpm run clear`
// in one project must not throw them away. Containers write to the store and a tool runs the recipes
// it keeps there, so a tool on the host never shares a store with them.
export function sourceRoot(name, runner = 'DOCKER_RUN') {
    return path.join(os.homedir(), '.crossbind', runner === 'LOCAL' ? `${name}-local` : name);
}

// A directory under a source's root, with the store beside it. toolPath and storePath name a file of
// each as the tool sees it.
function workAt(name, runner, relative) {
    const root = sourceRoot(name, runner);
    const viewOf = (base) => (...segments) => (runner === 'LOCAL'
        ? path.join(root, base, ...segments)
        : [containerRootOf(name), base, ...segments].join('/'));
    const toolPath = viewOf(relative);
    return {
        name, runner, root, store: path.join(root, 'store'), dir: path.join(root, relative), toolDir: toolPath(), toolPath, storePath: viewOf('store'),
    };
}

// The directory one run reads its inputs from and writes its outputs to.
export function createSourceWork(name, runner) {
    const root = sourceRoot(name, runner);
    fs.mkdirSync(path.join(root, 'store'), { recursive: true });
    fs.mkdirSync(path.join(root, 'work'), { recursive: true });
    return workAt(name, runner, `work/${path.basename(fs.mkdtempSync(path.join(root, 'work', 'run-')))}`);
}

// Where a source asks the tool of the host what it is, outside any run. Only named where an image says what runs:
// nothing is asked there, and a build that finds every target staged touches nothing of the home.
export function createSourceProbe(name, runner) {
    if (runner === 'LOCAL') fs.mkdirSync(path.join(sourceRoot(name, runner), 'probe'), { recursive: true });
    return workAt(name, runner, 'probe');
}

function removeTree(dir) {
    if (!fs.existsSync(dir)) return;
    makeTreeWritable(dir);
    fs.rmSync(dir, { recursive: true, force: true });
}

export const removeSourceWork = (work) => removeTree(work.dir);

// What runs that were killed left behind. Only while holding the install lock: no run is going then.
export const clearSourceWork = (name, runner) => removeTree(path.join(sourceRoot(name, runner), 'work'));

// A tool reports paths as it sees them. In a container that is through the mounts, which all sit under
// the container's root, so mapping the prefix back is exact; a path anywhere else is none crossbind gave it.
export function toHostPath(reported, work) {
    if (work.runner === 'LOCAL') return path.resolve(reported);
    const containerRoot = containerRootOf(work.name);
    const clean = path.posix.normalize(reported);
    // A backslash is a separator again once the path is joined on a Windows host.
    if (reported.includes('\\') || !clean.startsWith(`${containerRoot}/`)) {
        throw new Error(`crossbind: ${work.name} reported ${JSON.stringify(reported)}, outside the directories crossbind mounts for it.`);
    }
    return path.join(work.root, clean.slice(containerRoot.length + 1));
}

function allowedEnv() {
    return Object.fromEntries(Object.entries(process.env).filter(([key]) => ALLOWED_ENV.some((allowed) => allowed.test(key))));
}

// The Xcode every crossbind iOS archive builds with, whichever one xcode-select points at.
const iosEnv = () => ({ ...allowedEnv(), DEVELOPER_DIR: IOS_DEVELOPER_DIR });

// A GNU ar or nm ahead of Apple's on a Mac's PATH (Homebrew's binutils) writes archives Apple's linker
// cannot read, and recipes, the build tools they build and Meson all take these tools by name. So the
// run gets links to Xcode's first on its PATH; for macOS to the ones xcode-select picks, as the macOS
// ports are built with.
const APPLE_TOOLS = {
    ar: 'ar', as: 'as', nm: 'llvm-nm', ranlib: 'ranlib', strip: 'strip',
};
const appleToolOf = (target, name) => (target.platform === 'darwin'
    ? path.join(DARWIN_TOOLS_BIN, name)
    : path.join(XCODE_TOOLCHAIN_BIN, APPLE_TOOLS[name]));

function withAppleTools(work, env, target) {
    if (process.platform !== 'darwin') return env;
    const dir = path.join(work.dir, 'apple-tools');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        Object.keys(APPLE_TOOLS).forEach((name) => fs.symlinkSync(appleToolOf(target, name), path.join(dir, name)));
    }
    return { ...env, PATH: [dir, env.PATH].filter(Boolean).join(path.delimiter) };
}

const toolVersions = new Map();
// The first line a tool prints for --version, asked once.
function toolVersion(command, env = allowedEnv()) {
    const key = command.join(' ');
    if (!toolVersions.has(key)) {
        const [program, ...args] = command;
        const result = spawnSync(program, [...args, '--version'], { encoding: 'utf8', env });
        toolVersions.set(key, `${result.stdout ?? ''}`.split('\n')[0].trim());
    }
    return toolVersions.get(key);
}

// The compiler a tool on the host builds with; for a container the image digest says the same.
export function localCompilerIdentity(target) {
    if (target?.platform === 'ios') return toolVersion(['xcrun', 'clang'], iosEnv());
    if (target?.platform === 'darwin') return toolVersion([DARWIN_CC]);
    return toolVersion(['emcc']);
}

// What a tool on the host cannot build: the targets an image's toolchain builds, and Xcode's off a Mac.
export function assertRunsOnHost(name, target) {
    if (!HOST_PLATFORMS.includes(target.platform)) {
        throw new Error(`crossbind: ${name} packages for ${target.platform} build in the ${imageRoleFor(target)} image, which RUNNER=LOCAL does not use.`);
    }
    if (HOST_BUILT_PLATFORMS.includes(target.platform) && process.platform !== 'darwin') {
        throw new Error(`crossbind: ${name} packages for ${APPLE_PLATFORM_NAMES[target.platform]} build with Xcode, on a Mac.`);
    }
}

// Of a store, a remote runner sends back the folders its source says never change once written, and nothing else.
export function assertRunsRemotely({ name, packageSource }) {
    if (packageSource.storeUnits.length > 0) return;
    throw new Error(`crossbind: ${name} names no storeUnits, so a remote runner would send none of its packages back: name the folders of its store that never change once written, as 'p/*/p', or build with another RUNNER.`);
}

// A tool of the host asked what it is, in a source's probe directory: no target's tools are on its PATH.
export function runProbe([program, ...args], { work, env = {} }) {
    return spawnSync(program, args, { ...SPAWN_OPTIONS, cwd: work.dir, env: { ...allowedEnv(), ...env } });
}

export default function runPackageSource(command, {
    source, config, target, work, env = {},
}) {
    const [program, ...args] = command;
    const role = imageRoleFor(target);
    if (work.runner === 'LOCAL') {
        const hostEnv = target.platform === 'ios' ? iosEnv() : allowedEnv();
        return spawnSync(program, args, { ...SPAWN_OPTIONS, cwd: work.dir, env: withAppleTools(work, { ...hostEnv, ...env }, target) });
    }

    // Google ships the linux NDK for x86_64 only.
    const platform = target.platform === 'android' ? 'linux/amd64' : undefined;
    if (work.runner === 'REMOTE') {
        return spawnSync(...remoteExecParams({
            remote: runnerFor(role, config.system).remote,
            role,
            image: getDockerImage(role, platform),
            mounts: [
                // Of the store, only the folders the source names come back: they never change once written.
                { host: work.store, container: work.storePath(), inputRoots: [], outputRoots: source.packageSource.storeUnits },
                { host: work.dir, container: work.toolDir, inputRoots: ['.'], outputRoots: ['.'] },
            ],
            cwd: work.toolDir,
            argv: command,
            env,
        }, SPAWN_OPTIONS));
    }

    const containerRoot = containerRootOf(source.name);
    const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
    let runnerArgs;
    if (work.runner === 'DOCKER_EXEC') {
        const name = getDockerContainerName(config.paths.base, role);
        assertExecContainer({
            name,
            mounts: [[containerRoot, work.root]],
            workdir: work.toolDir,
            hint: `Recreate it with \`crossbind docker stop ${role}\`, \`crossbind docker delete ${role}\` and \`crossbind docker create ${role}\`, which mount ${work.root} at ${containerRoot}.`,
            mountNote: `It predates the ${source.name} mount.`,
        });
        runnerArgs = ['exec', ...envArgs, '--user', getOsUserAndGroupId(), '--workdir', work.toolDir, name];
    } else {
        pullDockerImage(role, platform);
        runnerArgs = [
            'run',
            '--rm',
            ...(platform ? ['--platform', platform] : []),
            ...DOCKER_RUN_SECURITY_ARGS,
            '-v',
            `${work.store}:${work.storePath()}`,
            '-v',
            `${work.dir}:${work.toolDir}`,
            ...envArgs,
            '--user',
            getOsUserAndGroupId(),
            '--workdir',
            work.toolDir,
            getDockerImage(role, platform),
        ];
    }
    return spawnSync('docker', [...runnerArgs, ...command], SPAWN_OPTIONS);
}
