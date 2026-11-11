import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    LIMITS, SANDBOX_SECCOMP_FD, runSandboxed, sandboxArgv,
} from './sandbox.js';
import { seccompProgram } from './seccomp.js';
import { configSource } from './packages.js';

const MiB = 1024 * 1024;

export const PATHS = Object.freeze({
    template: '/srv/playground/template',
    work: '/srv/playground/work',
    cli: '/opt/playground/cli',
    home: '/opt/playground/home',
    // Every package's crates and Conan builds (packages.js), fetched and built when the image was. The server's user
    // owns it, as the sandbox can write a file through an overlay only if its own user may write the file.
    store: '/srv/playground/store',
});

export const OUTPUT_NAME = 'playground-wasm-wasm32-st-debug.browser';
// Far above a playground module (the sample is 260 kB of loader and 440 kB of wasm), far below what the Worker
// in front can hold.
export const OUTPUT_LIMITS = Object.freeze({ js: 2 * MiB, wasm: 6 * MiB, imports: MiB });

const EM_CACHE = '/emsdk/upstream/emscripten/cache';

// The web image's toolchain environment; nothing of the server's own environment reaches a compile.
const TOOLCHAIN_ENV = Object.freeze({
    PATH: '/emsdk/upstream/emscripten:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
    HOME: '/tmp/home',
    EMSDK: '/emsdk',
    EM_CONFIG: '/emsdk/.emscripten',
    EM_CACHE,
    EMSDK_NODE: '/usr/local/bin/node',
    EM_FROZEN_CACHE: '1',
    RUSTUP_HOME: '/usr/local/rustup',
    // The store holds every crate a package needs, and the sandbox has no network to fetch one with.
    CARGO_NET_OFFLINE: 'true',
});

// The store's two halves where crossbind keeps them under HOME (runCargo.js cargoHome, runPackageSource.js sourceRoot under
// LOCAL). Both are written to even when nothing new is built, so each compile gets a throwaway layer over them.
const storesOf = (paths) => [
    { from: `${paths.store}/cargo`, to: '/tmp/home/.crossbind/cargo' },
    { from: `${paths.store}/conan`, to: '/tmp/home/.crossbind/conan-local' },
];

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
        // Rust's wasm sysroots and Conan's Python live outside /usr.
        readOnly: ['/usr', '/etc/alternatives', '/emsdk', '/opt/crossbind/rust', '/opt/conan', paths.cli],
        // emcc takes a lock in its cache even for files it already has.
        overlays: [EM_CACHE],
        files: { '/tmp/home/.crossbind.json': `${paths.home}/.crossbind.json` },
        stores: storesOf(paths),
        masks: PROC_MASKS.filter((file) => fs.existsSync(file)),
        seccompFd: SANDBOX_SECCOMP_FD,
        env: TOOLCHAIN_ENV,
        command,
    }, limits);
}

export const runSandboxedCompile = (argv, limits = LIMITS, run = runSandboxed) => run(argv, { ...limits, seccomp: SECCOMP });

// --bind-imports: the page maps main.js's imports itself, from the list the build writes beside the module.
const buildCommand = (paths) => ['node', `${paths.cli}/node_modules/crossbind/src/bin.js`, 'build', '-p', 'wasm', '-a', 'wasm32', '-r', 'st', '-e', 'browser', '-b', 'debug', '--bind-imports'];

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

// Every file name is main.js or native/<name> (validate.js), so each lands under src/. The template's own sources
// go first, or the build would bind them too. The config is the compiler's own.
function writeProject(workDir, { files, packages }) {
    try {
        const src = path.join(workDir, 'src');
        fs.rmSync(path.join(src, 'native'), { recursive: true, force: true });
        fs.rmSync(path.join(src, 'main.js'), { force: true });
        fs.mkdirSync(path.join(src, 'native'), { recursive: true });
        Object.entries(files).forEach(([name, text]) => fs.writeFileSync(path.join(src, name), text));
        fs.writeFileSync(path.join(workDir, 'crossbind.config.js'), configSource(packages));
    } catch (error) {
        throw new WorkspaceError(`the project could not be written: ${error.message}`);
    }
}

// CMake names an object file after its source's whole path (CMakeFiles/<target>.dir/<path>.o), so there the path goes
// but its separator stays.
function cleanLog(output, paths) {
    const prefixes = [`${paths.work}/src/native/`, `${paths.work}/`, `${paths.cli}/node_modules/`];
    return prefixes.reduce((log, prefix) => log.replaceAll(`.dir${prefix}`, '.dir/').replaceAll(prefix, ''), output).trim();
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

// __proto__ would set an object's prototype where the page keys an object by name.
const IDENTIFIER = /^(?!__proto__$)[A-Za-z_$][\w$]*$/;
// A project-relative path and a bare specifier, as the build writes them.
const FILE = /^[\w@./+-]{1,300}$/;
const SPECIFIER = /^[\w@./:+-]{1,200}$/;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const isName = (name) => (typeof name === 'string' ? matches(IDENTIFIER, name) : matches(IDENTIFIER, name?.local) && matches(IDENTIFIER, name?.wire));
const isNative = (native) => matches(FILE, native?.file)
    && Array.isArray(native.specifiers) && native.specifiers.every((specifier) => matches(SPECIFIER, specifier))
    && Array.isArray(native.names) && native.names.every(isName);

// What --bind-imports wrote. The page turns its names into code, so anything but identifiers is refused, and only
// the known fields are passed on.
function parseImports(bytes) {
    let imports;
    try {
        imports = JSON.parse(bytes.toString('utf8'));
    } catch {
        throw new OutputError();
    }
    if (!Array.isArray(imports?.natives) || !imports.natives.every(isNative)) throw new OutputError();
    return {
        natives: imports.natives.map(({ file, specifiers, names }) => ({
            file,
            specifiers: [...specifiers],
            names: names.map((name) => (typeof name === 'string' ? name : { local: name.local, wire: name.wire })),
        })),
    };
}

// The build ran as the sandbox, so any folder or file on these paths may be a link pointing the server at its
// own files; only regular files reached through real folders are read, and the sandbox is gone by now.
function readOutputs(workDir, limits) {
    const buildDir = path.join(workDir, '.crossbind', 'build');
    try {
        const realBuildDir = path.join(fs.realpathSync(workDir), '.crossbind', 'build');
        if (fs.realpathSync(buildDir) !== realBuildDir) return null;
        if (fs.realpathSync(path.join(buildDir, 'browser')) !== path.join(realBuildDir, 'browser')) return null;
        return {
            js: readRegularFile(path.join(buildDir, `${OUTPUT_NAME}.js`), limits.js),
            wasm: readRegularFile(path.join(buildDir, `${OUTPUT_NAME}.wasm`), limits.wasm),
            imports: parseImports(readRegularFile(path.join(buildDir, 'browser', 'imports.json'), limits.imports)),
        };
    } catch (error) {
        if (error instanceof OutputError || NO_USABLE_OUTPUT.has(error.code)) return null;
        throw error;
    }
}

const STOPPED = Object.freeze({ timedOut: 'timeout', outOfMemory: 'memory', flooded: 'output' });

// request is what validateRequest returned: { files, packages }.
export async function compile(request, {
    paths = PATHS, run = runSandboxed, limits = LIMITS, outputLimits = OUTPUT_LIMITS,
} = {}) {
    resetWorkspace(paths);
    try {
        writeProject(paths.work, request);
        const result = await runSandboxedCompile(compileSandboxArgv(paths, buildCommand(paths), limits), limits, run);
        const log = cleanLog(result.output, paths);
        const stopped = Object.keys(STOPPED).find((flag) => result[flag]);
        if (stopped) return { ok: false, reason: STOPPED[stopped], log };
        if (result.code !== 0) return { ok: false, reason: 'compile', log };
        const outputs = readOutputs(paths.work, outputLimits);
        if (!outputs) return { ok: false, reason: 'output', log };
        return {
            ok: true, js: outputs.js.toString('utf8'), wasm: outputs.wasm.toString('base64'), imports: outputs.imports, log, ms: result.ms,
        };
    } finally {
        removeTree(paths.work);
    }
}
