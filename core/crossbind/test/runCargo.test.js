import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Cargo reads flags from the process environment, $CARGO_HOME/config.toml and any .cargo/config
// found by walking up from the working directory. These tests pin what the caller's environment
// and the filesystem are allowed to contribute - a leak here is a different compiler, silently.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));

// Where cargo runs follows the runner, so the runner belongs in the fixture rather than being read
// from whatever ~/.crossbind.json happens to say on the machine running the suite.
const holder = { config: { paths: { base: '/repo' }, system: {} } };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));

const setRunner = (RUNNER) => { holder.config = { paths: { base: '/repo' }, system: { RUNNER } }; };

let work;

async function importFresh() {
    vi.resetModules();
    const { spawnSync } = await import('node:child_process');
    // The mock instance outlives resetModules, so calls[0] would otherwise be an earlier test's.
    spawnSync.mockClear();
    spawnSync.mockReturnValue({ status: 0, stdout: '' });
    const mod = await import('../src/utils/runCargo.js');
    return { mod, spawnSync };
}

const envOf = (spawnSync) => spawnSync.mock.calls[0][2].env;

beforeEach(() => {
    setRunner(undefined);
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runcargo-'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(work, 'home'));
    vi.spyOn(os, 'tmpdir').mockReturnValue(path.join(work, 'tmp'));
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(work, { recursive: true, force: true });
});

describe('runCargo environment', () => {
    test('drops every variable that can redirect the compiler', async () => {
        vi.stubEnv('RUSTC_WRAPPER', '/tmp/evil');
        vi.stubEnv('RUSTC_WORKSPACE_WRAPPER', '/tmp/evil');
        vi.stubEnv('CARGO_BUILD_RUSTC', '/tmp/evil-rustc');
        vi.stubEnv('CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER', '/tmp/evil-ld');
        vi.stubEnv('RUSTFLAGS', '-C opt-level=0');
        vi.stubEnv('CARGO_ENCODED_RUSTFLAGS', '-C opt-level=0');
        vi.stubEnv('RUSTC_BOOTSTRAP', '1');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build']);

        const env = envOf(spawnSync);
        expect(env.RUSTC_WRAPPER).toBeUndefined();
        expect(env.RUSTC_WORKSPACE_WRAPPER).toBeUndefined();
        expect(env.CARGO_BUILD_RUSTC).toBeUndefined();
        expect(env.CARGO_TARGET_WASM32_UNKNOWN_EMSCRIPTEN_LINKER).toBeUndefined();
        expect(env.RUSTFLAGS).toBeUndefined();
        expect(env.CARGO_ENCODED_RUSTFLAGS).toBeUndefined();
        // Not merely dropped: pinned, so a -Z on a stable toolchain fails with E0554.
        expect(env.RUSTC_BOOTSTRAP).toBe('-1');
    });

    test('leaves the bootstrap pin off when the caller needs unstable flags', async () => {
        // -1 disables unstable features on every channel, nightly included, so the nightly
        // -Zbuild-std rebuild would fail with E0554 under the pin. Dropping the pin still does not
        // let the caller's own value through - the allowlist already removed it.
        vi.stubEnv('RUSTC_BOOTSTRAP', '1');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build'], { allowUnstable: true });

        expect(envOf(spawnSync).RUSTC_BOOTSTRAP).toBeUndefined();
    });

    test('keeps what cargo needs to run at all', async () => {
        vi.stubEnv('CARGO_NET_OFFLINE', 'true');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build']);

        const env = envOf(spawnSync);
        expect(env.PATH).toBe(process.env.PATH);
        expect(env.HOME).toBe(process.env.HOME);
        // Vendored/offline builds are configured through cargo's own variable, not a crossbind flag.
        expect(env.CARGO_NET_OFFLINE).toBe('true');
    });

    test('points CARGO_HOME at the crossbind-owned cache, never the user one', async () => {
        const { mod, spawnSync } = await importFresh();

        mod.default(['build']);

        expect(envOf(spawnSync).CARGO_HOME).toBe(path.join(work, 'home', '.crossbind', 'cargo'));
    });

    test('encodes rustflags with cargo separator, one argv per flag', async () => {
        const { mod, spawnSync } = await importFresh();

        mod.default(['build'], { rustflags: ['-Ctarget-feature=+atomics', '-Cpanic=abort'] });

        expect(envOf(spawnSync).CARGO_ENCODED_RUSTFLAGS)
            .toBe(`-Ctarget-feature=+atomics${String.fromCharCode(0x1f)}-Cpanic=abort`);
    });

    test('forces the panic strategy only when one is asked for', async () => {
        const { mod, spawnSync } = await importFresh();

        mod.default(['build'], { panic: 'abort' });
        expect(envOf(spawnSync).CARGO_PROFILE_RELEASE_PANIC).toBe('abort');

        spawnSync.mockClear();
        mod.default(['build']);
        expect(envOf(spawnSync).CARGO_PROFILE_RELEASE_PANIC).toBeUndefined();
    });

    test('runs from a neutral directory outside the home tree', async () => {
        const { mod, spawnSync } = await importFresh();

        mod.default(['build']);

        const { cwd } = spawnSync.mock.calls[0][2];
        expect(cwd).toBe(path.join(work, 'tmp', 'crossbind-cargo'));
        expect(cwd.startsWith(os.homedir())).toBe(false);
        expect(fs.existsSync(cwd)).toBe(true);
    });
});

describe('where cargo runs', () => {
    const argvOf = (spawnSync) => spawnSync.mock.calls[0][1];

    test('a containerized runner runs cargo in the image, not on the host', async () => {
        // The point of the whole move: a project needs Docker and Node, not a host Rust install.
        setRunner('DOCKER_RUN');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build', '--manifest-path', '/repo/pkg/Cargo.toml'], { target: { platform: 'wasm' } });

        const [command] = spawnSync.mock.calls[0];
        const argv = argvOf(spawnSync);
        expect(command).toBe('docker');
        expect(argv).toContain('cargo');
        // Project paths are rewritten to where the mount puts them.
        expect(argv).toContain('/tmp/crossbind/live/pkg/Cargo.toml');
        expect(argv.join(' ')).toContain('/repo:/tmp/crossbind/live');
        // The registry cache is bind-mounted, which is what keeps crate sources readable from the
        // host for bridge generation.
        expect(argv.join(' ')).toContain(`${path.join(work, 'home', '.crossbind', 'cargo')}:/var/cache/crossbind/cargo`);
    });

    test('ios stays on the host even under a containerized runner', async () => {
        // Xcode is in no image, so the linker only exists on the host.
        setRunner('DOCKER_RUN');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build'], { target: { platform: 'ios' } });

        expect(spawnSync.mock.calls[0][0]).toBe('cargo');
    });

    // DOCKER_EXEC attaches to a container the user made by hand; crossbind never creates it, and
    // the name and mounts are documented nowhere. A container without the cargo mount keeps the
    // registry inside itself, so bridge generation reads a host path that was never written and
    // binds nothing - the same silent failure the host-path mapping just fixed, by another route.
    const inspectReturning = (execFileSync, mounts, running = true) => {
        execFileSync.mockImplementation((cmd, argv) => {
            if (cmd === 'docker' && argv[0] === 'container') {
                return JSON.stringify([{ State: { Running: running }, Mounts: mounts }]);
            }
            return '';
        });
    };
    const bothMounts = () => [
        { Destination: '/tmp/crossbind/live', Source: '/repo' },
        { Destination: '/var/cache/crossbind/cargo', Source: path.join(work, 'home', '.crossbind', 'cargo') },
    ];

    test('DOCKER_EXEC runs cargo in the existing container when its mounts are right', async () => {
        setRunner('DOCKER_EXEC');
        const { mod, spawnSync } = await importFresh();
        const { execFileSync } = await import('node:child_process');
        inspectReturning(execFileSync, bothMounts());

        mod.default(['build'], { target: { platform: 'wasm' } });

        const argv = argvOf(spawnSync);
        expect(spawnSync.mock.calls[0][0]).toBe('docker');
        expect(argv[0]).toBe('exec');
        expect(argv).toContain('cargo');
    });

    test('DOCKER_EXEC creates the working directory the exec flag will not', async () => {
        // `docker run --workdir` creates the directory, `docker exec --workdir` does not. Without
        // this the runtime refuses the exec with an OCI "chdir to cwd" error naming nothing the
        // user can act on - and no unit test saw it, because only a real container has a real /tmp.
        setRunner('DOCKER_EXEC');
        const { mod } = await importFresh();
        const { execFileSync } = await import('node:child_process');
        inspectReturning(execFileSync, bothMounts());

        mod.default(['build'], { target: { platform: 'wasm' } });

        const mkdir = execFileSync.mock.calls.find((c) => c[1]?.includes('mkdir'));
        expect(mkdir).toBeDefined();
        expect(mkdir[1]).toEqual(expect.arrayContaining(['exec', 'mkdir', '-p', '/tmp/crossbind-cargo']));
    });

    test('DOCKER_EXEC fails with the create command when the container is missing', async () => {
        setRunner('DOCKER_EXEC');
        const { mod } = await importFresh();
        const { execFileSync } = await import('node:child_process');
        execFileSync.mockImplementation(() => { throw new Error('No such container'); });

        expect(() => mod.default(['build'], { target: { platform: 'wasm' } }))
            .toThrow(/does not exist[\s\S]*docker run -d --name crossbind-/);
    });

    test('DOCKER_EXEC fails when the container predates the cargo mount', async () => {
        setRunner('DOCKER_EXEC');
        const { mod } = await importFresh();
        const { execFileSync } = await import('node:child_process');
        inspectReturning(execFileSync, [{ Destination: '/tmp/crossbind/live', Source: '/repo' }]);

        expect(() => mod.default(['build'], { target: { platform: 'wasm' } }))
            .toThrow(/does not mount[\s\S]*var\/cache\/crossbind\/cargo/);
    });

    test('DOCKER_EXEC fails when the container is stopped', async () => {
        setRunner('DOCKER_EXEC');
        const { mod } = await importFresh();
        const { execFileSync } = await import('node:child_process');
        inspectReturning(execFileSync, bothMounts(), false);

        expect(() => mod.default(['build'], { target: { platform: 'wasm' } }))
            .toThrow(/not running[\s\S]*docker start/);
    });

    test('android forces the amd64 platform', async () => {
        setRunner('DOCKER_RUN');
        const { mod, spawnSync } = await importFresh();

        mod.default(['build'], { target: { platform: 'android' } });

        expect(argvOf(spawnSync).join(' ')).toContain('--platform linux/amd64');
    });
});

describe('assertCleanConfigChain', () => {
    test('rejects a config planted in the crossbind CARGO_HOME', async () => {
        // The cache is a writable, long-lived directory: a dependency build script could drop a
        // config there and own every later build.
        const { mod } = await importFresh();
        const home = path.join(work, 'cargo-home');
        fs.mkdirSync(home, { recursive: true });
        fs.writeFileSync(path.join(home, 'config.toml'), '[env]\nRUSTC_BOOTSTRAP = { value = "1", force = true }\n');

        expect(() => mod.assertCleanConfigChain(home, path.join(work, 'tmp'))).toThrow(/crossbind owns this CARGO_HOME/);
    });

    test('rejects the extensionless name too', async () => {
        // Current cargo ignores it; older versions apply it, and the gap must not depend on which.
        const { mod } = await importFresh();
        const home = path.join(work, 'cargo-home-2');
        fs.mkdirSync(home, { recursive: true });
        fs.writeFileSync(path.join(home, 'config'), '[build]\nrustflags = ["-Cpanic=unwind"]\n');

        expect(() => mod.assertCleanConfigChain(home, path.join(work, 'tmp'))).toThrow(/crossbind owns this CARGO_HOME/);
    });

    test('rejects a config discoverable above the working directory', async () => {
        const { mod } = await importFresh();
        const home = path.join(work, 'clean-home');
        const deep = path.join(work, 'a', 'b', 'c');
        fs.mkdirSync(deep, { recursive: true });
        fs.mkdirSync(path.join(work, 'a', '.cargo'), { recursive: true });
        fs.writeFileSync(path.join(work, 'a', '.cargo', 'config.toml'), '[build]\nrustflags = ["-Cdebuginfo=0"]\n');

        expect(() => mod.assertCleanConfigChain(home, deep)).toThrow(/would apply to this build/);
    });

    test('accepts a clean chain', async () => {
        const { mod } = await importFresh();
        const home = path.join(work, 'clean-home');
        const dir = path.join(work, 'x', 'y');
        fs.mkdirSync(dir, { recursive: true });

        expect(() => mod.assertCleanConfigChain(home, dir)).not.toThrow();
    });
});

describe('toHostPath', () => {
    // The bug this pins: cargo metadata runs in the container and reports container paths, but
    // bridge generation reads the crate source on the host. Without the inverse mapping it found
    // no source and emitted a bridge that bound nothing - a silently empty module, not an error.
    test('maps the cargo home mount back to the host', async () => {
        const { mod } = await importFresh();
        const hostSrc = path.join(mod.cargoHome(), 'registry', 'src', 'index.crates.io-x', 'semver-1.0.28');
        expect(mod.toHostPath('/var/cache/crossbind/cargo/registry/src/index.crates.io-x/semver-1.0.28'))
            .toBe(hostSrc);
    });

    test('maps the project mount back to the host', async () => {
        const { mod } = await importFresh();
        expect(mod.toHostPath('/tmp/crossbind/live/e2e/web-vite/Cargo.toml'))
            .toBe(path.join('/repo', 'e2e', 'web-vite', 'Cargo.toml'));
    });

    test('leaves a path outside every mount alone', async () => {
        const { mod } = await importFresh();
        expect(mod.toHostPath('/usr/local/rustup/toolchains/x/lib')).toBe('/usr/local/rustup/toolchains/x/lib');
        // A prefix that only looks like the mount must not be rewritten.
        expect(mod.toHostPath('/tmp/crossbind/live-other/x')).toBe('/tmp/crossbind/live-other/x');
    });
});
