import { describe, test, expect, vi } from 'vitest';
import addonPlatform from '../../embind-napi/js/addonPlatform.js';

describe('addonPlatform', () => {
    test('a process linked against glibc loads the linux addon', () => {
        expect(addonPlatform('linux', () => ({ header: { glibcVersionRuntime: '2.36' } }))).toBe('linux');
    });

    test('a musl process loads the linuxmusl addon', () => {
        expect(addonPlatform('linux', () => ({ header: {} }))).toBe('linuxmusl');
    });

    test('a process that cannot report keeps the glibc addon', () => {
        expect(addonPlatform('linux', () => undefined)).toBe('linux');
    });

    test.each(['darwin', 'win32'])('%s needs no report', (platform) => {
        const readReport = vi.fn();

        expect(addonPlatform(platform, readReport)).toBe(platform);
        expect(readReport).not.toHaveBeenCalled();
    });

    test("reading the process report leaves the app's network setting as it was", () => {
        process.report.excludeNetwork = false;

        addonPlatform('linux');

        expect(process.report.excludeNetwork).toBe(false);
    });
});
