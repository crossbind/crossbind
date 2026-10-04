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

    test('carries the mingw-w64 notices a Windows addon build copied out of its toolchain image', async () => {
        const build = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-toolchain-notices-'));
        fs.mkdirSync(path.join(build, 'toolchain-licenses', 'win32'), { recursive: true });
        fs.writeFileSync(path.join(build, 'toolchain-licenses', 'win32', 'COPYING.MinGW-w64-runtime.txt'), 'runtime notice');
        state.config = { allDependencies: [], paths: { build } };

        const mingw = (await collectLicenseRows('win32')).find((row) => row.name === 'mingw-w64-runtime');

        expect(mingw.licenseText).toContain('=== COPYING.MinGW-w64-runtime.txt ===');
        expect(mingw.licenseText).toContain('runtime notice');
        fs.rmSync(build, { recursive: true, force: true });
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

    test('reads the license a package ships when no upstream source was extracted', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-installed-license-'));
        const familyDir = path.join(project, 'node_modules', '@crossbind', 'port-demo');
        fs.mkdirSync(familyDir, { recursive: true });
        fs.writeFileSync(path.join(familyDir, 'package.json'), JSON.stringify({
            name: '@crossbind/port-demo',
            crossbind: { upstream: { license: { declared: 'MIT', selected: null, files: ['COPYING'] } } },
        }));
        fs.writeFileSync(path.join(project, 'LICENSE'), 'demo license text');
        state.config = {
            allDependencies: [{
                general: { name: 'demo', alias: { package: '@crossbind/port-demo' } },
                paths: { project },
                package: { name: '@crossbind/port-demo-linux', version: '1.0.0', nativeVersion: '1.0' },
            }],
        };

        const [row] = await collectLicenseRows();

        expect(row.license).toBe('MIT');
        expect(row.licenseText).toContain('demo license text');
        expect(row.licenseText).not.toContain('missing');
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('reads the license a package ships when the extracted source names no license file', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-unnamed-license-'));
        const familyDir = path.join(project, 'node_modules', '@crossbind', 'port-demo');
        fs.mkdirSync(path.join(familyDir, '.crossbind', 'build', 'source'), { recursive: true });
        fs.writeFileSync(path.join(familyDir, 'package.json'), JSON.stringify({
            name: '@crossbind/port-demo',
            crossbind: { upstream: { license: { declared: 'blessing', selected: null, files: [] } } },
        }));
        fs.writeFileSync(path.join(project, 'LICENSE'), 'blessing text');
        state.config = {
            allDependencies: [{
                general: { name: 'demo', alias: { package: '@crossbind/port-demo' } },
                paths: { project },
                package: { name: '@crossbind/port-demo-linux' },
            }],
        };

        const [row] = await collectLicenseRows();

        expect(row.licenseText).toContain('blessing text');
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('reads the texts of vendored copies from the dist of the package that shipped them', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-installed-bundled-'));
        const familyDir = path.join(root, 'node_modules', '@crossbind', 'port-demo');
        fs.mkdirSync(familyDir, { recursive: true });
        fs.writeFileSync(path.join(familyDir, 'package.json'), JSON.stringify({
            name: '@crossbind/port-demo',
            crossbind: { upstream: { license: { declared: 'MIT', selected: null, files: ['COPYING'] } } },
        }));
        const node = (platform) => {
            const project = path.join(root, platform);
            fs.mkdirSync(project, { recursive: true });
            fs.writeFileSync(path.join(project, 'LICENSE'), 'demo license text');
            fs.writeFileSync(path.join(project, 'crossbind.build.mjs'), "export default { bundled: { linux: [{ name: 'libpng', license: 'libpng-2.0', files: ['frmts/png/libpng/LICENSE'] }] } };");
            return { general: { name: 'demo', alias: { package: '@crossbind/port-demo' } }, paths: { project }, package: { name: `@crossbind/port-demo-${platform}` } };
        };
        const darwin = node('darwin');
        const linux = node('linux');
        fs.mkdirSync(path.join(linux.paths.project, 'dist', 'licenses', 'libpng', 'frmts', 'png', 'libpng'), { recursive: true });
        fs.writeFileSync(path.join(linux.paths.project, 'dist', 'licenses', 'libpng', 'frmts', 'png', 'libpng', 'LICENSE'), 'png license text');
        state.config = { allDependencies: [darwin, linux] };

        const rows = await collectLicenseRows('linux');

        expect(rows.find((row) => row.name === 'libpng').licenseText).toContain('png license text');
        fs.rmSync(root, { recursive: true, force: true });
    });
});

describe('collectLicenseRows for a Node-API addon', () => {
    beforeEach(() => {
        state.config = { allDependencies: [] };
    });

    test('lists the crossbind runtime, the embind it adapts from Emscripten and node-api-jsi, with their texts', async () => {
        const rows = await collectLicenseRows('darwin', { runtimeEnv: 'node' });

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten-embind', 'node-api-jsi']);
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
        expect(byName.crossbind.license).toBe('MIT');
        expect(byName['emscripten-embind'].license).toBe('MIT OR NCSA');
        expect(byName['node-api-jsi'].license).toBe('MIT');
        expect(byName.crossbind.licenseText).toContain('crossbind contributors');
        expect(byName['emscripten-embind'].licenseText).toContain('University of Illinois/NCSA Open Source License');
        expect(byName['node-api-jsi'].licenseText).toContain('Copyright (c) Microsoft Corporation.');
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
    });

    test('adds the runtime to the C++ runtime a Linux addon links statically', async () => {
        const rows = await collectLicenseRows('linux', { runtimeEnv: 'node' });

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten-embind', 'llvm-runtimes', 'node-api-jsi']);
    });

    test('lists only the JavaScript runtime for the loader, which carries no native code', async () => {
        const rows = await collectLicenseRows(null, { runtimeEnv: 'node' });

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten-embind']);
    });
});
