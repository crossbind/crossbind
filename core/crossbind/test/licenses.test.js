import { beforeEach, describe, expect, test, vi } from 'vitest';
import { validateSpdx } from '../src/utils/licenseReport.js';

const { state } = vi.hoisted(() => ({ state: { config: {} } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: collectLicenseRows } = await import('../src/actions/licenses.js');

describe('collectLicenseRows', () => {
    beforeEach(() => {
        state.config = { allDependencies: [] };
    });

    test('lists nothing beyond the package graph without a platform', async () => {
        expect(await collectLicenseRows()).toEqual([]);
    });

    test.each(['linux', 'linuxmusl'])('lists the C++ runtime a %s addon links statically', async (platform) => {
        const rows = await collectLicenseRows(platform);

        expect(rows.map((row) => row.name)).toEqual(['llvm-runtimes']);
        expect(rows[0].license).toBe('Apache-2.0 WITH LLVM-exception');
    });

    test('lists the mingw-w64 runtime a Windows addon links statically, with where its notices are', async () => {
        const rows = await collectLicenseRows('win32');

        expect(rows.map((row) => row.name)).toEqual(['llvm-runtimes', 'mingw-w64-runtime']);
        const mingw = rows[1];
        expect(validateSpdx(mingw.license).isValid).toBe(true);
        expect(mingw.isCopyleft).toBe(false);
        expect(mingw.licenseNotes).toContain('winpthreads');
        expect(mingw.licenseNotes).toContain('COPYING.MinGW-w64-runtime.txt');
    });

    test('lists no runtime for a macOS addon, which uses the C++ runtime of the system', async () => {
        expect(await collectLicenseRows('darwin')).toEqual([]);
    });
});
