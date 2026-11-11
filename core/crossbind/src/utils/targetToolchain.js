import { WASM_EXCEPTION_FLAGS, targetArchiveFlags } from './archiveFlags.js';
import { ANDROID_NDK, ANDROID_API_LEVEL } from './androidToolchain.js';
import { IOS_DEPLOYMENT_TARGET } from './iosToolchain.js';
import {
    LINUX_ARCHIVE_FLAGS, linuxBuildEnv, linuxTool, linuxToolchainFile, linuxTriple,
} from './linuxToolchain.js';
import {
    DARWIN_CC, DARWIN_CXX, DARWIN_DEPLOYMENT_TARGET, DARWIN_HOST_PACKAGE_PREFIXES,
} from './darwinToolchain.js';
import {
    windowsBuildEnv, windowsTool, windowsToolchainFile, windowsTriple,
} from './windowsToolchain.js';

// What crossbind builds a target's own archives with, as plain data: a package source builds its packages to match,
// since they link into the same module.
const CPP_STANDARD = '20';
const NDK_BIN = `${ANDROID_NDK}/toolchains/llvm/prebuilt/linux-x86_64/bin`;
const LINUX_LIBCS = { linux: 'glibc', linuxmusl: 'musl' };

const linux = (target) => ({
    flags: LINUX_ARCHIVE_FLAGS,
    compilers: { c: linuxTool(target, 'clang'), cpp: linuxTool(target, 'clang++') },
    env: linuxBuildEnv(target),
    cmakeToolchainFile: linuxToolchainFile(target),
    triple: linuxTriple(target),
    libc: LINUX_LIBCS[target.platform],
});

const PLATFORMS = {
    wasm: () => ({
        flags: WASM_EXCEPTION_FLAGS,
        compilers: { c: 'emcc', cpp: 'em++' },
        env: {
            CC: 'emcc', CXX: 'em++', AR: 'emar', NM: 'emnm', RANLIB: 'emranlib', STRIP: 'emstrip',
        },
    }),
    android: () => ({
        compilers: { c: `${NDK_BIN}/clang`, cpp: `${NDK_BIN}/clang++` },
        ndk: ANDROID_NDK,
        apiLevel: ANDROID_API_LEVEL,
    }),
    // No compilers: Xcode's own build it, which xcrun finds for the SDK the arch names.
    ios: () => ({ deploymentTarget: IOS_DEPLOYMENT_TARGET }),
    linux,
    linuxmusl: linux,
    darwin: () => ({
        compilers: { c: DARWIN_CC, cpp: DARWIN_CXX },
        env: { PKG_CONFIG_LIBDIR: '' },
        deploymentTarget: DARWIN_DEPLOYMENT_TARGET,
        ignoredPrefixes: [...DARWIN_HOST_PACKAGE_PREFIXES],
    }),
    win32: (target) => ({
        compilers: {
            c: windowsTool(target, 'clang'), cpp: windowsTool(target, 'clang++'), rc: windowsTool(target, 'windres'),
        },
        env: windowsBuildEnv(target),
        cmakeToolchainFile: windowsToolchainFile(target),
        triple: windowsTriple(target),
    }),
};

export const TOOLCHAIN_PLATFORMS = Object.keys(PLATFORMS);

// Null for a platform package sources build nothing for yet.
export function targetToolchain(target) {
    const own = PLATFORMS[target.platform]?.(target);
    if (!own) return null;
    return {
        platform: target.platform,
        arch: target.arch,
        runtime: target.runtime,
        cppStandard: CPP_STANDARD,
        env: {},
        ...own,
        flags: [...(own.flags ?? []), ...targetArchiveFlags(target)],
    };
}
