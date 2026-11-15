import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';

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
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-runandroid-')));
    holder.config = {
        paths: { base: work, build: upath.join(work, 'build') },
        system: { RUNNER: 'DOCKER_RUN' },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

// The image is reported present, so the last docker call is the build itself.
async function runAndroid(arch, params) {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    execFileSync.mockReturnValue('');
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, { platform: 'android', arch });
    return execFileSync.mock.calls.at(-1)[1];
}

describe('run: an Android CMake build', () => {
    // An app carries one libc++_shared.so; a library that linked libc++ in would carry, and export, a copy of its own.
    test.each(['arm64-v8a', 'x86_64'])('links %s against the shared C++ runtime', async (arch) => {
        const args = await runAndroid(arch, ['cmake', '/src']);

        expect(args).toContain('-DANDROID_STL=c++_shared');
        expect(args).toContain('-DCMAKE_TOOLCHAIN_FILE=/opt/android-sdk/ndk/current/build/cmake/android.toolchain.cmake');
    });

    test('passes no configure option to a build step', async () => {
        const args = await runAndroid('arm64-v8a', ['cmake', '--build', '.']);

        expect(args).not.toContain('-DANDROID_STL=c++_shared');
    });
});
