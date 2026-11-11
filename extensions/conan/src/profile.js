// Conan's profile of a target, from what crossbind says of the target's toolchain: the packages link into the same
// module as the app's own archives, so they build with the same compilers, flags and C++ standard.

// The flags change the ABI without changing a setting, and glibc and musl builds share every setting,
// so these have to change the package id. A conf the profile leaves unset adds nothing to it.
const PACKAGE_ID_CONFS = ['tools.build:cflags', 'tools.build:cxxflags', 'tools.build:exelinkflags', 'tools.build:sharedlinkflags', 'user.crossbind:libc'];

// Conan renders profiles as Jinja templates: these read the toolchain of whatever runs Conan, the image
// or this machine.
const EMCC_VERSION = "{{ subprocess.check_output(['emcc', '-dumpversion'], text=True).strip() }}";
const EMSCRIPTEN_TOOLCHAIN = "{{ subprocess.check_output(['em-config', 'EMSCRIPTEN_ROOT'], text=True).strip() }}/cmake/Modules/Platform/Emscripten.cmake";
const clangMajorVersion = (clang) => `{{ subprocess.check_output(['${clang}', '-dumpversion'], text=True).split('.')[0] }}`;
const XCODE_CLANG_VERSION = "{{ subprocess.check_output(['xcrun', 'clang', '-dumpversion'], text=True).split('.')[0] }}";
const CMAKE_VERSION = "{{ subprocess.check_output(['cmake', '--version'], text=True).split()[2] }}";

const ANDROID_ARCHS = { 'arm64-v8a': 'armv8', x86_64: 'x86_64' };
// Node's names for the desktop arches, in Conan's spelling.
const NODE_ARCHS = { x64: 'x86_64', arm64: 'armv8' };

const list = (values) => JSON.stringify(values);
const envLines = (env) => Object.entries(env).map(([variable, value]) => `${variable}=${value}`);
const executables = (compilers) => `{${Object.entries(compilers).map(([language, program]) => `'${language}': '${program}'`).join(', ')}}`;

// The image runs no musl program, so a musl build is a cross build even on a machine of the same arch,
// which Conan would take for a native one; configure is told the triple itself.
const LINUX = {
    settings: (toolchain) => [
        'os=Linux',
        `arch=${NODE_ARCHS[toolchain.arch]}`,
        'compiler=clang',
        `compiler.version=${clangMajorVersion(toolchain.compilers.c)}`,
        'compiler.libcxx=libc++',
        `compiler.cppstd=${toolchain.cppStandard}`,
    ],
    conf: (toolchain) => [
        `tools.build:compiler_executables=${executables(toolchain.compilers)}`,
        `tools.cmake.cmaketoolchain:user_toolchain=["${toolchain.cmakeToolchainFile}"]`,
        `tools.gnu:host_triplet=${toolchain.triple}`,
        ...(toolchain.libc === 'musl' ? ['tools.build.cross_building:cross_build=True'] : []),
        `user.crossbind:libc=${toolchain.libc}`,
    ],
};

// What differs per platform; the rest of the host profile is shared.
const PLATFORMS = {
    wasm: {
        settings: (toolchain) => [
            'os=Emscripten',
            `arch=${toolchain.arch === 'wasm64' ? 'wasm64' : 'wasm'}`,
            'compiler=emcc',
            `compiler.version=${EMCC_VERSION}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${toolchain.cppStandard}`,
            ...(toolchain.runtime === 'mt' ? ['compiler.threads=posix'] : []),
        ],
        conf: (toolchain) => [
            `tools.build:compiler_executables=${executables(toolchain.compilers)}`,
            `tools.cmake.cmaketoolchain:user_toolchain=["${EMSCRIPTEN_TOOLCHAIN}"]`,
        ],
    },
    // The NDK through its own CMake toolchain and default STL.
    android: {
        settings: (toolchain) => [
            'os=Android',
            `os.api_level=${toolchain.apiLevel}`,
            `arch=${ANDROID_ARCHS[toolchain.arch]}`,
            'compiler=clang',
            `compiler.version=${clangMajorVersion(toolchain.compilers.c)}`,
            'compiler.libcxx=c++_static',
            `compiler.cppstd=${toolchain.cppStandard}`,
        ],
        conf: (toolchain) => [`tools.android:ndk_path=${toolchain.ndk}`],
    },
    // Xcode's clang for the SDK the arch names, arm64 only like every crossbind iOS slice. No bitcode flag:
    // Xcode 27 ld takes the "marker" of -fembed-bitcode-marker for a file when CMake links its check.
    ios: {
        settings: (toolchain) => [
            'os=iOS',
            `os.version=${toolchain.deploymentTarget}`,
            `os.sdk=${toolchain.arch}`,
            'arch=armv8',
            'compiler=apple-clang',
            `compiler.version=${XCODE_CLANG_VERSION}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${toolchain.cppStandard}`,
        ],
        conf: () => [],
    },
    linux: LINUX,
    linuxmusl: LINUX,
    // The machine's own packages stay out of reach.
    darwin: {
        settings: (toolchain) => [
            'os=Macos',
            `os.version=${toolchain.deploymentTarget}`,
            `arch=${NODE_ARCHS[toolchain.arch]}`,
            'compiler=apple-clang',
            `compiler.version=${clangMajorVersion(toolchain.compilers.c)}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${toolchain.cppStandard}`,
        ],
        conf: (toolchain) => [
            `tools.build:compiler_executables=${executables(toolchain.compilers)}`,
            `tools.cmake.cmaketoolchain:extra_variables={'CMAKE_IGNORE_PREFIX_PATH': '${toolchain.ignoredPrefixes.join(';')}'}`,
        ],
    },
    // No compiler.runtime: that would make it a clang standing in for MSVC.
    win32: {
        settings: (toolchain) => [
            'os=Windows',
            `arch=${NODE_ARCHS[toolchain.arch]}`,
            'compiler=clang',
            `compiler.version=${clangMajorVersion(toolchain.compilers.c)}`,
            'compiler.libcxx=libc++',
            `compiler.cppstd=${toolchain.cppStandard}`,
        ],
        conf: (toolchain) => [
            `tools.build:compiler_executables=${executables(toolchain.compilers)}`,
            `tools.cmake.cmaketoolchain:user_toolchain=["${toolchain.cmakeToolchainFile}"]`,
            `tools.gnu:host_triplet=${toolchain.triple}`,
        ],
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

// Conan checks compiler.version against the versions its own release lists, and a compiler newer than the
// Conan release lists none for it: Xcode's on the host, or an image's after a toolchain bump. Added to the
// run's home, this lets any version of the profile's clang through.
export function settingsUser(toolchain) {
    const compiler = PLATFORMS[toolchain.platform]?.settings(toolchain).find((setting) => setting.startsWith('compiler='))?.slice('compiler='.length);
    return ['clang', 'apple-clang'].includes(compiler) ? `compiler:\n  ${compiler}:\n    version: ["ANY"]\n` : null;
}

export function hostProfile(toolchain) {
    const platform = PLATFORMS[toolchain.platform];
    if (!platform) {
        throw new Error(`crossbind: conan has no profile for ${toolchain.platform} yet, so its build cannot use packages.conan.`);
    }
    const flags = list(toolchain.flags);
    const buildenv = envLines(toolchain.env);
    return [
        '[settings]',
        ...platform.settings(toolchain),
        'build_type=Release',
        '',
        '[options]',
        '*:shared=False',
        '',
        '[conf]',
        ...platform.conf(toolchain),
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
