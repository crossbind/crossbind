import { describe, test, expect } from 'vitest';
import { TOOLCHAIN_PLATFORMS, targetToolchain } from '../src/utils/targetToolchain.js';

const target = (platform, arch, runtime = 'st') => ({
    platform, arch, runtime, buildType: 'release',
});

describe("a target's toolchain, as a package source takes it", () => {
    test('a wasm target builds with emscripten, with the flags every archive of a module agrees on', () => {
        expect(targetToolchain(target('wasm', 'wasm32'))).toEqual({
            platform: 'wasm',
            arch: 'wasm32',
            runtime: 'st',
            cppStandard: '20',
            flags: ['-fwasm-exceptions', '-msimd128'],
            compilers: { c: 'emcc', cpp: 'em++' },
            env: {
                CC: 'emcc', CXX: 'em++', AR: 'emar', NM: 'emnm', RANLIB: 'emranlib', STRIP: 'emstrip',
            },
        });
        expect(targetToolchain(target('wasm', 'wasm64', 'mt')).flags).toEqual(['-fwasm-exceptions', '-pthread', '-msimd128', '-sMEMORY64=1']);
    });

    test("an android target builds with the image's NDK, for the API level the ports use", () => {
        expect(targetToolchain(target('android', 'arm64-v8a', 'mt'))).toEqual({
            platform: 'android',
            arch: 'arm64-v8a',
            runtime: 'mt',
            cppStandard: '20',
            flags: ['-pthread'],
            compilers: {
                c: '/opt/android-sdk/ndk/current/toolchains/llvm/prebuilt/linux-x86_64/bin/clang',
                cpp: '/opt/android-sdk/ndk/current/toolchains/llvm/prebuilt/linux-x86_64/bin/clang++',
            },
            env: {},
            ndk: '/opt/android-sdk/ndk/current',
            apiLevel: 33,
        });
    });

    test("an iOS target names no compiler, as Xcode's own build it, for the SDK its arch names", () => {
        expect(targetToolchain(target('ios', 'iphonesimulator'))).toEqual({
            platform: 'ios',
            arch: 'iphonesimulator',
            runtime: 'st',
            cppStandard: '20',
            flags: [],
            env: {},
            deploymentTarget: '15.1',
        });
    });

    test("a linux target builds with the image's clang wrappers for its triple, and names its C library", () => {
        expect(targetToolchain(target('linux', 'x64'))).toEqual({
            platform: 'linux',
            arch: 'x64',
            runtime: 'st',
            cppStandard: '20',
            flags: ['-fPIC'],
            compilers: {
                c: '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang',
                cpp: '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang++',
            },
            env: {
                CC: '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang',
                CXX: '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang++',
                AR: '/opt/crossbind/linux/bin/x86_64-linux-gnu-ar',
                RANLIB: '/opt/crossbind/linux/bin/x86_64-linux-gnu-ranlib',
                NM: '/opt/crossbind/linux/bin/x86_64-linux-gnu-nm',
                STRIP: '/opt/crossbind/linux/bin/x86_64-linux-gnu-strip',
                PKG_CONFIG_LIBDIR: '',
            },
            cmakeToolchainFile: '/opt/crossbind/linux/x86_64-linux-gnu.cmake',
            triple: 'x86_64-linux-gnu',
            libc: 'glibc',
        });
        const musl = targetToolchain(target('linuxmusl', 'arm64'));
        expect(musl.triple).toBe('aarch64-alpine-linux-musl');
        expect(musl.libc).toBe('musl');
        expect(musl.cmakeToolchainFile).toBe('/opt/crossbind/linux/aarch64-alpine-linux-musl.cmake');
    });

    test("a macOS target builds with the clang xcode-select names, and finds none of the machine's own packages", () => {
        expect(targetToolchain(target('darwin', 'arm64'))).toEqual({
            platform: 'darwin',
            arch: 'arm64',
            runtime: 'st',
            cppStandard: '20',
            flags: [],
            compilers: { c: '/usr/bin/clang', cpp: '/usr/bin/clang++' },
            env: { PKG_CONFIG_LIBDIR: '' },
            deploymentTarget: '11.0',
            ignoredPrefixes: ['/opt/homebrew', '/usr/local', '/opt/local'],
        });
    });

    test("a windows target builds with the image's llvm-mingw for its triple, its resource compiler too", () => {
        const toolchain = targetToolchain(target('win32', 'arm64'));
        expect(toolchain.compilers).toEqual({
            c: '/opt/llvm-mingw/bin/aarch64-w64-mingw32-clang',
            cpp: '/opt/llvm-mingw/bin/aarch64-w64-mingw32-clang++',
            rc: '/opt/llvm-mingw/bin/aarch64-w64-mingw32-windres',
        });
        expect(toolchain.env.WINDRES).toBe('/opt/llvm-mingw/bin/aarch64-w64-mingw32-windres');
        expect(toolchain.cmakeToolchainFile).toBe('/opt/crossbind/windows/aarch64-w64-mingw32.cmake');
        expect(toolchain.triple).toBe('aarch64-w64-mingw32');
        expect(toolchain.flags).toEqual([]);
    });

    test('a platform package sources build nothing for yet has none', () => {
        expect(targetToolchain(target('wasi', 'wasm32'))).toBeNull();
        expect(TOOLCHAIN_PLATFORMS).toEqual(['wasm', 'android', 'ios', 'linux', 'linuxmusl', 'darwin', 'win32']);
    });

    test('is plain data of its own: what a source does to one changes no other', () => {
        TOOLCHAIN_PLATFORMS.forEach((platform) => {
            const arch = { wasm: 'wasm32', android: 'x86_64', ios: 'iphoneos' }[platform] ?? 'x64';
            const toolchain = targetToolchain(target(platform, arch));
            expect(JSON.parse(JSON.stringify(toolchain))).toEqual(toolchain);
            Object.values(toolchain).filter((value) => Array.isArray(value)).forEach((list) => list.push('changed'));
            expect(JSON.stringify(targetToolchain(target(platform, arch)))).not.toContain('changed');
        });
    });
});
