import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

const holder = { config: {} };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() {
            return holder.config;
        },
    },
}));

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runlinux-'));
    holder.config = {
        paths: { base: work, build: path.join(work, 'build') },
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

// The image is reported present, so the last docker call is the build itself.
async function runLinux(platform, arch, params) {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    execFileSync.mockReturnValue('');
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, { platform, arch });
    const [program, args] = execFileSync.mock.calls.at(-1);
    return { program, args };
}

describe('run: a Linux addon build', () => {
    test.each([
        ['linux', 'x64', 'x86_64-linux-gnu'],
        ['linux', 'arm64', 'aarch64-linux-gnu'],
        ['linuxmusl', 'x64', 'x86_64-alpine-linux-musl'],
        ['linuxmusl', 'arm64', 'aarch64-alpine-linux-musl'],
    ])('%s %s compiles with the linux image toolchain for %s', async (platform, arch, triple) => {
        const { program, args } = await runLinux(platform, arch, ['cmake', '/src']);

        expect(program).toBe('docker');
        expect(args).toContain(`CC=/opt/crossbind/linux/bin/${triple}-clang`);
        expect(args).toContain(`CXX=/opt/crossbind/linux/bin/${triple}-clang++`);
        expect(args).toContain(`-DCMAKE_TOOLCHAIN_FILE=/opt/crossbind/linux/${triple}.cmake`);
    });

    test('compiles position-independent code without the image pkg-config files', async () => {
        const { args } = await runLinux('linux', 'x64', ['make']);

        expect(args).toEqual(expect.arrayContaining(['PKG_CONFIG_LIBDIR=', 'CFLAGS=-fPIC', 'CXXFLAGS=-fPIC']));
    });

    test('a musl build runs in the linux image', async () => {
        const { args } = await runLinux('linuxmusl', 'x64', ['cmake', '/src']);

        expect(args.some((arg) => /^ghcr\.io\/crossbind\/linux@sha256:[0-9a-f]{64}$/.test(arg))).toBe(true);
    });
});
