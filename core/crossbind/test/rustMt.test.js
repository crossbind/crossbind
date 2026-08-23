import {
    describe, test, expect, afterEach, vi,
} from 'vitest';
import path from 'node:path';

// cargo/rustup run on the host; the tests assert what the engine hands them, not the compile.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));

const ST = { platform: 'wasm', arch: 'wasm32', runtime: 'st' };
const MT = { platform: 'wasm', arch: 'wasm32', runtime: 'mt' };
const TRIPLE = 'wasm32-unknown-emscripten';

async function importFresh() {
    vi.resetModules();
    const { spawnSync } = await import('node:child_process');
    const mod = await import('../src/utils/rustMt.js');
    return { ...mod, spawnSync };
}

const savedRustflags = process.env.RUSTFLAGS;
afterEach(() => {
    if (savedRustflags === undefined) delete process.env.RUSTFLAGS;
    else process.env.RUSTFLAGS = savedRustflags;
});

describe('rustMt', () => {
    test('isMtWasm matches only the wasm mt runtime', async () => {
        const { isMtWasm } = await importFresh();
        expect(isMtWasm(MT)).toBe(true);
        expect(isMtWasm(ST)).toBe(false);
        expect(isMtWasm({ platform: 'ios', arch: 'iphoneos', runtime: 'mt' })).toBe(false);
    });

    test('assertMtRustToolchain passes when nightly rust-src is installed', async () => {
        const { assertMtRustToolchain, spawnSync } = await importFresh();
        spawnSync.mockReturnValue({ status: 0, stdout: 'rust-src (installed)\n' });
        expect(() => assertMtRustToolchain()).not.toThrow();
        expect(spawnSync.mock.calls[0][0]).toBe('rustup');
    });

    test('assertMtRustToolchain fails actionably when rustup/nightly is missing', async () => {
        const { assertMtRustToolchain, spawnSync } = await importFresh();
        spawnSync.mockReturnValue({ status: 1 });
        expect(() => assertMtRustToolchain()).toThrow(/rustup toolchain install nightly/);
    });

    test('assertMtRustToolchain fails when nightly lacks rust-src', async () => {
        const { assertMtRustToolchain, spawnSync } = await importFresh();
        spawnSync.mockReturnValue({ status: 0, stdout: 'cargo (installed)\n' });
        expect(() => assertMtRustToolchain()).toThrow(/rust-src/);
    });

    test('cargoTargetDirFor splits st and mt target dirs', async () => {
        const { cargoTargetDirFor } = await importFresh();
        expect(cargoTargetDirFor('/x', ST)).toBe('/x/target');
        expect(cargoTargetDirFor('/x', MT)).toBe('/x/target-mt');
    });

    test('cargoBuildInvocation st: stable args, no extra flags', async () => {
        const { cargoBuildInvocation } = await importFresh();
        const { args, rustflags, isMt } = cargoBuildInvocation({
            target: ST, triple: TRIPLE, targetDir: '/x/target', manifestPath: '/x/Cargo.toml',
        });
        expect(isMt).toBe(false);
        expect(args).toEqual(['build', '--release', '--target', TRIPLE, '--target-dir', '/x/target', '--manifest-path', '/x/Cargo.toml']);
        expect(rustflags).toEqual([]);
    });

    test('cargoBuildInvocation mt: nightly build-std args and atomics rustflags', async () => {
        const { cargoBuildInvocation } = await importFresh();
        const { args, rustflags, isMt } = cargoBuildInvocation({
            target: MT, triple: TRIPLE, targetDir: '/x/target-mt', manifestPath: '/x/Cargo.toml',
        });
        expect(isMt).toBe(true);
        expect(args[0]).toBe('+nightly');
        expect(args).toContain('-Zbuild-std=std,panic_abort');
        expect(args).toContain('/x/target-mt');
        // One argv per flag: runCargo joins them with cargo's 0x1F separator.
        expect(rustflags).toEqual(['-Ctarget-feature=+atomics,+bulk-memory,+mutable-globals']);
    });

    test('cargoBuildInvocation does not inherit the caller RUSTFLAGS', async () => {
        // It used to merge them, which silently broke mt: cargo ignores RUSTFLAGS entirely when
        // CARGO_ENCODED_RUSTFLAGS is set, so a developer exporting that variable got a featureless
        // std linked into a shared-memory module.
        process.env.RUSTFLAGS = '-C opt-level=3';
        const { cargoBuildInvocation } = await importFresh();
        const { rustflags } = cargoBuildInvocation({
            target: MT, triple: TRIPLE, targetDir: '/x/target-mt', manifestPath: '/x/Cargo.toml',
        });
        expect(rustflags.join(' ')).not.toContain('opt-level');
    });

    test('cargoBuildInvocation links a prebuilt sysroot instead of rebuilding std', async () => {
        // The whole point of shipping sysroots: stable rustc, no nightly, no -Z, and a std that was
        // already compiled with the shared-memory features.
        const { cargoBuildInvocation } = await importFresh();
        const { args, rustflags, allowUnstable } = cargoBuildInvocation({
            target: MT, triple: TRIPLE, targetDir: '/x/target-mt', manifestPath: '/x/Cargo.toml', sysroot: true,
        });
        expect(args).not.toContain('+nightly');
        expect(args.join(' ')).not.toContain('-Zbuild-std');
        expect(rustflags).toEqual(['--sysroot', '/opt/crossbind/rust/current/mt', '-Ctarget-feature=+atomics,+bulk-memory,+mutable-globals']);
        expect(allowUnstable).toBe(false);
    });

    test('cargoBuildInvocation takes a downloaded sysroot as a path', async () => {
        // RUNNER=LOCAL gets the same trees as an artifact on this machine rather than as an image
        // layer, so the flag has to accept a host path, not just the container's fixed location.
        const { cargoBuildInvocation } = await importFresh();
        const { args, rustflags, allowUnstable } = cargoBuildInvocation({
            target: MT, triple: TRIPLE, targetDir: '/x/target-mt', manifestPath: '/x/Cargo.toml', sysroot: '/home/u/.crossbind/rust-sysroot/abc',
        });
        expect(args).not.toContain('+nightly');
        expect(rustflags[0]).toBe('--sysroot');
        expect(rustflags[1]).toBe(path.join('/home/u/.crossbind/rust-sysroot/abc', 'mt'));
        expect(allowUnstable).toBe(false);
    });

    test('cargoBuildInvocation points st at its own sysroot', async () => {
        const { cargoBuildInvocation } = await importFresh();
        const { rustflags } = cargoBuildInvocation({
            target: ST, triple: TRIPLE, targetDir: '/x/target', manifestPath: '/x/Cargo.toml', sysroot: true,
        });
        expect(rustflags).toEqual(['--sysroot', '/opt/crossbind/rust/current/st']);
    });

    test('cargoBuildInvocation keeps the nightly rebuild when no sysroot answers', async () => {
        // RUNNER=LOCAL has no image to take a sysroot from until the artifact channel is live.
        const { cargoBuildInvocation } = await importFresh();
        const { args, rustflags, allowUnstable } = cargoBuildInvocation({
            target: MT, triple: TRIPLE, targetDir: '/x/target-mt', manifestPath: '/x/Cargo.toml',
        });
        expect(args[0]).toBe('+nightly');
        expect(args).toContain('-Zbuild-std=std,panic_abort');
        expect(rustflags.join(' ')).not.toContain('--sysroot');
        expect(allowUnstable).toBe(true);
    });

    test('cargoBuildInvocation asks for unstable flags only on the mt build-std path', async () => {
        const { cargoBuildInvocation } = await importFresh();
        const call = (target) => cargoBuildInvocation({
            target, triple: TRIPLE, targetDir: '/x/target', manifestPath: '/x/Cargo.toml',
        }).allowUnstable;
        expect(call(MT)).toBe(true);
        expect(call(ST)).toBe(false);
    });

    test('cargoBuildInvocation pins the panic strategy for wasm only', async () => {
        // wasm links against a std built with panic=abort; other platforms use the stock std.
        const { cargoBuildInvocation } = await importFresh();
        const call = (target) => cargoBuildInvocation({
            target, triple: TRIPLE, targetDir: '/x/target', manifestPath: '/x/Cargo.toml',
        }).panic;
        expect(call(ST)).toBe('abort');
        expect(call(MT)).toBe('abort');
        expect(call({ platform: 'android', arch: 'arm64-v8a', runtime: 'mt' })).toBeUndefined();
    });
});
