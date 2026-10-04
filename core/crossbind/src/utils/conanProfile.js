import { WASM_EXCEPTION_FLAGS, targetArchiveFlags } from './archiveFlags.js';

// The app's own sources compile as C++20 (assets/cmake/CMakeLists.txt), so C++ packages do too.
const CPP_STANDARD = '20';
// The flags change the ABI without changing a setting, so they have to change the package id.
const PACKAGE_ID_CONFS = ['tools.build:cflags', 'tools.build:cxxflags', 'tools.build:exelinkflags', 'tools.build:sharedlinkflags'];

// Conan renders profiles as Jinja templates: these read the toolchain of whatever runs Conan, the image
// or the host under RUNNER=LOCAL.
const EMCC_VERSION = "{{ subprocess.check_output(['emcc', '-dumpversion'], text=True).strip() }}";
const EMSCRIPTEN_TOOLCHAIN = "{{ subprocess.check_output(['em-config', 'EMSCRIPTEN_ROOT'], text=True).strip() }}/cmake/Modules/Platform/Emscripten.cmake";
const CMAKE_VERSION = "{{ subprocess.check_output(['cmake', '--version'], text=True).split()[2] }}";

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

export function hostProfile(target) {
    if (target.platform !== 'wasm') {
        throw new Error(`crossbind: conan: imports build for wasm only so far; ${target.platform} is not supported yet. Build the wasm targets only (crossbind build -p wasm).`);
    }
    const flags = list([...WASM_EXCEPTION_FLAGS, ...targetArchiveFlags(target)]);
    return [
        '[settings]',
        'os=Emscripten',
        `arch=${target.arch === 'wasm64' ? 'wasm64' : 'wasm'}`,
        'compiler=emcc',
        `compiler.version=${EMCC_VERSION}`,
        'compiler.libcxx=libc++',
        `compiler.cppstd=${CPP_STANDARD}`,
        ...(target.runtime === 'mt' ? ['compiler.threads=posix'] : []),
        'build_type=Release',
        '',
        '[options]',
        '*:shared=False',
        '',
        '[conf]',
        "tools.build:compiler_executables={'c': 'emcc', 'cpp': 'em++'}",
        `tools.cmake.cmaketoolchain:user_toolchain=["${EMSCRIPTEN_TOOLCHAIN}"]`,
        `tools.build:cflags=${flags}`,
        `tools.build:cxxflags=${flags}`,
        `tools.build:exelinkflags=${flags}`,
        `tools.build:sharedlinkflags=${flags}`,
        `tools.info.package_id:confs=${list(PACKAGE_ID_CONFS)}`,
        '',
        '[buildenv]',
        'CC=emcc',
        'CXX=em++',
        'AR=emar',
        'NM=emnm',
        'RANLIB=emranlib',
        'STRIP=emstrip',
        '',
        '[platform_tool_requires]',
        `cmake/${CMAKE_VERSION}`,
        '',
    ].join('\n');
}
