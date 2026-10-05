import { describe, test, expect } from 'vitest';
import missingAddonRemedy from '../../embind-napi/js/missingAddon.js';

const published = ['darwin-arm64', 'linux-x64', 'win32-x64'];

describe('missingAddonRemedy', () => {
    test('asks to install the addon package npm left out on a machine the package publishes for', () => {
        const remedy = missingAddonRemedy({ platform: 'linux', arch: 'x64', addonPackage: '@crossbind/port-zlib-standalone-napi-linux-x64', published });

        expect(remedy).toBe('install @crossbind/port-zlib-standalone-napi-linux-x64, which npm leaves out with --omit=optional; addons exist for darwin-arm64, linux-x64, win32-x64');
    });

    // A package may publish for some platforms only; installing a package that does not exist would not help.
    test('names the platforms the package publishes for on a machine it does not', () => {
        const remedy = missingAddonRemedy({ platform: 'linux', arch: 'arm64', addonPackage: '@crossbind/port-zlib-standalone-napi-linux-arm64', published });

        expect(remedy).toBe('this package publishes no addon for linux-arm64, only for darwin-arm64, linux-x64, win32-x64');
    });

    test('asks an app without addon packages to build its addon', () => {
        expect(missingAddonRemedy({ platform: 'linuxmusl', arch: 'x64', addonPackage: null, published: [] }))
            .toBe('build it with `crossbind build -p linuxmusl -a x64`');
    });
});
