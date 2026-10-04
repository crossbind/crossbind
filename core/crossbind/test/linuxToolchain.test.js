import { test, expect } from 'vitest';
import { linuxBuildEnv, linuxToolchainFile } from '../src/utils/linuxToolchain.js';

test.each([
    ['linux', 'x64', 'x86_64-linux-gnu'],
    ['linux', 'arm64', 'aarch64-linux-gnu'],
    ['linuxmusl', 'x64', 'x86_64-alpine-linux-musl'],
    ['linuxmusl', 'arm64', 'aarch64-alpine-linux-musl'],
])("%s %s builds with the linux image's %s tools and none of its pkg-config files", (platform, arch, triple) => {
    const bin = `/opt/crossbind/linux/bin/${triple}`;

    expect(linuxBuildEnv({ platform, arch })).toEqual({
        CC: `${bin}-clang`,
        CXX: `${bin}-clang++`,
        AR: `${bin}-ar`,
        RANLIB: `${bin}-ranlib`,
        NM: `${bin}-nm`,
        STRIP: `${bin}-strip`,
        PKG_CONFIG_LIBDIR: '',
    });
    expect(linuxToolchainFile({ platform, arch })).toBe(`/opt/crossbind/linux/${triple}.cmake`);
});
