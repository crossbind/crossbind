import { WASM_EXCEPTION_FLAGS, targetArchiveFlags } from './archiveFlags.js';
import { ANDROID_NDK, ANDROID_API_LEVEL } from './androidToolchain.js';
import { IOS_DEPLOYMENT_TARGET } from './iosToolchain.js';
import {
    LINUX_ARCHIVE_FLAGS, linuxBuildEnv, linuxTool, linuxToolchainFile, linuxTriple,
} from './linuxToolchain.js';
import {
    DARWIN_CC, DARWIN_CXX, DARWIN_DEPLOYMENT_TARGET, DARWIN_HOST_PACKAGE_PREFIXES,
} from './darwinToolchain.js';

// The app's own sources compile as C++20 (assets/cmake/CMakeLists.txt), so C++ packages do too.
const CPP_STANDARD = '20';
// The flags change the ABI without changing a setting, and glibc and musl builds share every setting,
// so these have to change the package id. A conf the profile leaves unset adds nothing to it.
const PACKAGE_ID_CONFS = ['tools.build:cflags', 'tools.build:cxxflags', 'tools.build:exelinkflags', 'tools.build:sharedlinkflags', 'user.crossbind:libc'];

// Conan renders profiles as Jinja templates: these read the toolchain of whatever runs Conan, the image
// or the host (under RUNNER=LOCAL, and for iOS and macOS).
const EMCC_VERSION = "{{ subprocess.check_output(['emcc', '-dumpversion'], text=True).strip() }}";
const EMSCRIPTEN_TOOLCHAIN = "{{ subprocess.check_output(['em-config', 'EMSCRIPTEN_ROOT'], text=True).strip() }}/cmake/Modules/Platform/Emscripten.cmake";
const clangMajorVersion = (clang) => `{{ subprocess.check_output(['${clang}', '-dumpversion'], text=True).split('.')[0] }}`;
const NDK_CLANG_VERSION = clangMajorVersion(`${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin/clang`);
const XCODE_CLANG_VERSION = "{{ subprocess.check_output(['xcrun', 'clang', '-dumpversion'], text=True).split('.')[0] }}";
const CMAKE_VERSION = "{{ subprocess.check_output(['cmake', '--version'], text=True).split()[2] }}";

const ANDROID_ARCHS = { 'arm64-v8a': 'armv8', x86_64: 'x86_64' };
// Node's names for the desktop arches, in Conan's spelling.
const NODE_ARCHS = { x64: 'x86_64', arm64: 'armv8' };
const LINUX_LIBCS = { linux: 'glibc', linuxmusl: 'musl' };

// The image's clang wrappers through its CMake toolchain file for the triple, as a port archive for an
// addon is built. The image runs no musl program, so a musl build is a cross build even on a machine of
// the same arch, which Conan would take for a native one; configure is told the triple itself.
const LINUX = {
    settings: (target) => [
        'os=Linux',
        `arch=${NODE_ARCHS[target.arch]}`,
        'compiler=clang',
        `compiler.version=${clangMajorVersion(linuxTool(target, 'clang'))}`,
        'compiler.libcxx=libc++',
        `compiler.cppstd=${CPP_STANDARD}`,
    ],
    conf: (target) => [
        `tools.build:compiler_executables={'c': '${linuxTool(target, 'clang')}', 'cpp': '${linuxTool(target, 'clang++')}'}`,
        `tools.cmake.cmaketoolchain:user_toolchain=["${linuxToolchainFile(target)}"]`,
        `tools.gnu:host_triplet=${linuxTriple(target)}`,
        ...(target.platform === 'linuxmusl' ? ['tools.build.cross_building:cross_build=True'] : []),
        `user.crossbind:libc=${LINUX_LIBCS[target.platform]}`,
    ],
    buildenv: (target) => Object.entries(linuxBuildEnv(target)).map(([variable, value]) => `${variable}=${value}`),
    flags: LINUX_ARCHIVE_FLAGS,
};

// What differs per platform; the rest of the host profile is shared.
const PLATFORMS = {
    wasm: {
        settings: (target) => [
            'os=Emscripten',
            `arch=${target.arch === 'wasm64' ? 'wasm64' : 'wasm'}`,
            'compiler=emcc',
            `compiler.version=${EMCC_VERSION}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${CPP_STANDARD}`,
            ...(target.runtime === 'mt' ? ['compiler.threads=posix'] : []),
        ],
        conf: () => [
            "tools.build:compiler_executables={'c': 'emcc', 'cpp': 'em++'}",
            `tools.cmake.cmaketoolchain:user_toolchain=["${EMSCRIPTEN_TOOLCHAIN}"]`,
        ],
        buildenv: () => ['CC=emcc', 'CXX=em++', 'AR=emar', 'NM=emnm', 'RANLIB=emranlib', 'STRIP=emstrip'],
        flags: WASM_EXCEPTION_FLAGS,
    },
    // The image's NDK through its own CMake toolchain and default STL, as a port archive is built.
    android: {
        settings: (target) => [
            'os=Android',
            `os.api_level=${ANDROID_API_LEVEL}`,
            `arch=${ANDROID_ARCHS[target.arch]}`,
            'compiler=clang',
            `compiler.version=${NDK_CLANG_VERSION}`,
            'compiler.libcxx=c++_static',
            `compiler.cppstd=${CPP_STANDARD}`,
        ],
        conf: () => [`tools.android:ndk_path=${ANDROID_NDK}`],
        buildenv: () => [],
        flags: [],
    },
    // Xcode's clang for the target's SDK, arm64 only like every crossbind iOS slice. No bitcode flag:
    // Xcode 27 ld takes the "marker" of -fembed-bitcode-marker for a file when CMake links its check.
    ios: {
        settings: (target) => [
            'os=iOS',
            `os.version=${IOS_DEPLOYMENT_TARGET}`,
            `os.sdk=${target.arch}`,
            'arch=armv8',
            'compiler=apple-clang',
            `compiler.version=${XCODE_CLANG_VERSION}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${CPP_STANDARD}`,
        ],
        conf: () => [],
        buildenv: () => [],
        flags: [],
    },
    linux: LINUX,
    linuxmusl: LINUX,
    // The clang xcode-select picks, for the macOS the addons support, as a port archive for a macOS addon
    // is built; the machine's own packages stay out of reach.
    darwin: {
        settings: (target) => [
            'os=Macos',
            `os.version=${DARWIN_DEPLOYMENT_TARGET}`,
            `arch=${NODE_ARCHS[target.arch]}`,
            'compiler=apple-clang',
            `compiler.version=${clangMajorVersion(DARWIN_CC)}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${CPP_STANDARD}`,
        ],
        conf: () => [
            `tools.build:compiler_executables={'c': '${DARWIN_CC}', 'cpp': '${DARWIN_CXX}'}`,
            `tools.cmake.cmaketoolchain:extra_variables={'CMAKE_IGNORE_PREFIX_PATH': '${DARWIN_HOST_PACKAGE_PREFIXES.join(';')}'}`,
        ],
        buildenv: () => ['PKG_CONFIG_LIBDIR='],
        flags: [],
    },
};

export const BUILD_PROFILE = [
    '{% set compiler, version, compiler_exe = detect_api.detect_default_compiler() %}',
    '[settings]',
    'os={{ detect_api.detect_os() }}',
    'arch={{ detect_api.detect_arch() }}',
    'build_type=Release',
    'compiler={{ compiler }}',
    'compiler.version={{ detect_api.default_compiler_version(compiler, version) }}',
    'compiler.cppstd={{ detect_api.default_cppstd(compiler, version) }}',
    'compiler.libcxx={{ detect_api.detect_libcxx(compiler, version, compiler_exe) }}',
    '',
].join('\n');

const list = (values) => JSON.stringify(values);

// Conan checks compiler.version against the versions its own release lists, and a Conan older than the
// Xcode lists none for its clang. Added to the run's home, this lets any apple-clang version through.
export const settingsUser = (target) => (PLATFORMS[target.platform]?.settings(target).includes('compiler=apple-clang')
    ? 'compiler:\n  apple-clang:\n    version: ["ANY"]\n'
    : null);

export function hostProfile(target) {
    const platform = PLATFORMS[target.platform];
    if (!platform) {
        const names = Object.keys(PLATFORMS);
        throw new Error(`crossbind: conan: imports build for ${names.slice(0, -1).join(', ')} and ${names.at(-1)} so far; ${target.platform} is not supported yet, so its build cannot use conanDependencies.`);
    }
    const flags = list([...platform.flags, ...targetArchiveFlags(target)]);
    const buildenv = platform.buildenv(target);
    return [
        '[settings]',
        ...platform.settings(target),
        'build_type=Release',
        '',
        '[options]',
        '*:shared=False',
        '',
        '[conf]',
        ...platform.conf(target),
        `tools.build:cflags=${flags}`,
        `tools.build:cxxflags=${flags}`,
        `tools.build:exelinkflags=${flags}`,
        `tools.build:sharedlinkflags=${flags}`,
        `tools.info.package_id:confs=${list(PACKAGE_ID_CONFS)}`,
        '',
        ...(buildenv.length > 0 ? ['[buildenv]', ...buildenv, ''] : []),
        '[platform_tool_requires]',
        `cmake/${CMAKE_VERSION}`,
        '',
    ].join('\n');
}
