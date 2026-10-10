import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    LIMITS, SANDBOX_SECCOMP_FD, runSandboxed, sandboxArgv,
} from './sandbox.js';
import { seccompProgram } from './seccomp.js';

const MiB = 1024 * 1024;

export const PATHS = Object.freeze({
    template: '/srv/playground/template',
    work: '/srv/playground/work',
    cli: '/opt/playground/cli',
    home: '/opt/playground/home',
});

export const OUTPUT_NAME = 'playground-wasm-wasm32-st-debug.browser';
// Far above a playground module (the sample is 260 kB of loader and 440 kB of wasm), far below what the Worker
// in front can hold.
export const OUTPUT_LIMITS = Object.freeze({ js: 2 * MiB, wasm: 6 * MiB });

const EM_CACHE = '/emsdk/upstream/emscripten/cache';

// The web image's toolchain environment; nothing of the server's own environment reaches a compile.
const TOOLCHAIN_ENV = Object.freeze({
    PATH: '/emsdk/upstream/emscripten:/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp/home',
    EMSDK: '/emsdk',
    EM_CONFIG: '/emsdk/.emscripten',
    EM_CACHE,
    EMSDK_NODE: '/usr/local/bin/node',
    EM_FROZEN_CACHE: '1',
});

// Kernel files of /proc a compile has no use for, such as the microVM's boot command line.
const PROC_MASKS = Object.freeze(['/proc/cmdline', '/proc/config.gz', '/proc/modules', '/proc/keys', '/proc/kallsyms', '/proc/sched_debug', '/proc/timer_list']);
const SECCOMP = seccompProgram();

const OPEN_OUTPUT = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
const NO_USABLE_OUTPUT = new Set(['ENOENT', 'ELOOP', 'EMLINK', 'ENOTDIR', 'EISDIR', 'ENXIO', 'EACCES']);

class OutputError extends Error {}

// The workspace could not be cleared or set up: no later compile can run in it (see server.js).
export class WorkspaceError extends Error {}

// Exported for the self-test, so it probes exactly the sandbox a compile runs in.
export function compileSandboxArgv(paths, command, limits = LIMITS) {
    return sandboxArgv({
        workDir: paths.work,
        readOnly: ['/usr', '/etc/alternatives', '/emsdk', paths.cli],
        // emcc takes a lock in its cache even for files it already has.
        overlays: [EM_CACHE],
        files: { '/tmp/home/.crossbind.json': `${paths.home}/.crossbind.json` },
        masks: PROC_MASKS.filter((file) => fs.existsSync(file)),
        seccompFd: SANDBOX_SECCOMP_FD,
        env: TOOLCHAIN_ENV,
        command,
    }, limits);
}

export const runSandboxedCompile = (argv, limits = LIMITS, run = runSandboxed) => run(argv, { ...limits, seccomp: SECCOMP });

const buildCommand = (paths) => ['node', `${paths.cli}/node_modules/crossbind/src/bin.js`, 'build', '-p', 'wasm', '-a', 'wasm32', '-r', 'st', '-e', 'browser', '-b', 'debug'];

// A build can leave folders without permissions and trees deeper than a path can name. chmod -R and rm -rf walk
// them by descriptor, and the build ran as this server's user, so every mode can be reset.
export function removeTree(dir) {
    spawnSync('chmod', ['-R', 'u+rwx', '--', dir], { stdio: 'ignore' });
    const removal = spawnSync('rm', ['-rf', '--', dir], { stdio: 'ignore' });
    if (removal.status !== 0 || fs.existsSync(dir)) throw new WorkspaceError(`${dir} could not be removed`);
}

export function resetWorkspace(paths) {
    removeTree(paths.work);
    try {
        fs.cpSync(paths.template, paths.work, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
    } catch (error) {
        throw new WorkspaceError(`the template could not be copied: ${error.message}`);
    }
}

function writeSources(workDir, files) {
    try {
        Object.entries(files).forEach(([name, text]) => fs.writeFileSync(path.join(workDir, 'src', 'native', name), text));
    } catch (error) {
        throw new WorkspaceError(`the sources could not be written: ${error.message}`);
    }
}

function cleanLog(output, paths) {
    return output
        .replaceAll(`${paths.work}/src/native/`, '')
        .replaceAll(`${paths.work}/`, '')
        .replaceAll(`${paths.cli}/node_modules/`, '')
        .trim();
}

function readRegularFile(file, maxBytes) {
    const fd = fs.openSync(file, OPEN_OUTPUT);
    try {
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.size > maxBytes) throw new OutputError();
        return fs.readFileSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

// The build ran as the sandbox, so any folder or file on these paths may be a link pointing the server at its
// own files; only regular files reached through real folders are read, and the sandbox is gone by now.
function readOutputs(workDir, limits) {
    const buildDir = path.join(workDir, '.crossbind', 'build');
    try {
        if (fs.realpathSync(buildDir) !== path.join(fs.realpathSync(workDir), '.crossbind', 'build')) return null;
        return {
            js: readRegularFile(path.join(buildDir, `${OUTPUT_NAME}.js`), limits.js),
            wasm: readRegularFile(path.join(buildDir, `${OUTPUT_NAME}.wasm`), limits.wasm),
        };
    } catch (error) {
        if (error instanceof OutputError || NO_USABLE_OUTPUT.has(error.code)) return null;
        throw error;
    }
}

const STOPPED = Object.freeze({ timedOut: 'timeout', outOfMemory: 'memory', flooded: 'output' });

export async function compile(files, {
    paths = PATHS, run = runSandboxed, limits = LIMITS, outputLimits = OUTPUT_LIMITS,
} = {}) {
    resetWorkspace(paths);
    try {
        writeSources(paths.work, files);
        const result = await runSandboxedCompile(compileSandboxArgv(paths, buildCommand(paths), limits), limits, run);
        const log = cleanLog(result.output, paths);
        const stopped = Object.keys(STOPPED).find((flag) => result[flag]);
        if (stopped) return { ok: false, reason: STOPPED[stopped], log };
        if (result.code !== 0) return { ok: false, reason: 'compile', log };
        const outputs = readOutputs(paths.work, outputLimits);
        if (!outputs) return { ok: false, reason: 'output', log };
        return { ok: true, js: outputs.js.toString('utf8'), wasm: outputs.wasm.toString('base64'), log, ms: result.ms };
    } finally {
        removeTree(paths.work);
    }
}
