import {
    describe, test, expect, vi, beforeEach,
} from 'vitest';

// The two consumption channels for the same trees: an image layer for containerized builds, a
// downloaded artifact for RUNNER=LOCAL. These pin which one answers for a given target, because
// picking wrong is silent - mt links a featureless std instead of failing.
vi.mock('node:child_process', () => ({ spawnSync: vi.fn(), execFileSync: vi.fn() }));

const holder = { config: { paths: { base: '/repo' }, system: {} } };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));

const pin = { current: null };
vi.mock('../src/utils/rustSysrootPin.js', () => ({ get default() { return pin.current; } }));

const ensure = vi.fn();
vi.mock('../src/utils/downloadAndExtractFile.js', () => ({
    downloadFile: (...a) => ensure(...a),
    verifyIntegrity: vi.fn(),
}));

const MT = { platform: 'wasm', arch: 'wasm32', runtime: 'mt' };
const ST = { platform: 'wasm', arch: 'wasm32', runtime: 'st' };
const IOS = { platform: 'ios', arch: 'iphoneos', runtime: 'st' };

async function importFresh() {
    vi.resetModules();
    return import('../src/utils/rustSysroot.js');
}

beforeEach(() => {
    holder.config = { paths: { base: '/repo' }, system: {} };
    pin.current = null;
    ensure.mockReset();
});

describe('sysrootFor', () => {
    test('a containerized build takes the trees the image carries', async () => {
        holder.config.system.RUNNER = 'DOCKER_RUN';
        const { sysrootFor } = await importFresh();
        expect(sysrootFor(MT)).toBe(true);
        expect(sysrootFor(ST)).toBe(true);
    });

    test('LOCAL st needs nothing - rustup ships a correct std for it', async () => {
        const { sysrootFor } = await importFresh();
        expect(sysrootFor(ST)).toBe(false);
    });

    test('LOCAL mt falls back to the nightly rebuild when nothing was prepared', async () => {
        const { sysrootFor } = await importFresh();
        expect(sysrootFor(MT)).toBe(false);
    });

    test('ios never consumes a wasm sysroot even though it runs on the host', async () => {
        holder.config.system.RUNNER = 'DOCKER_RUN';
        const { sysrootFor } = await importFresh();
        // cargoRunner sends ios to the host, so this must not claim the image tree.
        expect(sysrootFor(IOS)).toBe(false);
    });
});

describe('prepareRustSysroot', () => {
    test('downloads nothing when no target will consume it', async () => {
        pin.current = { url: 'https://example.test/s.tar', sha256: 'a'.repeat(64) };
        const { prepareRustSysroot } = await importFresh();

        await expect(prepareRustSysroot([ST, IOS])).resolves.toBe(null);
        expect(ensure).not.toHaveBeenCalled();
    });

    test('downloads nothing while the artifact is unpinned', async () => {
        const { prepareRustSysroot } = await importFresh();

        await expect(prepareRustSysroot([MT])).resolves.toBe(null);
        expect(ensure).not.toHaveBeenCalled();
    });

    test('a failed download leaves the nightly path working instead of killing the build', async () => {
        // Refusing here would take away a build that works today: the artifact is an optimisation.
        pin.current = { url: 'https://example.test/s.tar', sha256: 'a'.repeat(64) };
        ensure.mockRejectedValue(new Error('HTTP 404'));
        const { prepareRustSysroot, sysrootFor } = await importFresh();
        const log = vi.fn();

        await expect(prepareRustSysroot([MT], log)).resolves.toBe(null);
        expect(log).toHaveBeenCalledWith(expect.stringMatching(/falling back to the nightly.*404/));
        expect(sysrootFor(MT)).toBe(false);
    });
});
