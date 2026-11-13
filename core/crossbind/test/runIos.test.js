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
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-runios-'));
    holder.config = {
        general: { name: 'sample' },
        paths: { base: work, build: path.join(work, 'build'), cli: '/cli' },
        system: { RUNNER: 'DOCKER_RUN', XCODE_DEVELOPMENT_TEAM: 'TEAM' },
    };
});

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(work, { recursive: true, force: true });
});

async function runIos(params, arch) {
    vi.resetModules();
    const { execFileSync } = await import('node:child_process');
    execFileSync.mockReset();
    const run = (await import('../src/actions/run.js')).default;
    run(null, params, null, { platform: 'ios', arch });
    const [program, args, options] = execFileSync.mock.calls.at(-1);
    return { program, args, env: options.env };
}

describe('run: an iOS CMake build', () => {
    test.each([
        ['iphoneos', 'iPhoneOS'],
        ['iphonesimulator', 'iPhoneSimulator'],
    ])("a %s library configures with CMake's own iOS platform and Makefiles, not as an Xcode project", async (arch, sdk) => {
        const { program, args } = await runIos(['cmake', '/src'], arch);

        expect(program).toBe('cmake');
        expect(args).not.toContain('-G');
        expect(args).not.toContain('Xcode');
        expect(args).toEqual(expect.arrayContaining(['-DCMAKE_SYSTEM_NAME=iOS', '-DCMAKE_OSX_ARCHITECTURES=arm64']));
        expect(args.some((arg) => new RegExp(`^-DCMAKE_OSX_SYSROOT='.*/${sdk}\\.sdk'$`).test(arg))).toBe(true);
        expect(args.some((arg) => arg.startsWith('-DCMAKE_TOOLCHAIN_FILE'))).toBe(false);
    });

    test("a link takes no bitcode, which Xcode's linker refuses, while the objects keep theirs", async () => {
        const { args } = await runIos(['cmake', '/src'], 'iphonesimulator');

        expect(args).toContain('-DCMAKE_C_FLAGS=-fembed-bitcode-marker');
        expect(args).toEqual(expect.arrayContaining([
            '-DCMAKE_EXE_LINKER_FLAGS=-fembed-bitcode=off', '-DCMAKE_SHARED_LINKER_FLAGS=-fembed-bitcode=off', '-DCMAKE_MODULE_LINKER_FLAGS=-fembed-bitcode=off',
        ]));
    });

    test("the app host's ios-cmake keeps crossbind's iOS toolchain file", async () => {
        const { program, args } = await runIos(['ios-cmake', '/host'], 'iphoneos');

        expect(program).toBe('cmake');
        expect(args).toEqual(expect.arrayContaining(["-DCMAKE_TOOLCHAIN_FILE='/cli/assets/cmake/ios.toolchain.cmake'", '-DPLATFORM=OS64']));
    });

    test('a build or install step passes through untouched', async () => {
        const { program, args } = await runIos(['cmake', '--build', '.', '--config', 'Release', '--target', 'install'], 'iphoneos');

        expect(program).toBe('cmake');
        expect(args).toEqual(['--build', '.', '--config', 'Release', '--target', 'install']);
    });
});
