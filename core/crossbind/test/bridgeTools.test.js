import { describe, test, expect, vi, afterEach } from 'vitest';
import { DARWIN_CC } from '../src/utils/darwinToolchain.js';
import {
    clangEnvironment, missingToolsMessage, runPreprocessor, runSwig, usesBridgeTools,
} from '../src/utils/bridgeTools.js';

const thrown = (fn) => {
    try {
        fn();
    } catch (error) {
        return error;
    }
    return null;
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('bridge-tools', () => {
    test("makes every bridge on a Mac but Android's, which the NDK reads, and none on another host", () => {
        expect(['ios', 'darwin', 'wasm', 'linux', 'win32'].every((platform) => usesBridgeTools({ platform }, 'darwin'))).toBe(true);
        expect(usesBridgeTools(undefined, 'darwin')).toBe(true);
        expect(usesBridgeTools({ platform: 'android' }, 'darwin')).toBe(false);
        expect(['ios', 'wasm'].some((platform) => usesBridgeTools({ platform }, 'linux'))).toBe(false);
    });

    test('names the install line when the package is missing, and the build line when this checkout has not built it', () => {
        expect(missingToolsMessage({ code: 'MODULE_NOT_FOUND' }, '2.0.0-beta.69')).toContain('npm install --save-dev @crossbind/bridge-tools@2.0.0-beta.69');
        expect(missingToolsMessage({ code: 'ENOENT' }, '2.0.0-beta.69')).toContain('pnpm --filter @crossbind/bridge-tools build');
    });

    test('fails as run() does when SWIG exits with an error, so the retry without macros still sees its exit code', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const tools = { swig: vi.fn(() => ({ status: 1, output: 'x.i:3: Error: Syntax error in input(1).\n' })) };

        const error = thrown(() => runSwig(['-c++'], '/project/.crossbind/build', tools));

        expect(tools.swig).toHaveBeenCalledWith(['-c++'], { cwd: '/project/.crossbind/build' });
        expect(error.message).toBe('crossbind: command failed (swig) with exit code 1');
        expect(error.cause.status).toBe(1);
        expect(consoleError).toHaveBeenCalledWith('x.i:3: Error: Syntax error in input(1).\n');
    });

    test('keeps SWIG quiet when it succeeds, and shows what it printed before a crash', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const crash = Object.assign(new Error('crossbind: SWIG crashed: memory access out of bounds'), { output: 'before the crash\n' });

        runSwig([], '/build', { swig: () => ({ status: 0, output: 'SWIG:1: Warning 524\n' }) });
        expect(consoleError).not.toHaveBeenCalled();

        expect(thrown(() => runSwig([], '/build', { swig: () => { throw crash; } }))).toBe(crash);
        expect(consoleError).toHaveBeenCalledWith('before the crash\n');
    });

    test('runs clang without CPATH or CPLUS_INCLUDE_PATH, which it reads despite -nostdinc', () => {
        expect(clangEnvironment({ PATH: '/usr/bin', HOME: '/Users/me', CPATH: '/opt/homebrew/include', CPLUS_INCLUDE_PATH: '/usr/local/include' }))
            .toEqual({ PATH: '/usr/bin', HOME: '/Users/me' });
    });

    test("runs Xcode's clang with the package's flags first, in the build directory, and fails as run() does", () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const exec = vi.fn(() => {
            throw Object.assign(new Error('clang failed'), { status: 1, stderr: Buffer.from("fatal error: 'x.h' file not found\n") });
        });

        const error = thrown(() => runPreprocessor(['-dM', '-E'], '/project/.crossbind/build', { preprocessorArgs: ['-nostdinc'] }, exec));

        expect(exec).toHaveBeenCalledWith(DARWIN_CC, ['-nostdinc', '-dM', '-E'], expect.objectContaining({ cwd: '/project/.crossbind/build' }));
        expect(error.message).toBe('crossbind: command failed (clang) with exit code 1');
        expect(console.error).toHaveBeenCalledWith("fatal error: 'x.h' file not found\n");
    });
});
