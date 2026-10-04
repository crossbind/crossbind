import { describe, test, expect } from 'vitest';
import { hostProfile, BUILD_PROFILE } from '../src/utils/conanProfile.js';

const wasm = (overrides = {}) => ({
    platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', ...overrides,
});
const line = (profile, key) => profile.split('\n').find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

describe('conan host profile', () => {
    test('a single-threaded wasm profile builds static emcc packages without threads', () => {
        const profile = hostProfile(wasm());
        expect(line(profile, 'os')).toBe('Emscripten');
        expect(line(profile, 'arch')).toBe('wasm');
        expect(line(profile, 'compiler')).toBe('emcc');
        expect(line(profile, 'compiler.libcxx')).toBe('libc++');
        expect(line(profile, 'compiler.threads')).toBeUndefined();
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.build:cflags')).toBe('["-fwasm-exceptions","-msimd128"]');
        expect(line(profile, 'tools.build:cxxflags')).toBe('["-fwasm-exceptions","-msimd128"]');
    });

    test('an mt profile turns on POSIX threads and compiles every source with them', () => {
        const profile = hostProfile(wasm({ runtime: 'mt' }));
        expect(line(profile, 'compiler.threads')).toBe('posix');
        expect(line(profile, 'tools.build:cflags')).toBe('["-fwasm-exceptions","-pthread","-msimd128"]');
        expect(line(profile, 'tools.build:exelinkflags')).toBe('["-fwasm-exceptions","-pthread","-msimd128"]');
    });

    test('a wasm64 profile targets 64-bit memory', () => {
        const profile = hostProfile(wasm({ arch: 'wasm64' }));
        expect(line(profile, 'arch')).toBe('wasm64');
        expect(line(profile, 'tools.build:cflags')).toBe('["-fwasm-exceptions","-msimd128","-sMEMORY64=1"]');
    });

    test('the emcc that reads the profile names the compiler version, so a toolchain bump rebuilds every package', () => {
        expect(line(hostProfile(wasm()), 'compiler.version')).toContain("['emcc', '-dumpversion']");
    });

    test('the flags take part in the package id', () => {
        expect(line(hostProfile(wasm()), 'tools.info.package_id:confs')).toContain('"tools.build:cflags"');
    });

    test('other platforms are refused for now', () => {
        expect(() => hostProfile({ platform: 'ios', arch: 'iphoneos', runtime: 'mt', buildType: 'release' })).toThrow(/wasm and android so far; ios/);
    });
});

describe('conan host profile for android', () => {
    const android = (arch) => ({
        platform: 'android', arch, runtime: 'mt', buildType: 'release',
    });

    test('builds static packages with the image NDK for the API level the ports use', () => {
        const profile = hostProfile(android('arm64-v8a'));
        expect(line(profile, 'os')).toBe('Android');
        expect(line(profile, 'os.api_level')).toBe('33');
        expect(line(profile, 'arch')).toBe('armv8');
        expect(line(profile, 'compiler')).toBe('clang');
        expect(line(profile, 'compiler.libcxx')).toBe('c++_static');
        expect(line(profile, 'tools.android:ndk_path')).toBe('/opt/android-sdk/ndk/current');
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.build:cflags')).toBe('["-pthread"]');
    });

    test('x86_64 keeps its own name', () => {
        expect(line(hostProfile(android('x86_64')), 'arch')).toBe('x86_64');
    });

    test('the image NDK clang names the compiler version', () => {
        expect(line(hostProfile(android('arm64-v8a')), 'compiler.version')).toContain('/opt/android-sdk/ndk/current/toolchains/llvm/prebuilt/linux-x86_64/bin/clang');
    });

    test('carries nothing of the emscripten toolchain', () => {
        const profile = hostProfile(android('arm64-v8a'));
        expect(profile).not.toContain('emcc');
        expect(profile).not.toContain('[buildenv]');
        expect(profile).not.toContain('user_toolchain');
    });
});

describe('conan build profile', () => {
    test('describes the machine the build tools run on', () => {
        expect(BUILD_PROFILE).toContain('detect_api.detect_os()');
        expect(BUILD_PROFILE).toContain('detect_api.detect_arch()');
    });
});
