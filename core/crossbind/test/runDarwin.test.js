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
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-rundarwin-'));
    holder.config = {
        paths: { base: work, build: path.join(work, 'build') },
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

async function runDarwin(params, arch = 'arm64') {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, { platform: 'darwin', arch });
    const [, args, options] = execFileSync.mock.calls.at(-1);
    return { args, env: options.env };
}

describe('run: a macOS build', () => {
    test("a configure build names Apple's compilers, since its --host triple asks for prefixed ones", async () => {
        const { env } = await runDarwin(['./configure', '--host=aarch64-apple-darwin']);

        expect(env.CC).toBe('/usr/bin/clang');
        expect(env.CXX).toBe('/usr/bin/clang++');
        expect(env.CFLAGS).toContain('-arch arm64');
        expect(env.PATH).toBe('/usr/bin:/bin:/usr/sbin:/sbin');
    });

    test('a CMake build leaves the compilers to CMake', async () => {
        const { args, env } = await runDarwin(['cmake', '/src'], 'x64');

        expect(env.CC).toBeUndefined();
        expect(args).toContain('-DCMAKE_OSX_ARCHITECTURES=x86_64');
    });
});
