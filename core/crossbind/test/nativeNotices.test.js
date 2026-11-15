import { beforeEach, describe, expect, test, vi } from 'vitest';

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../src/actions/run.js', () => ({ default: run }));

const { default: copyNativeNotices } = await import('../src/actions/nativeNotices.js');

// The one command a native link's notices take: sh in the target's own image, from the build directory.
function scriptFor(target) {
    copyNativeNotices(target);
    expect(run).toHaveBeenCalledTimes(1);
    const [program, [flag, script], prefix, calledTarget] = run.mock.calls[0];
    expect([program, flag, prefix, calledTarget]).toEqual(['sh', '-c', null, target]);
    return script;
}

describe("a native build's toolchain notices", () => {
    beforeEach(() => {
        run.mockReset();
    });

    test("are, on Windows, mingw-w64's notices, LLVM's license and both runtimes' versions, from the windows image", () => {
        const script = scriptFor({ platform: 'win32', arch: 'x64' });

        expect(script).toContain('mkdir -p toolchain-licenses/win32');
        expect(script).toContain('if [ -d /opt/licenses/llvm-mingw ]; then cp /opt/licenses/llvm-mingw/COPYING* toolchain-licenses/win32/; fi');
        expect(script).toContain('if [ -f /opt/licenses/llvm-mingw/LICENSE.TXT ]; then cp /opt/licenses/llvm-mingw/LICENSE.TXT toolchain-licenses/win32/llvm-LICENSE.TXT; fi');
        expect(script).toContain('if [ -x /opt/llvm-mingw/bin/clang ]; then /opt/llvm-mingw/bin/clang --version > toolchain-licenses/win32/clang-version.txt; fi');
        expect(script).toContain("grep '#define __MINGW64_VERSION_' /opt/llvm-mingw/x86_64-w64-mingw32/include/_mingw_mac.h > toolchain-licenses/win32/mingw-w64-version.txt");
    });

    test.each([
        ['linux', 'x64', 'x86_64-linux-gnu'],
        ['linux', 'arm64', 'aarch64-linux-gnu'],
        ['linuxmusl', 'arm64', 'aarch64-alpine-linux-musl'],
    ])("are, for %s %s, libc++'s license and the version of the libc++ its sysroot holds", (platform, arch, triple) => {
        const script = scriptFor({ platform, arch });
        const config = `/opt/crossbind/sysroots/${triple}/usr/include/c++/v1/__config`;

        expect(script).toContain(`mkdir -p toolchain-licenses/${platform}`);
        expect(script).toContain(`if [ -f /opt/licenses/linux-sysroot/libcxx-LICENSE.TXT ]; then cp /opt/licenses/linux-sysroot/libcxx-LICENSE.TXT toolchain-licenses/${platform}/llvm-LICENSE.TXT; fi`);
        expect(script).toContain(`if [ -f ${config} ]; then grep '#  *define _LIBCPP_VERSION ' ${config} > toolchain-licenses/${platform}/libcxx-version.txt; fi`);
    });

    test("are, for an Android app, the version of the NDK's clang, whose libc++ the app carries", () => {
        const script = scriptFor({ platform: 'android', arch: 'arm64-v8a', runtimeEnv: 'app' });
        const clang = '/opt/android-sdk/ndk/current/toolchains/llvm/prebuilt/linux-x86_64/bin/clang';

        expect(script).toContain('mkdir -p toolchain-licenses/android');
        expect(script).toContain(`if [ -x ${clang} ]; then ${clang} --version > toolchain-licenses/android/clang-version.txt; fi`);
    });

    // A Mac builds its own and Apple's binaries without an image, and a wasm link copies its own notices.
    test.each(['darwin', 'ios', 'wasm'])('run nothing for %s', (platform) => {
        copyNativeNotices({ platform, arch: 'arm64' });

        expect(run).not.toHaveBeenCalled();
    });
});
