// The windows image's llvm-mingw and its CMake toolchain files, one per target triple: port archives and
// Conan packages link into the same addon, so they move together.
const LLVM_MINGW = '/opt/llvm-mingw';
const WINDOWS_TOOLCHAIN = '/opt/crossbind/windows';
const WINDOWS_TRIPLES = { x64: 'x86_64-w64-mingw32', arm64: 'aarch64-w64-mingw32' };

export const windowsTriple = (target) => WINDOWS_TRIPLES[target.arch];
export const windowsToolchainFile = (target) => `${WINDOWS_TOOLCHAIN}/${windowsTriple(target)}.cmake`;
export const windowsTool = (target, name) => `${LLVM_MINGW}/bin/${windowsTriple(target)}-${name}`;

// The compilers, archive and resource tools of the target's triple, by the variables build systems read
// them from. The image's own .pc files describe its libraries, not the target's, so pkg-config reads none.
export const windowsBuildEnv = (target) => ({
    ...Object.fromEntries(Object.entries({
        CC: 'clang', CXX: 'clang++', AR: 'ar', RANLIB: 'ranlib', NM: 'nm', STRIP: 'strip', RC: 'windres', WINDRES: 'windres',
    }).map(([variable, tool]) => [variable, windowsTool(target, tool)])),
    PKG_CONFIG_LIBDIR: '',
});
