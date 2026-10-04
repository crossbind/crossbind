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
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runwindows-'));
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
async function runWindows(arch, params) {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    execFileSync.mockReturnValue('');
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, { platform: 'win32', arch });
    const [program, args] = execFileSync.mock.calls.at(-1);
    return { program, args };
}

describe('run: a Windows addon build', () => {
    test.each([
        ['x64', 'x86_64-w64-mingw32'],
        ['arm64', 'aarch64-w64-mingw32'],
    ])('%s compiles with the windows image llvm-mingw for %s, without the image pkg-config files', async (arch, triple) => {
        const { program, args } = await runWindows(arch, ['cmake', '/src']);
        const tool = (name) => `/opt/llvm-mingw/bin/${triple}-${name}`;

        expect(program).toBe('docker');
        expect(args).toEqual(expect.arrayContaining([
            `CC=${tool('clang')}`, `CXX=${tool('clang++')}`, `AR=${tool('ar')}`, `RANLIB=${tool('ranlib')}`,
            `NM=${tool('nm')}`, `STRIP=${tool('strip')}`, `RC=${tool('windres')}`, `WINDRES=${tool('windres')}`,
            'PKG_CONFIG_LIBDIR=', `-DCMAKE_TOOLCHAIN_FILE=/opt/crossbind/windows/${triple}.cmake`,
        ]));
    });

    test('builds and installs with what the configure step chose', async () => {
        const { args } = await runWindows('x64', ['cmake', '--build', '.']);

        expect(args.some((arg) => arg.startsWith('-DCMAKE_TOOLCHAIN_FILE='))).toBe(false);
    });
});
