import { describe, test, expect, vi } from 'vitest';
import hostPlatform, { resolveHostPlatform } from '../src/utils/hostPlatform.js';

describe('hostPlatform', () => {
    test.each(['darwin', 'win32'])('%s builds for itself without reading a report', (platform) => {
        const readReport = vi.fn();

        expect(hostPlatform(platform, readReport)).toBe(platform);
        expect(readReport).not.toHaveBeenCalled();
    });

    test('a glibc Linux builds the linux addons its Node.js loads', () => {
        expect(hostPlatform('linux', () => ({ header: { glibcVersionRuntime: '2.36' } }))).toBe('linux');
    });

    test('a musl Linux builds the linuxmusl ones', () => {
        expect(hostPlatform('linux', () => ({ header: {} }))).toBe('linuxmusl');
    });

    test('a Linux that cannot report keeps glibc, as the addon loader does', () => {
        expect(hostPlatform('linux', () => undefined)).toBe('linux');
    });
});

describe('resolveHostPlatform', () => {
    test('host names this machine and every other platform stays', () => {
        expect(resolveHostPlatform(['host', 'wasm'], 'linuxmusl')).toEqual(['linuxmusl', 'wasm']);
    });

    test('a list without host is kept as it is', () => {
        expect(resolveHostPlatform(['darwin', 'win32'], 'linux')).toEqual(['darwin', 'win32']);
    });
});
