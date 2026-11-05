import { describe, expect, test } from 'vitest';
import { swiftArgs, swiftLinkArgs, swiftModule, swiftTarget } from '../src/actions/appSwift.js';

describe("an Apple app's extensions' Swift", () => {
    test("compiles for the app's deployment target on each Apple platform", () => {
        expect(swiftTarget({ platform: 'darwin', arch: 'arm64' })).toEqual({ triple: 'arm64-apple-macos11.0', sdk: 'macosx' });
        expect(swiftTarget({ platform: 'darwin', arch: 'x64' })).toEqual({ triple: 'x86_64-apple-macos11.0', sdk: 'macosx' });
        expect(swiftTarget({ platform: 'ios', arch: 'iphoneos' })).toEqual({ triple: 'arm64-apple-ios15.1', sdk: 'iphoneos' });
        expect(swiftTarget({ platform: 'ios', arch: 'iphonesimulator' })).toEqual({ triple: 'arm64-apple-ios15.1-simulator', sdk: 'iphonesimulator' });
    });

    test("makes an extension's a module of its name, a static library and the header of its @objc and @_cdecl parts", () => {
        expect(swiftModule('secure-storage')).toBe('secure_storage');
        const args = swiftArgs({
            module: 'secure_storage', sources: ['/ext/store.swift'], library: '/work/libsecure_storage.a', header: '/work/secure_storage-Swift.h',
            triple: 'arm64-apple-macos11.0', sdkPath: '/sdk', isRelease: true,
        });
        expect(args).toEqual([
            'swiftc', '-parse-as-library', '-O', '-module-name', 'secure_storage', '-emit-library', '-static', '-o', '/work/libsecure_storage.a',
            '-emit-objc-header', '-emit-objc-header-path', '/work/secure_storage-Swift.h', '-target', 'arm64-apple-macos11.0', '-sdk', '/sdk', '/ext/store.swift',
        ]);
        expect(swiftArgs({ module: 'm', sources: [], library: 'l', header: 'h', triple: 't', sdkPath: 's', isRelease: false })).toEqual(expect.arrayContaining(['-Onone', '-g']));
    });

    test("links each library whole, with Swift's own libraries an iOS app's Xcode project finds by its settings", () => {
        expect(swiftLinkArgs({ platform: 'ios', arch: 'iphoneos' }, [])).toEqual([]);
        expect(swiftLinkArgs({ platform: 'ios', arch: 'iphoneos' }, ['/work/libprobe.a'])).toEqual([
            '-Wl,-force_load,/work/libprobe.a', '-L$(SDKROOT)/usr/lib/swift', '-L$(DEVELOPER_DIR)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/$(PLATFORM_NAME)', '-Wl,-rpath,/usr/lib/swift',
        ]);
    });
});
