import { describe, test, expect } from 'vitest';
import { hostProfile, settingsUser, BUILD_PROFILE } from '../src/utils/conanProfile.js';

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
        expect(() => hostProfile({ platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'release' })).toThrow(/linuxmusl, darwin and win32 so far; wasi/);
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

describe('conan host profile for ios', () => {
    const ios = (arch) => ({
        platform: 'ios', arch, runtime: 'mt', buildType: 'release',
    });

    test('builds static packages with Xcode for the deployment target the ports use', () => {
        const profile = hostProfile(ios('iphoneos'));
        expect(line(profile, 'os')).toBe('iOS');
        expect(line(profile, 'os.version')).toBe('15.1');
        expect(line(profile, 'os.sdk')).toBe('iphoneos');
        expect(line(profile, 'arch')).toBe('armv8');
        expect(line(profile, 'compiler')).toBe('apple-clang');
        expect(line(profile, 'compiler.libcxx')).toBe('libc++');
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.build:cflags')).toBe('["-pthread"]');
    });

    test('the simulator takes its own SDK and stays arm64, like every crossbind simulator slice', () => {
        const profile = hostProfile(ios('iphonesimulator'));
        expect(line(profile, 'os.sdk')).toBe('iphonesimulator');
        expect(line(profile, 'arch')).toBe('armv8');
    });

    test("Xcode's clang names the compiler version", () => {
        expect(line(hostProfile(ios('iphoneos')), 'compiler.version')).toContain("['xcrun', 'clang', '-dumpversion']");
    });

    test('passes no bitcode flag: Xcode 27 ld takes the "marker" of -fembed-bitcode-marker for a file when CMake links its compiler check', () => {
        expect(hostProfile(ios('iphonesimulator'))).not.toContain('bitcode');
    });

    test('carries nothing of the emscripten or NDK toolchains', () => {
        const profile = hostProfile(ios('iphoneos'));
        expect(profile).not.toContain('emcc');
        expect(profile).not.toContain('ndk');
        expect(profile).not.toContain('[buildenv]');
    });
});

describe('conan host profile for linux', () => {
    const linux = (platform, arch) => ({
        platform, arch, runtime: 'mt', buildType: 'release',
    });

    test("builds static packages with the linux image's clang wrappers for the triple, as the ports are built", () => {
        const profile = hostProfile(linux('linux', 'x64'));
        expect(line(profile, 'os')).toBe('Linux');
        expect(line(profile, 'arch')).toBe('x86_64');
        expect(line(profile, 'compiler')).toBe('clang');
        expect(line(profile, 'compiler.libcxx')).toBe('libc++');
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.cmake.cmaketoolchain:user_toolchain')).toBe('["/opt/crossbind/linux/x86_64-linux-gnu.cmake"]');
        expect(line(profile, 'tools.build:compiler_executables'))
            .toBe("{'c': '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang', 'cpp': '/opt/crossbind/linux/bin/x86_64-linux-gnu-clang++'}");
        expect(line(profile, 'tools.build:cflags')).toBe('["-fPIC","-pthread"]');
    });

    test('arm64 is armv8, with its own triple', () => {
        const profile = hostProfile(linux('linux', 'arm64'));
        expect(line(profile, 'arch')).toBe('armv8');
        expect(line(profile, 'tools.gnu:host_triplet')).toBe('aarch64-linux-gnu');
    });

    test('the clang wrapper names the compiler version', () => {
        expect(line(hostProfile(linux('linux', 'x64')), 'compiler.version')).toContain("['/opt/crossbind/linux/bin/x86_64-linux-gnu-clang', '-dumpversion']");
    });

    // Conan takes a musl build on a machine of the same arch for a native one, and the image runs no musl
    // program: configure, Meson's sanity check and a recipe's can_run() would run what they compile.
    test('a musl build is a cross build on any machine, and configure is told its triple', () => {
        const musl = hostProfile(linux('linuxmusl', 'arm64'));
        expect(line(musl, 'tools.build.cross_building:cross_build')).toBe('True');
        expect(line(musl, 'tools.gnu:host_triplet')).toBe('aarch64-alpine-linux-musl');
        expect(line(hostProfile(linux('linux', 'arm64')), 'tools.build.cross_building:cross_build')).toBeUndefined();
    });

    test('glibc and musl differ in the triple, the cross build and the C library alone, which takes part in the package id', () => {
        const neutral = (profile, triple) => profile.replaceAll(triple, '<triple>')
            .replace(/^user\.crossbind:libc=.*\n/m, '').replace(/^tools\.build\.cross_building:cross_build=.*\n/m, '');
        const glibc = hostProfile(linux('linux', 'x64'));
        const musl = hostProfile(linux('linuxmusl', 'x64'));
        expect(line(glibc, 'user.crossbind:libc')).toBe('glibc');
        expect(line(musl, 'user.crossbind:libc')).toBe('musl');
        expect(line(musl, 'tools.info.package_id:confs')).toContain('"user.crossbind:libc"');
        expect(neutral(musl, 'x86_64-alpine-linux-musl')).toBe(neutral(glibc, 'x86_64-linux-gnu'));
    });

    test("builds with the triple's own archive tools and none of the image's pkg-config files", () => {
        const profile = hostProfile(linux('linuxmusl', 'x64'));
        expect(line(profile, 'CC')).toBe('/opt/crossbind/linux/bin/x86_64-alpine-linux-musl-clang');
        expect(line(profile, 'AR')).toBe('/opt/crossbind/linux/bin/x86_64-alpine-linux-musl-ar');
        expect(line(profile, 'RANLIB')).toBe('/opt/crossbind/linux/bin/x86_64-alpine-linux-musl-ranlib');
        expect(line(profile, 'PKG_CONFIG_LIBDIR')).toBe('');
    });

    test('carries nothing of the emscripten or NDK toolchains', () => {
        const profile = hostProfile(linux('linux', 'arm64'));
        expect(profile).not.toContain('emcc');
        expect(profile).not.toContain('ndk');
    });
});

describe('conan host profile for macOS', () => {
    const darwin = (arch) => ({
        platform: 'darwin', arch, runtime: 'mt', buildType: 'release',
    });

    test('builds static packages with the clang xcode-select names, for the macOS the addons support', () => {
        const profile = hostProfile(darwin('arm64'));
        expect(line(profile, 'os')).toBe('Macos');
        expect(line(profile, 'os.version')).toBe('11.0');
        expect(line(profile, 'arch')).toBe('armv8');
        expect(line(profile, 'compiler')).toBe('apple-clang');
        expect(line(profile, 'compiler.version')).toContain("['/usr/bin/clang', '-dumpversion']");
        expect(line(profile, 'compiler.libcxx')).toBe('libc++');
        expect(line(profile, 'tools.build:compiler_executables')).toBe("{'c': '/usr/bin/clang', 'cpp': '/usr/bin/clang++'}");
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.build:cflags')).toBe('["-pthread"]');
    });

    test('x64 is x86_64', () => {
        expect(line(hostProfile(darwin('x64')), 'arch')).toBe('x86_64');
    });

    // Homebrew and MacPorts packages exist on the build machine only.
    test("finds none of the machine's own packages", () => {
        const profile = hostProfile(darwin('arm64'));
        expect(line(profile, 'tools.cmake.cmaketoolchain:extra_variables')).toBe("{'CMAKE_IGNORE_PREFIX_PATH': '/opt/homebrew;/usr/local;/opt/local'}");
        expect(line(profile, 'PKG_CONFIG_LIBDIR')).toBe('');
    });

    test('lets a Conan older than the Xcode take its clang', () => {
        expect(settingsUser(darwin('arm64'))).toBe('compiler:\n  apple-clang:\n    version: ["ANY"]\n');
        expect(settingsUser({ platform: 'wasm', arch: 'wasm32', runtime: 'st' })).toBeNull();
    });
});

describe('conan host profile for windows', () => {
    const win32 = (arch) => ({
        platform: 'win32', arch, runtime: 'mt', buildType: 'release',
    });

    test("builds static packages with the windows image's llvm-mingw for the triple, as the ports are built", () => {
        const profile = hostProfile(win32('x64'));
        const tool = (name) => `/opt/llvm-mingw/bin/x86_64-w64-mingw32-${name}`;
        expect(line(profile, 'os')).toBe('Windows');
        expect(line(profile, 'arch')).toBe('x86_64');
        expect(line(profile, 'compiler')).toBe('clang');
        expect(line(profile, 'compiler.version')).toContain(`['${tool('clang')}', '-dumpversion']`);
        expect(line(profile, 'compiler.libcxx')).toBe('libc++');
        expect(line(profile, 'tools.cmake.cmaketoolchain:user_toolchain')).toBe('["/opt/crossbind/windows/x86_64-w64-mingw32.cmake"]');
        expect(line(profile, 'tools.build:compiler_executables')).toBe(`{'c': '${tool('clang')}', 'cpp': '${tool('clang++')}', 'rc': '${tool('windres')}'}`);
        expect(line(profile, 'tools.gnu:host_triplet')).toBe('x86_64-w64-mingw32');
        expect(line(profile, '*:shared')).toBe('False');
        expect(line(profile, 'tools.build:cflags')).toBe('["-pthread"]');
        expect(line(profile, 'RC')).toBe(tool('windres'));
        expect(line(profile, 'PKG_CONFIG_LIBDIR')).toBe('');
    });

    // A runtime would make it a clang that stands in for MSVC, with its ABI and its library names.
    test('names no MSVC runtime: llvm-mingw links the GNU way', () => {
        expect(line(hostProfile(win32('x64')), 'compiler.runtime')).toBeUndefined();
    });

    test('arm64 is armv8, with its own triple', () => {
        const profile = hostProfile(win32('arm64'));
        expect(line(profile, 'arch')).toBe('armv8');
        expect(line(profile, 'tools.gnu:host_triplet')).toBe('aarch64-w64-mingw32');
    });

    // Conan 2.33 lists clang up to 23, the image's llvm-mingw; the next toolchain bump would be refused.
    test('lets the Conan in the image take a clang newer than it lists', () => {
        expect(settingsUser(win32('x64'))).toBe('compiler:\n  clang:\n    version: ["ANY"]\n');
    });
});

describe('conan build profile', () => {
    test('describes the machine the build tools run on', () => {
        expect(BUILD_PROFILE).toContain('detect_api.detect_os()');
        expect(BUILD_PROFILE).toContain('detect_api.detect_arch()');
    });
});
