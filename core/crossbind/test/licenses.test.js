import { beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

    const stagedZlib = (project) => ({
        conanDependencies: { zlib: { version: '1.3.2', options: {} } },
        allDependencies: [{
            general: {
                name: 'conan_zlib',
                conan: {
                    name: 'zlib',
                    version: '1.3.2',
                    ref: 'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb',
                    license: 'Zlib',
                    homepage: 'https://zlib.net',
                    source: { url: 'https://zlib.net/fossils/zlib-1.3.2.tar.gz', sha256: 'b'.repeat(64) },
                },
            },
            paths: { project },
        }],
    });

    test('lists a Conan package with its recipe metadata and the license texts its package carries', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-license-'));
        fs.mkdirSync(path.join(project, 'licenses'));
        fs.writeFileSync(path.join(project, 'licenses', 'LICENSE'), 'zlib license text');
        fs.writeFileSync(path.join(project, 'licenses', 'COPYING'), 'copying text');
        state.config = stagedZlib(project);

        const [row] = await collectLicenseRows();

        expect(row).toMatchObject({
            name: 'zlib',
            nativeVersion: '1.3.2',
            license: 'Zlib',
            sha256: 'b'.repeat(64),
            sourceUrl: 'https://zlib.net/fossils/zlib-1.3.2.tar.gz',
            purl: 'pkg:conan/zlib@1.3.2',
            isCopyleft: false,
        });
        expect(row.licenseText).toContain('zlib license text');
        expect(row.licenseText.indexOf('=== COPYING ===')).toBeLessThan(row.licenseText.indexOf('=== LICENSE ==='));
        expect(row.licenseNotes).toContain('zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb');
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('runs nothing a Conan package folder holds when it lists what a platform links', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-conan-license-'));
        const marker = path.join(project, 'ran');
        fs.writeFileSync(path.join(project, 'crossbind.build.mjs'), [
            "import fs from 'node:fs';",
            `fs.writeFileSync(${JSON.stringify(marker)}, '');`,
            "export const bundled = { wasm: [{ name: 'planted', license: 'MIT' }] };",
        ].join('\n'));
        state.config = stagedZlib(project);

        const rows = await collectLicenseRows('wasm');

        expect(rows.map((row) => row.name)).toEqual(['zlib']);
        expect(fs.existsSync(marker)).toBe(false);
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('a declared Conan package that is not staged stops the listing instead of going missing from it', async () => {
        state.config = { conanDependencies: { zlib: { version: '1.3.2', options: {} } }, allDependencies: [] };

        await expect(collectLicenseRows()).rejects.toThrow(/zlib are not installed[\s\S]*Build the project first/);
    });
});
