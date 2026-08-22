import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import state from '../state/index.js';
import getOsUserAndGroupId from './getOsUserAndGroupId.js';
import replaceBasePathForDockerUtil, { DOCKER_BASE } from './replaceBasePathForDocker.js';
import pullDockerImage, { getDockerImage, getDockerContainerName, imageRoleFor } from './pullDockerImage.js';

// Every cargo invocation crossbind makes goes through here.
//
// Cargo takes flags from three channels: the process environment, $CARGO_HOME/config.toml, and any
// .cargo/config.toml found by walking up from the CURRENT WORKING DIRECTORY. The last one is the
// dangerous leg - a file above the crate can hand rustc a different compiler, extra codegen flags
// or -Z unstable features, and cargo discovers it purely from cwd. So: rustflags are injected
// through the process environment (which wins over both config channels), and the config legs are
// closed by running from a neutral directory with a crossbind-owned CARGO_HOME.
//
// Where it runs follows the runner. A containerized build runs cargo in the image that carries the
// pinned toolchain, so a project needs Docker and Node and no host Rust. The registry cache is
// bind-mounted rather than kept in a named volume, which keeps it shared across projects, visible
// from the host, and addressable - bridge generation reads crate sources out of it.

// Cargo splits this variable on 0x1F, one argv per flag - never a space.
const RUSTFLAGS_SEPARATOR = String.fromCharCode(0x1f);

// The environment is rebuilt from nothing and only these survive, so a variable that can redirect
// the compiler - RUSTC_WRAPPER, CARGO_BUILD_RUSTC, CARGO_TARGET_<TRIPLE>_LINKER, RUSTFLAGS,
// RUSTUP_TOOLCHAIN, RUSTC_BOOTSTRAP - cannot reach cargo from the caller's environment.
const ALLOWED_ENV = [
    /^PATH$/, /^HOME$/, /^USER$/, /^LOGNAME$/, /^SHELL$/, /^TERM$/,
    /^TMPDIR$/, /^TEMP$/, /^TMP$/,
    /^LANG$/, /^LC_[A-Z_]+$/,
    /^RUSTUP_HOME$/,
    /^SSH_AUTH_SOCK$/, // git dependencies over ssh
    /^CARGO_NET_/, /^CARGO_REGISTRIES_/, // offline/vendored builds and private registries
    /^(HTTP|HTTPS|ALL|NO)_PROXY$/i,
    /^SYSTEMROOT$/i, /^WINDIR$/i, /^USERPROFILE$/i, /^PROGRAMDATA$/i, // windows cannot spawn without these
];

// Recent cargo applies config.toml only, but the extensionless name is still read by older
// versions - both are checked so a behaviour change between versions cannot open the gap.
const CONFIG_NAMES = ['config.toml', 'config'];

// Where the image puts CARGO_HOME (base.Dockerfile), and a directory outside any project so
// cargo's upward config search finds nothing.
const CONTAINER_CARGO_HOME = '/var/cache/crossbind/cargo';
const CONTAINER_CWD = '/tmp/crossbind-cargo';

// Crossbind-owned and machine-wide: $CARGO_HOME/config.toml is one of the discovery legs, so the
// registry cache lives somewhere we can assert is clean instead of in the user's ~/.cargo. It is
// also the directory bind-mounted into the container, which is why it must not sit inside a
// project - `pnpm run clear` would otherwise throw away every downloaded crate.
export function cargoHome() {
    return path.join(os.homedir(), '.crossbind', 'cargo');
}

// The inverse of the two bind mounts. cargo reports paths as the container sees them, and the
// mounts are the only way in, so mapping their prefixes back is exact rather than a guess. Bridge
// generation reads crate sources straight off the host: without this it looks for a path that
// exists only inside the container, finds no source, and silently emits a bridge binding nothing.
export function toHostPath(containerPath) {
    const base = state.config?.paths?.base;
    const mounts = [[CONTAINER_CARGO_HOME, cargoHome()], ...(base ? [[DOCKER_BASE, base]] : [])];
    const hit = mounts.find(([from]) => containerPath === from || containerPath.startsWith(`${from}/`));
    return hit ? path.join(hit[1], containerPath.slice(hit[0].length)) : containerPath;
}

// Outside the project and outside $HOME, so the upward walk never reaches ~/.cargo or a config
// the project tree happens to carry.
export function neutralCwd() {
    return path.join(os.tmpdir(), 'crossbind-cargo');
}

export function assertCleanConfigChain(home, cwd) {
    for (const name of CONFIG_NAMES) {
        const file = path.join(home, name);
        if (fs.existsSync(file)) {
            throw new Error(`crossbind: unexpected cargo config at ${file} - crossbind owns this CARGO_HOME and never writes one. Remove it and build again.`);
        }
    }
    for (let dir = cwd; ; dir = path.dirname(dir)) {
        for (const name of CONFIG_NAMES) {
            const file = path.join(dir, '.cargo', name);
            if (fs.existsSync(file)) {
                throw new Error(`crossbind: ${file} would apply to this build - cargo discovers config by walking up from the working directory. crossbind builds from a neutral directory to avoid that; move the file or report this.`);
            }
        }
        if (path.dirname(dir) === dir) return;
    }
}

// iOS links with Xcode, which is in no image, so its Rust stays on the host - as does every build
// under RUNNER=LOCAL.
export function cargoRunner(target) {
    if (target?.platform === 'ios') return 'LOCAL';
    const runner = state.config?.system?.RUNNER;
    return runner === 'DOCKER_RUN' || runner === 'DOCKER_EXEC' ? runner : 'LOCAL';
}

function allowedEnv() {
    const env = {};
    Object.entries(process.env).forEach(([key, value]) => {
        if (ALLOWED_ENV.some((allowed) => allowed.test(key))) env[key] = value;
    });
    return env;
}

function cargoEnv({
    home, rustflags, panic, allowUnstable,
}) {
    const env = { CARGO_HOME: home };
    // Depth defence: -Z fails with E0554 instead of quietly enabling unstable behaviour. The value
    // -1 disables unstable features on EVERY channel, nightly included, so the one caller that
    // still needs -Zbuild-std has to opt out - and only until that path is deleted. Leaving it
    // unset is still safe: the caller's own RUSTC_BOOTSTRAP never survives the allowlist.
    if (!allowUnstable) env.RUSTC_BOOTSTRAP = '-1';
    if (rustflags.length) env.CARGO_ENCODED_RUSTFLAGS = rustflags.join(RUSTFLAGS_SEPARATOR);
    // The environment beats the crate's own [profile.release], so a hand-written crate cannot opt
    // out of the panic strategy the std it links against was built with.
    if (panic) env.CARGO_PROFILE_RELEASE_PANIC = panic;
    return env;
}

// docker exec attaches to a container the user created; crossbind never creates one, and until
// now nothing checked what it carries. A container missing the cargo mount is the worst case: cargo
// keeps its registry inside the container, so bridge generation reads a crate source from a host
// path that was never written and emits a bridge that binds nothing - silently. Fail first, and say
// exactly how to fix it, because the container name and mounts are otherwise undocumented.
function createHint(name, base, home, image) {
    return [
        'Create it with:',
        `  docker run -d --name ${name} \\`,
        `    -v ${base}:${DOCKER_BASE} \\`,
        `    -v ${home}:${CONTAINER_CARGO_HOME} \\`,
        `    ${image} sleep infinity`,
    ].join('\n');
}

function samePath(a, b) {
    const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
    return real(a) === real(b);
}

function assertExecContainer(name, base, home, image) {
    const hint = createHint(name, base, home, image);
    let info;
    try {
        // stderr is dropped: docker's own "No such container" would land before the message below.
        info = JSON.parse(execFileSync('docker', ['container', 'inspect', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))[0];
    } catch {
        throw new Error(`crossbind: RUNNER=DOCKER_EXEC needs a container named '${name}', which does not exist.\n${hint}`);
    }
    if (!info?.State?.Running) {
        throw new Error(`crossbind: the container '${name}' exists but is not running. Start it with \`docker start ${name}\`, or recreate it.\n${hint}`);
    }
    for (const [destination, source] of [[DOCKER_BASE, base], [CONTAINER_CARGO_HOME, home]]) {
        const mount = (info.Mounts ?? []).find((m) => m.Destination === destination);
        if (!mount || !samePath(mount.Source, source)) {
            const found = mount ? ` - it mounts ${mount.Source} there` : '';
            throw new Error(`crossbind: the container '${name}' does not mount ${source} at ${destination}${found}. It predates the cargo mount, so recreate it.\n${hint}`);
        }
    }
    // `docker run --workdir` creates the directory; `docker exec --workdir` does not, and cargo
    // dies with an OCI "chdir to cwd" error that names nothing the user can act on.
    try {
        execFileSync('docker', ['exec', '--user', getOsUserAndGroupId(), name, 'mkdir', '-p', CONTAINER_CWD], { stdio: 'ignore' });
    } catch (e) {
        throw new Error(`crossbind: could not create the working directory ${CONTAINER_CWD} inside '${name}'.\n${hint}`, { cause: e });
    }
}

export default function runCargo(args, {
    cwd, rustflags = [], panic, capture = false, maxBuffer, allowUnstable = false, target,
} = {}) {
    const home = cargoHome();
    const workdir = cwd ?? neutralCwd();
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(workdir, { recursive: true });
    // Checked on the host in both modes: the container sees the same directory through the mount.
    assertCleanConfigChain(home, workdir);

    const runner = cargoRunner(target);
    const stdio = capture ? ['ignore', 'pipe', 'pipe'] : 'inherit';
    const options = { stdio, ...(capture ? { encoding: 'utf8' } : {}), ...(maxBuffer ? { maxBuffer } : {}) };

    if (runner === 'LOCAL') {
        return spawnSync('cargo', args, {
            cwd: workdir,
            env: { ...allowedEnv(), ...cargoEnv({ home, rustflags, panic, allowUnstable }) },
            ...options,
        });
    }

    const { base } = state.config.paths;
    const role = imageRoleFor(target);
    // Google ships the linux NDK host tools for x86_64 only.
    const platform = target?.platform === 'android' ? 'linux/amd64' : undefined;

    // Only what cargo needs travels in: the image already carries PATH, RUSTUP_HOME and the
    // toolchain, and the host's PATH would be meaningless there.
    const env = cargoEnv({
        home: CONTAINER_CARGO_HOME, rustflags, panic, allowUnstable,
    });
    const envArgs = Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]);

    let runnerArgs;
    if (runner === 'DOCKER_EXEC') {
        const name = getDockerContainerName(base, role);
        assertExecContainer(name, base, home, getDockerImage(role, platform));
        runnerArgs = ['exec', ...envArgs,
            '--user', getOsUserAndGroupId(),
            '--workdir', CONTAINER_CWD,
            name];
    } else {
        pullDockerImage(role, platform);
        runnerArgs = ['run', '--rm',
            ...(platform ? ['--platform', platform] : []),
            '-v', `${base}:${DOCKER_BASE}`,
            '-v', `${home}:${CONTAINER_CARGO_HOME}`,
            ...envArgs,
            '--user', getOsUserAndGroupId(),
            '--workdir', CONTAINER_CWD,
            getDockerImage(role, platform)];
    }

    return spawnSync('docker', [...runnerArgs, 'cargo', ...replaceBasePathForDockerUtil(args, base)], options);
}
