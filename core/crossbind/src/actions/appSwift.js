import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DARWIN_DEPLOYMENT_TARGET } from '../utils/darwinToolchain.js';
import { IOS_DEPLOYMENT_TARGET } from '../utils/iosToolchain.js';

// An Apple app's extensions' Swift, which CMake's Makefiles generator compiles none of: swiftc makes each extension's a
// static library first, with the Objective-C header its own sources import, before the host builds.

// The module an extension's Swift makes: its name, with underscores for dashes, as a Swift module's name takes it.
export const swiftModule = (name) => name.replace(/-/g, '_');

// What swiftc compiles an Apple target's Swift for: the target's triple, at the app's deployment target, and its SDK.
export function swiftTarget(target) {
    if (target.platform === 'darwin') return { triple: `${target.arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos${DARWIN_DEPLOYMENT_TARGET}`, sdk: 'macosx' };
    const isDevice = target.arch === 'iphoneos';
    return { triple: `arm64-apple-ios${IOS_DEPLOYMENT_TARGET}${isDevice ? '' : '-simulator'}`, sdk: isDevice ? 'iphoneos' : 'iphonesimulator' };
}

// The swiftc arguments that make one extension's Swift a static library and the Objective-C header of its @objc classes
// and @_cdecl functions.
export function swiftArgs({ module, sources, library, header, triple, sdkPath, isRelease }) {
    return [
        'swiftc', '-parse-as-library', ...(isRelease ? ['-O'] : ['-Onone', '-g']), '-module-name', module,
        '-emit-library', '-static', '-o', library, '-emit-objc-header', '-emit-objc-header-path', header,
        '-target', triple, '-sdk', sdkPath, ...sources,
    ];
}

function xcrun(args, what) {
    const result = spawnSync('xcrun', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new Error(`crossbind: ${what} needs Xcode's xcrun: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`crossbind: ${what} failed:\n${`${result.stdout}${result.stderr}`.trim()}`);
    return result.stdout.trim();
}

// Compiles each extension's Swift for an Apple target into its folder of workDir: the library, and the header beside it,
// which the folder, added to the extension's includes, gives its sources as <module>-Swift.h.
export function compileSwift(target, compiled, workDir, isRelease) {
    const withSwift = compiled.filter(({ swift }) => swift.length > 0);
    if (withSwift.length === 0) return [];
    const { triple, sdk } = swiftTarget(target);
    const sdkPath = xcrun(['--sdk', sdk, '--show-sdk-path'], `the ${sdk} SDK's path`);
    return withSwift.map(({ name, swift }) => {
        const module = swiftModule(name);
        const dir = path.join(workDir, 'swift', module);
        fs.mkdirSync(dir, { recursive: true });
        const library = path.join(dir, `lib${module}.a`);
        const header = path.join(dir, `${module}-Swift.h`);
        xcrun(swiftArgs({ module, sources: swift, library, header, triple, sdkPath, isRelease }), `the extension ${name}'s Swift`);
        return { name, library, includes: [dir] };
    });
}

// What links the libraries: each whole, as an @objc class may be reached by its name alone, and Swift's own libraries,
// which the system holds on the app's deployment targets, beside the toolchain's back-deployed parts. An iOS app's
// Xcode project names them by its own settings, the back-deployed parts in Xcode's default toolchain, whose swiftc
// compiled them: TOOLCHAIN_DIR may name another, as the Metal toolchain.
export function swiftLinkArgs(target, libraries) {
    if (libraries.length === 0) return [];
    const searched = target.platform === 'darwin'
        ? [`-L${xcrun(['--sdk', 'macosx', '--show-sdk-path'], "the macosx SDK's path")}/usr/lib/swift`,
            `-L${path.dirname(path.dirname(xcrun(['--find', 'swiftc'], "Swift's compiler")))}/lib/swift/macosx`]
        : ['-L$(SDKROOT)/usr/lib/swift', '-L$(DEVELOPER_DIR)/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/$(PLATFORM_NAME)'];
    return [...libraries.map((library) => `-Wl,-force_load,${library}`), ...searched, '-Wl,-rpath,/usr/lib/swift'];
}
