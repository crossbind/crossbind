import { describe, test, expect } from 'vitest';
import {
    boundHeaderSpecifiers, bridgeTargetOrder, bridgeTargets, nodeBridgeTarget, resolveBoundHeaders, headerAliases,
} from '../src/utils/boundHeaders.js';

const ext = { header: ['h', 'hpp', 'hxx', 'hh'] };
const zlibLinux = {
    package: { name: '@crossbind/port-zlib-linux' },
    general: { alias: { package: '@crossbind/port-zlib' } },
    export: { publicHeaders: ['zlib.h'] },
};
const configOf = (headers, allDependencies = [zlibLinux]) => ({ export: { bindings: { headers } }, ext, allDependencies });

describe('boundHeaderSpecifiers', () => {
    test('binds nothing unless the config names headers', () => {
        expect(boundHeaderSpecifiers({ export: {}, ext, allDependencies: [] })).toEqual([]);
    });

    test('takes header paths as they are', () => {
        expect(boundHeaderSpecifiers(configOf(['@crossbind/port-curl/curl/curl.h']))).toEqual(['@crossbind/port-curl/curl/curl.h']);
    });

    test('expands a package name to the public headers its dependency lists', () => {
        expect(boundHeaderSpecifiers(configOf(['@crossbind/port-zlib']))).toEqual(['@crossbind/port-zlib/zlib.h']);
    });

    test('lists a header once when a package name and its path both name it', () => {
        expect(boundHeaderSpecifiers(configOf(['@crossbind/port-zlib', '@crossbind/port-zlib/zlib.h']))).toEqual(['@crossbind/port-zlib/zlib.h']);
    });

    test('rejects a package name that no dependency lists public headers for', () => {
        expect(() => boundHeaderSpecifiers(configOf(['@crossbind/port-proj']))).toThrow(/@crossbind\/port-proj.*export\.publicHeaders/);
    });

    test('rejects entries that are not names', () => {
        expect(() => boundHeaderSpecifiers(configOf('zlib.h'))).toThrow(/export\.bindings\.headers/);
        expect(() => boundHeaderSpecifiers(configOf([42]))).toThrow(/export\.bindings\.headers/);
    });

    // Every header binds into one entry module per runtime, so two packages may ship the same include path.
    test('keeps headers of two packages at the same include path', () => {
        expect(boundHeaderSpecifiers(configOf(['@crossbind/port-a/types.h', '@crossbind/port-b/types.h'])))
            .toEqual(['@crossbind/port-a/types.h', '@crossbind/port-b/types.h']);
    });
});

describe('bridgeTargetOrder', () => {
    // A package must come out the same on every host, and every host can build a linux target.
    test('reads the headers of a linux target first', () => {
        const targets = [
            { platform: 'darwin', arch: 'arm64' }, { platform: 'linux', arch: 'arm64' }, { platform: 'linux', arch: 'x64' },
            { platform: 'linuxmusl', arch: 'arm64' }, { platform: 'win32', arch: 'arm64' },
        ];

        expect(bridgeTargetOrder(targets).map(({ platform, arch }) => `${platform}-${arch}`))
            .toEqual(['linux-arm64', 'linux-x64', 'linuxmusl-arm64', 'win32-arm64', 'darwin-arm64']);
    });
});

describe('bridgeTargets', () => {
    const target = (platform, arch, runtimeEnv = 'node') => ({ platform, arch, runtimeEnv });
    const darwinArm = target('darwin', 'arm64');
    const linuxArm = target('linux', 'arm64');
    const linuxX64 = target('linux', 'x64');
    const all = [darwinArm, linuxArm, linuxX64, target('wasm', 'wasm32', 'node'), target('linux', 'x64', 'native')];
    const names = (targets) => targets.map(({ platform, arch, runtimeEnv }) => `${platform}-${arch}-${runtimeEnv}`);

    // A macOS host without Docker builds no linux addon, yet reads the bridges a linux build made.
    test('puts the linux targets of the runtime environment first when the build makes only macOS addons', () => {
        expect(names(bridgeTargets([darwinArm], all))).toEqual(['linux-arm64-node', 'linux-x64-node', 'darwin-arm64-node']);
    });

    test('keeps a built target ahead of an unbuilt one of its platform', () => {
        expect(names(bridgeTargets([linuxX64], all))).toEqual(['linux-x64-node', 'linux-arm64-node', 'darwin-arm64-node']);
    });
});

describe('nodeBridgeTarget', () => {
    const target = (platform, arch, buildType) => ({
        platform, arch, runtime: 'mt', buildType, path: `${platform}-${arch}-mt-${buildType}`, releasePath: `${platform}-${arch}-mt-release`,
    });

    // Conan packages are staged for release targets only, as Metro's bridges read the platform's release target.
    test("reads the app's headers for the first target in bridge order, as a release one", () => {
        expect(nodeBridgeTarget([target('darwin', 'arm64', 'debug'), target('linuxmusl', 'x64', 'debug')]))
            .toEqual(expect.objectContaining({ platform: 'linuxmusl', arch: 'x64', buildType: 'release', path: 'linuxmusl-x64-mt-release' }));
    });
});

describe('resolveBoundHeaders', () => {
    const darwin = { platform: 'darwin', path: 'darwin-arm64-mt-release' };
    const linux = { platform: 'linux', path: 'linux-x64-mt-release' };

    // A desktop build has no target every platform package covers: the darwin one is missing on a linux host.
    test('resolves each header under the first target whose dependency ships it', () => {
        const resolve = (specifier, target) => {
            if (target === darwin) throw new Error('Could not resolve');
            return `/ports/zlib/linux/dist/prebuilt/${target.path}/include/zlib.h`;
        };

        expect(resolveBoundHeaders(['@crossbind/port-zlib/zlib.h'], [darwin, linux], resolve)).toEqual([{
            specifier: '@crossbind/port-zlib/zlib.h',
            file: '/ports/zlib/linux/dist/prebuilt/linux-x64-mt-release/include/zlib.h',
            target: linux,
        }]);
    });

    test('fails when no target ships the header', () => {
        expect(() => resolveBoundHeaders(['@crossbind/port-zlib/zlib.h'], [darwin, linux], () => null))
            .toThrow(/@crossbind\/port-zlib\/zlib\.h.*darwin-arm64-mt-release, linux-x64-mt-release/);
    });
});

// GNU libiconv binds libiconv_open, and its header names it iconv_open, the name its users call.
describe('headerAliases', () => {
    const header = [
        '#define iconv_t libiconv_t',
        '#define iconv_open libiconv_open',
        'extern iconv_t iconv_open (const char* tocode, const char* fromcode);',
        '#define deflateInit(strm, level) deflateInit_((strm), (level))',
        '#define ICONV_TRIVIALP 0',
    ].join('\n');

    test('pairs each object-like macro that renames a bound name with it', () => {
        expect(headerAliases(header, ['libiconv_open', 'ICONV_TRIVIALP'])).toEqual([{ local: 'iconv_open', wire: 'libiconv_open' }]);
    });

    test('leaves out a macro whose name is bound itself', () => {
        expect(headerAliases('#define compress compress\n', ['compress'])).toEqual([]);
    });
});
