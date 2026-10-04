import { test, expect } from 'vitest';
import { windowsBuildEnv, windowsToolchainFile } from '../src/utils/windowsToolchain.js';

test.each([
    ['x64', 'x86_64-w64-mingw32'],
    ['arm64', 'aarch64-w64-mingw32'],
])("win32 %s builds with the windows image's %s tools and none of its pkg-config files", (arch, triple) => {
    const bin = `/opt/llvm-mingw/bin/${triple}`;

    expect(windowsBuildEnv({ platform: 'win32', arch })).toEqual({
        CC: `${bin}-clang`,
        CXX: `${bin}-clang++`,
        AR: `${bin}-ar`,
        RANLIB: `${bin}-ranlib`,
        NM: `${bin}-nm`,
        STRIP: `${bin}-strip`,
        RC: `${bin}-windres`,
        WINDRES: `${bin}-windres`,
        PKG_CONFIG_LIBDIR: '',
    });
    expect(windowsToolchainFile({ platform: 'win32', arch })).toBe(`/opt/crossbind/windows/${triple}.cmake`);
});
