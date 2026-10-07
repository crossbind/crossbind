import {
    describe, test, expect, beforeEach, afterEach, vi,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cargo runs on the host; the tests assert what the engine hands it, not the compile itself.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));
vi.mock('../src/utils/logger.js', () => ({
    default: {
        info: vi.fn(), startStep: vi.fn(), doneStep: vi.fn(), cachedStep: vi.fn(),
    },
}));

// state resolves the project config at import time; feed it through a holder getter instead.
const holder = { config: null };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));

const ST = { platform: 'wasm', arch: 'wasm32', runtime: 'st', path: 'wasm-wasm32-st-release' };
const MT = { platform: 'wasm', arch: 'wasm32', runtime: 'mt', path: 'wasm-wasm32-mt-release' };
const TRIPLE = 'wasm32-unknown-emscripten';

let work;
let libdir;

async function importFresh() {
    vi.resetModules();
    const { spawnSync } = await import('node:child_process');
    spawnSync.mockClear();
    const { default: buildCargo } = await import('../src/actions/buildCargo.js');
    return { buildCargo, spawnSync };
}

// A manual-bindings crate (contains 'bindings!') skips bridge generation, so the test
// exercises exactly the cargo invocation and staging.
function addManualCrate() {
    const crateDir = path.join(work, 'crate');
    fs.mkdirSync(path.join(crateDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(crateDir, 'Cargo.toml'), '[package]\nname = "demo-pkg"\n');
    fs.writeFileSync(path.join(crateDir, 'src/lib.rs'), 'embind_rs::bindings! {}\n');
    return crateDir;
}

function fakeCargoOutput(crateDir, targetDirName = 'target') {
    const lib = path.join(crateDir, targetDirName, TRIPLE, 'release/libdemo_pkg.a');
    fs.mkdirSync(path.dirname(lib), { recursive: true });
    fs.writeFileSync(lib, '');
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-build-cargo-'));
    libdir = path.join(work, 'dist/prebuilt/wasm');
    holder.config = {
        paths: { project: work },
        export: { type: 'cargo', libName: ['demo'] },
        general: { name: 'demo' },
        system: { RUNNER: 'LOCAL' },
    };
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('buildCargo', () => {
    test('st builds with stable cargo into target/ and stages the export libName', async () => {
        const crateDir = addManualCrate();
        const { buildCargo, spawnSync } = await importFresh();
        spawnSync.mockImplementation((cmd, args) => {
            if (args.includes('--version')) return { status: 0 };
            fakeCargoOutput(crateDir);
            return { status: 0 };
        });

        expect(buildCargo(ST, libdir)).toBe(true);

        const buildCall = spawnSync.mock.calls.find(([, args]) => args.includes('build'));
        expect(buildCall[0]).toBe('cargo');
        expect(buildCall[1]).not.toContain('+nightly');
        expect(buildCall[1].join(' ')).not.toContain('-Zbuild-std');
        expect(buildCall[1]).toContain(`${crateDir}/target`);
        expect(fs.existsSync(path.join(libdir, 'lib/libdemo.a'))).toBe(true);
    });

    test('mt builds through nightly -Zbuild-std with atomics into its own target dir', async () => {
        const crateDir = addManualCrate();
        const { buildCargo, spawnSync } = await importFresh();
        spawnSync.mockImplementation((cmd, args) => {
            if (cmd === 'rustup') return { status: 0, stdout: 'rust-src (installed)\n' };
            if (args.includes('--version')) return { status: 0 };
            fakeCargoOutput(crateDir, 'target-mt');
            return { status: 0 };
        });

        expect(buildCargo(MT, libdir)).toBe(true);

        const [, args, opts] = spawnSync.mock.calls.find(([, a]) => a.includes('build'));
        expect(args).toContain('+nightly');
        expect(args).toContain('-Zbuild-std=std,panic_abort');
        expect(args).toContain(`${crateDir}/target-mt`);
        expect(opts.env.CARGO_ENCODED_RUSTFLAGS).toContain('+atomics,+bulk-memory');
        expect(fs.existsSync(path.join(libdir, 'lib/libdemo.a'))).toBe(true);
    });

    test('mt without nightly/rust-src fails actionably before any cargo build', async () => {
        addManualCrate();
        const { buildCargo, spawnSync } = await importFresh();
        spawnSync.mockImplementation((cmd, args) => {
            if (cmd === 'rustup') return { status: 1 };
            if (args.includes('--version')) return { status: 0 };
            throw new Error('cargo build must not run');
        });

        expect(() => buildCargo(MT, libdir)).toThrow(/rustup toolchain install nightly/);
        expect(spawnSync.mock.calls.some(([, a]) => a.includes('build'))).toBe(false);
    });
});
