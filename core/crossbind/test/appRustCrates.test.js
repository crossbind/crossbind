import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cargo runs on the host; the test asserts what the engine hands it, not the compile itself.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));
// These cases are about staging and pruning, not about where cargo runs: with no configured
// runner runCargo stays on the host, so the assertions can read the argv directly.
vi.mock('../src/state/index.js', () => ({ default: { config: { paths: {}, system: {} } } }));

const WASM = { platform: 'wasm', arch: 'wasm32' };
const TRIPLE = 'wasm32-unknown-emscripten';

let work;
let cacheDir;

async function importFresh() {
    vi.resetModules();
    const { spawnSync } = await import('node:child_process');
    const { default: buildAppRustCrates } = await import('../src/utils/appRustCrates.js');
    return { buildAppRustCrates, spawnSync };
}

function addCrate(name, userFile = null) {
    const dir = path.join(cacheDir, 'rust-bridges', name);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Cargo.toml'), `[package]\nname = "${name}-crossbind-app"\n`);
    // An app-local bridge embeds its user file via #[path]; crate_ bridges have no user mod.
    const lib = userFile ? `#[path = "${userFile}"]\nmod user;\n` : '';
    fs.writeFileSync(path.join(dir, 'src/lib.rs'), lib);
}

function fakeCargoOutput(targetDirName = 'target') {
    const lib = path.join(cacheDir, 'rust-bridges/_app_super', targetDirName, TRIPLE, 'release/libcrossbind_app_super.a');
    fs.mkdirSync(path.dirname(lib), { recursive: true });
    fs.writeFileSync(lib, '');
    return lib;
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-rust-'));
    cacheDir = path.join(work, '.crossbind');
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('buildAppRustCrates', () => {
    test('does nothing when the project has no rust bridges directory', async () => {
        const { buildAppRustCrates, spawnSync } = await importFresh();
        expect(buildAppRustCrates(WASM, cacheDir)).toEqual([]);
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('does nothing when the directory holds no crates', async () => {
        fs.mkdirSync(path.join(cacheDir, 'rust-bridges'), { recursive: true });
        const { buildAppRustCrates, spawnSync } = await importFresh();
        expect(buildAppRustCrates(WASM, cacheDir)).toEqual([]);
        expect(spawnSync).not.toHaveBeenCalled();
    });

    test('bundles every app-local surface into one super staticlib', async () => {
        addCrate('counter');
        addCrate('geo_surface');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });

        const libs = buildAppRustCrates(WASM, cacheDir);

        const superDir = path.join(cacheDir, 'rust-bridges/_app_super');
        const manifest = fs.readFileSync(path.join(superDir, 'Cargo.toml'), 'utf8');
        const lib = fs.readFileSync(path.join(superDir, 'src/lib.rs'), 'utf8');
        expect(manifest).toContain('name = "crossbind-app-super"');
        expect(manifest).toContain('crate-type = ["staticlib"]');
        expect(manifest).toContain('counter-crossbind-app = { path = ');
        expect(manifest).toContain('geo-surface-crossbind-app = { path = ');
        expect(lib).toContain('use counter_crossbind_app as _;');
        expect(lib).toContain('use geo_surface_crossbind_app as _;');
        // The engine composes paths with forward slashes on every platform; assert that shape,
        // not path.join's (backslash-separated on windows).
        expect(libs).toEqual([`${cacheDir}/rust-bridges/_app_super/target/${TRIPLE}/release/libcrossbind_app_super.a`]);

        const [command, args] = spawnSync.mock.calls[0];
        expect(command).toBe('cargo');
        expect(args).toContain('--target');
        expect(args).toContain(TRIPLE);
    });

    test('rejects platforms rust cannot target', async () => {
        addCrate('counter');
        const { buildAppRustCrates } = await importFresh();
        expect(() => buildAppRustCrates({ platform: 'wasi', arch: 'wasm32' }, cacheDir))
            .toThrow(/do not support platform/);
    });

    test('fails loudly when cargo fails', async () => {
        addCrate('counter');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockReturnValue({ status: 101 });
        expect(() => buildAppRustCrates(WASM, cacheDir)).toThrow(/cargo build failed/);
    });

    test('fails loudly when cargo reports success but produces no archive', async () => {
        addCrate('counter');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockReturnValue({ status: 0 });
        expect(() => buildAppRustCrates(WASM, cacheDir)).toThrow(/not found/);
    });

    test('prunes an app-local bridge whose .rs file is gone', async () => {
        const live = path.join(work, 'live.rs');
        fs.writeFileSync(live, 'pub struct A {}\n');
        addCrate('live_surface', live);
        addCrate('deleted_surface', path.join(work, 'deleted.rs'));
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });
        const log = vi.fn();

        buildAppRustCrates(WASM, cacheDir, null, log);

        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/deleted_surface'))).toBe(false);
        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/live_surface'))).toBe(true);
        const manifest = fs.readFileSync(path.join(cacheDir, 'rust-bridges/_app_super/Cargo.toml'), 'utf8');
        expect(manifest).toContain('live-surface-crossbind-app');
        expect(manifest).not.toContain('deleted-surface-crossbind-app');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('deleted_surface'));
    });

    test('keeps a bridge whose #[path] is relative to its own src dir', async () => {
        // What the generator actually writes: the bridge carries a RELATIVE #[path] so the manifest
        // stays machine-independent (it has to be mountable into the container). Resolving that
        // against cwd instead of against the file's own directory pruned a live bridge on every
        // build, and the surface simply vanished from the module - no error, just missing bindings.
        const live = path.join(work, 'live.rs');
        fs.writeFileSync(live, 'pub struct A {}\n');
        const bridgeSrc = path.join(cacheDir, 'rust-bridges/rel_surface/src');
        addCrate('rel_surface', live);
        fs.writeFileSync(
            path.join(bridgeSrc, 'lib.rs'),
            `#[path = "${path.relative(bridgeSrc, live).split(path.sep).join('/')}"]\nmod user;\n`,
        );
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });

        buildAppRustCrates(WASM, cacheDir);

        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/rel_surface'))).toBe(true);
        const manifest = fs.readFileSync(path.join(cacheDir, 'rust-bridges/_app_super/Cargo.toml'), 'utf8');
        expect(manifest).toContain('rel-surface-crossbind-app');
    });

    test('prunes a crate_ bridge dropped from cargoDependencies, keeps declared ones', async () => {
        addCrate('crate_uuid');
        addCrate('crate_old_dep');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });

        buildAppRustCrates(WASM, cacheDir, { uuid: '1' });

        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/crate_uuid'))).toBe(true);
        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/crate_old_dep'))).toBe(false);
    });

    test('prunes a per-module bridge: every import of a crate now shares the crate bridge', async () => {
        addCrate('crate_xxhash_rust');
        addCrate('crate_xxhash_rust__xxh3');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });

        buildAppRustCrates(WASM, cacheDir, { 'xxhash-rust': '0.8' });

        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/crate_xxhash_rust'))).toBe(true);
        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/crate_xxhash_rust__xxh3'))).toBe(false);
    });

    test('leaves crate_ bridges alone when no cargoDependencies are passed', async () => {
        addCrate('crate_uuid');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockImplementation(() => { fakeCargoOutput(); return { status: 0 }; });

        buildAppRustCrates(WASM, cacheDir);

        expect(fs.existsSync(path.join(cacheDir, 'rust-bridges/crate_uuid'))).toBe(true);
    });

    test("mt without nightly/rust-src fails actionably before any cargo build", async () => {
        addCrate('counter');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockClear();
        spawnSync.mockReturnValue({ status: 1 });
        expect(() => buildAppRustCrates({ ...WASM, runtime: 'mt' }, cacheDir))
            .toThrow(/rustup toolchain install nightly/);
        expect(spawnSync).toHaveBeenCalledTimes(1);
        expect(spawnSync.mock.calls[0][0]).toBe('rustup');
    });

    test('mt with nightly builds through -Zbuild-std with atomics into its own target dir', async () => {
        addCrate('counter');
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockClear();
        spawnSync.mockImplementation((cmd) => {
            if (cmd === 'rustup') return { status: 0, stdout: 'rust-src (installed)\n' };
            fakeCargoOutput('target-mt');
            return { status: 0 };
        });

        const libs = buildAppRustCrates({ ...WASM, runtime: 'mt' }, cacheDir);

        const [, args, opts] = spawnSync.mock.calls[1];
        expect(spawnSync.mock.calls[1][0]).toBe('cargo');
        expect(args).toContain('+nightly');
        expect(args).toContain('-Zbuild-std=std,panic_abort');
        expect(args.join(' ')).toContain('target-mt');
        expect(opts.env.CARGO_ENCODED_RUSTFLAGS).toContain('+atomics,+bulk-memory');
        expect(libs).toEqual([`${cacheDir}/rust-bridges/_app_super/target-mt/${TRIPLE}/release/libcrossbind_app_super.a`]);
    });

    test('does not trip the mt guard when pruning empties the set', async () => {
        addCrate('deleted_surface', path.join(work, 'deleted.rs'));
        const { buildAppRustCrates, spawnSync } = await importFresh();
        spawnSync.mockClear();
        expect(buildAppRustCrates({ ...WASM, runtime: 'mt' }, cacheDir, null, () => {})).toEqual([]);
        expect(spawnSync).not.toHaveBeenCalled();
    });
});
