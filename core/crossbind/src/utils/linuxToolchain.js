// The linux image's clang wrappers and CMake toolchain files, one per target triple, and the flags every
// Linux archive is built with: port archives and Conan packages link into the same addon, so they move
// together.
const LINUX_TOOLCHAIN = '/opt/crossbind/linux';
const LINUX_TRIPLES = {
    linux: { x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' },
    linuxmusl: { x64: 'x86_64-alpine-linux-musl', arm64: 'aarch64-alpine-linux-musl' },
};
// Every archive ends up inside a loadable .node module, so -fPIC holds even where a project turns
// position-independent code off for static builds, as GDAL does.
export const LINUX_ARCHIVE_FLAGS = ['-fPIC'];

export const linuxTriple = (target) => LINUX_TRIPLES[target.platform][target.arch];
export const linuxToolchainFile = (target) => `${LINUX_TOOLCHAIN}/${linuxTriple(target)}.cmake`;
export const linuxTool = (target, name) => `${LINUX_TOOLCHAIN}/bin/${linuxTriple(target)}-${name}`;

// The compilers and archive tools of the target's triple, by the variables build systems read them from.
// The image's own .pc files describe its libraries, not the sysroot's, so pkg-config reads none of them.
export const linuxBuildEnv = (target) => ({
    ...Object.fromEntries(Object.entries({
        CC: 'clang', CXX: 'clang++', AR: 'ar', RANLIB: 'ranlib', NM: 'nm', STRIP: 'strip',
    }).map(([variable, tool]) => [variable, linuxTool(target, tool)])),
    PKG_CONFIG_LIBDIR: '',
});
