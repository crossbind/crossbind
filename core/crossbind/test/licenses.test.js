import { beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateSpdx } from '../src/utils/licenseReport.js';

const { state } = vi.hoisted(() => ({ state: { config: {}, targets: [] } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { default: collectLicenseRows } = await import('../src/actions/licenses.js');
const { newUpdaterKey } = await import('../../../extensions/updater/src/update.js');

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
        packageSources: [{ name: 'conan' }],
        packages: { conan: { zlib: { version: '1.3.2', options: {} } } },
        allDependencies: [{
            general: {
                name: 'conan_zlib',
                packageSource: {
                    name: 'conan',
                    package: {
                        name: 'zlib',
                        version: '1.3.2',
                        ref: 'zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb',
                        license: 'Zlib',
                        homepage: 'https://zlib.net',
                        source: { url: 'https://zlib.net/fossils/zlib-1.3.2.tar.gz', sha256: 'b'.repeat(64) },
                    },
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
        expect(row.licenseNotes).toBe('built from the conan package zlib/1.3.2#1cb806da49011867778ffb6ac7190fcb');
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

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten', 'llvm-runtimes', 'zlib']);
        expect(fs.existsSync(marker)).toBe(false);
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('a declared Conan package that is not staged stops the listing instead of going missing from it', async () => {
        state.config = { packageSources: [{ name: 'conan' }], packages: { conan: { zlib: { version: '1.3.2', options: {} } } }, allDependencies: [] };

        await expect(collectLicenseRows()).rejects.toThrow(/the conan packages zlib are not installed for the current packages\.conan[\s\S]*Build the project first/);
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

    test('lists a dependency that is no port by its package, with the license it ships, but not the app or a private package', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-library-license-'));
        fs.writeFileSync(path.join(project, 'LICENSE'), 'matrix license text');
        state.config = {
            general: { name: 'app' },
            package: { name: 'app', license: 'UNLICENSED' },
            paths: { project: os.tmpdir() },
            allDependencies: [{
                general: { name: 'crossbind-example-lib-prebuilt-matrix' },
                paths: { project },
                package: { name: '@crossbind/example-lib-prebuilt-matrix', version: '1.0.0', license: 'MIT' },
            }, {
                general: { name: 'confrust' },
                paths: { project },
                package: { name: '@crossbind/conformance-rust', private: true },
            }],
        };

        const rows = await collectLicenseRows();

        expect(rows.map((row) => row.name)).toEqual(['crossbind-example-lib-prebuilt-matrix']);
        expect(rows[0]).toMatchObject({ npmName: '@crossbind/example-lib-prebuilt-matrix', license: 'MIT' });
        expect(rows[0].licenseText).toContain('matrix license text');
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

describe('collectLicenseRows for an app', () => {
    const APP = { id: 'com.example.demo' };

    beforeEach(() => {
        state.config = { allDependencies: [], app: APP, paths: { base: os.tmpdir() } };
    });

    test("lists crossbind's runtime and what the host carries, each upstream piece with its pin and its text", async () => {
        const rows = await collectLicenseRows(null, { runtimeEnv: 'app' });

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten-embind', 'hermes', 'jsi', 'webview']);
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
        for (const name of ['hermes', 'jsi', 'webview']) {
            expect(byName[name].license).toBe('MIT');
            expect(byName[name].nativeVersion).toBeTruthy();
            expect(byName[name].sha256).toMatch(/^[0-9a-f]{64}$/);
        }
        expect(byName.hermes.licenseText).toContain('Meta Platforms');
        expect(byName.webview.licenseText).toContain('Serge Zaitsev');
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
    });

    test('names, for a Linux app, the Hermes source it builds and the libc++ it links', async () => {
        const rows = await collectLicenseRows('linux', { runtimeEnv: 'app' });
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        expect(byName.hermes.sourceUrl).toMatch(/^https:\/\/github\.com\/facebook\/hermes\/archive\/refs\/tags\/hermes-v.+\.tar\.gz$/);
        expect(byName.hermes.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(byName['llvm-runtimes'].license).toBe('Apache-2.0 WITH LLVM-exception');
    });

    test('names, for a Windows app, the Hermes source it builds, the WebView2 SDK it compiles against, the runtimes it links and the NSIS its setup program carries', async () => {
        const rows = await collectLicenseRows('win32', { runtimeEnv: 'app' });
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        expect(rows.map((row) => row.name)).toEqual([
            'crossbind', 'emscripten-embind', 'hermes', 'jsi', 'llvm-runtimes', 'mingw-w64-runtime', 'nsis', 'webview', 'webview2-sdk',
        ]);
        expect(byName.nsis.license).toBe('Zlib AND MIT');
        expect(byName.nsis.licenseText).toContain('ZLIB/LIBPNG LICENSE');
        expect(byName.nsis.licenseText).toContain('Copyright (c) 2008 Thomas Gaugler');
        expect(byName.hermes.sourceUrl).toMatch(/^https:\/\/github\.com\/facebook\/hermes\/archive\/refs\/tags\/hermes-v.+\.tar\.gz$/);
        expect(byName['webview2-sdk'].license).toBe('BSD-3-Clause');
        expect(byName['webview2-sdk'].sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(byName['webview2-sdk'].licenseText).toContain('Copyright (C) Microsoft Corporation');
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
    });

    test('names Monocypher for a desktop app that checks its updates with it, and for no other', async () => {
        const updater = { url: 'https://example.com/u.json', publicKey: newUpdaterKey().publicKey };
        state.config = { allDependencies: [], app: { ...APP, updater }, paths: { base: os.tmpdir() }, package: { version: '1.0.0' }, general: { name: 'demo' } };

        const rows = await collectLicenseRows('darwin', { runtimeEnv: 'app' });
        const monocypher = rows.find((row) => row.name === 'monocypher');

        expect(monocypher.license).toBe('BSD-2-Clause OR CC0-1.0');
        expect(validateSpdx(monocypher.license).isValid).toBe(true);
        expect(monocypher.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(monocypher.licenseText).toContain('Copyright (c) 2017-2023, Loup Vaillant');
        expect((await collectLicenseRows('ios', { runtimeEnv: 'app' })).map((row) => row.name)).not.toContain('monocypher');
        expect((await collectLicenseRows(null, { runtimeEnv: 'app' })).map((row) => row.name)).toContain('monocypher');
        state.config = { allDependencies: [], app: APP, paths: { base: os.tmpdir() } };
        expect((await collectLicenseRows('linux', { runtimeEnv: 'app' })).map((row) => row.name)).not.toContain('monocypher');
    });

    test("names crossbind's own extensions the app has on its platform, each package with its text, and none another takes the place of", async () => {
        const base = path.join(import.meta.dirname, '..', '..', '..');
        state.config = { allDependencies: [], app: APP, paths: { base } };

        const names = async (platform) => (await collectLicenseRows(platform, { runtimeEnv: 'app' })).map((row) => row.name);
        const linux = await collectLicenseRows('linux', { runtimeEnv: 'app' });

        expect(linux.find((row) => row.name === '@crossbind/extension-dialog')).toMatchObject({
            npmName: '@crossbind/extension-dialog', license: 'MIT', licenseText: expect.stringContaining('MIT License'), licenseNotes: expect.stringContaining('the app extension dialog'),
        });
        expect(await names('linux')).toContain('@crossbind/extension-power');
        expect(await names('linux')).not.toContain('@crossbind/extension-updater');
        expect(await names('ios')).not.toContain('@crossbind/extension-power');
        expect(await names('android')).toContain('@crossbind/extension-page-dialogs');
        // Without a platform, what any platform's app has, once.
        const everywhere = await names(null);
        expect(everywhere).toContain('@crossbind/extension-power');
        expect(everywhere.filter((name) => name === '@crossbind/extension-dialog')).toHaveLength(1);
        state.config.extensions = [{ name: 'acme-dialog', root: path.join(base, 'e2e'), replaces: ['dialog'], app: {} }];
        expect(await names('linux')).not.toContain('@crossbind/extension-dialog');
    });

    test("names each extension package the app builds in and the code of others each carries, but not an extension of the project's own", async () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extension-licenses-'));
        const root = path.join(base, 'node_modules', '@acme', 'extension-expr');
        fs.mkdirSync(path.join(root, 'third_party'), { recursive: true });
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
            name: '@acme/extension-expr', version: '2.1.0', license: 'MIT', homepage: 'https://acme.example/expr', crossbind: { extension: './crossbind.extension.js' },
        }));
        fs.writeFileSync(path.join(root, 'LICENSE'), 'MIT License\n\nCopyright (c) 2026 Acme');
        fs.writeFileSync(path.join(root, 'third_party', 'LICENSE'), 'zlib License\n\nCopyright (c) 2016 Lewis Van Winkle');
        fs.writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'my-app', version: '1.0.0', license: 'MIT' }));
        const own = path.join(base, 'extensions', 'probe');
        fs.mkdirSync(own, { recursive: true });
        const tinyexpr = { name: 'tinyexpr', version: '1.0.0', license: 'Zlib', file: 'third_party/LICENSE', source: 'https://github.com/codeplea/tinyexpr' };
        state.config = {
            allDependencies: [],
            app: APP,
            paths: { base },
            extensions: [{ name: 'expr', root, app: { sources: ['expr.cpp'], licenses: [tinyexpr] } }, { name: 'probe', root: own, app: { sources: ['probe.cpp'] } }],
        };

        const rows = await collectLicenseRows('linux', { runtimeEnv: 'app' });
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        expect(byName['@acme/extension-expr']).toMatchObject({
            version: '2.1.0', license: 'MIT', sourceUrl: 'https://acme.example/expr', licenseText: expect.stringContaining('Copyright (c) 2026 Acme'),
        });
        expect(byName.tinyexpr).toMatchObject({
            npmName: null,
            version: null,
            nativeVersion: '1.0.0',
            license: 'Zlib',
            sourceUrl: 'https://github.com/codeplea/tinyexpr',
            licenseNotes: expect.stringContaining('@acme/extension-expr'),
            licenseText: expect.stringContaining('Lewis Van Winkle'),
        });
        expect(rows.map((row) => row.name)).not.toContain('probe');
        expect(rows.map((row) => row.name)).not.toContain('my-app');
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('lists a library once for each version the app ships, whichever extensions carry it, and no private extension package', async () => {
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-extension-licenses-'));
        state.config = { allDependencies: [], app: APP, paths: { base }, extensions: [] };
        const { nativeVersion: webview } = (await collectLicenseRows('linux', { runtimeEnv: 'app' })).find((row) => row.name === 'webview');
        const extensionAt = (name, manifest, licenses) => {
            const root = path.join(base, 'packages', name);
            fs.mkdirSync(root, { recursive: true });
            fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ ...manifest, crossbind: { extension: './crossbind.extension.js' } }));
            fs.writeFileSync(path.join(root, 'LICENSE'), `zlib License\n\nCopyright (c) 2026 ${name}`);
            return { name, root, app: { sources: [`${name}.cpp`], licenses: licenses.map(([library, version]) => ({ name: library, version, license: 'Zlib', file: 'LICENSE' })) } };
        };
        state.config.extensions = [
            extensionAt('first', { name: '@acme/first', version: '1.0.0', license: 'MIT', private: true }, [['zlib', '1.3.1'], ['tinyexpr', '1.0.0']]),
            extensionAt('second', { name: '@acme/second', version: '2.0.0', license: 'MIT' }, [['zlib', '1.2.13'], ['tinyexpr', '1.0.0'], ['webview', webview]]),
        ];

        const rows = await collectLicenseRows('linux', { runtimeEnv: 'app' });
        const named = (name) => rows.filter((row) => row.name === name);

        expect(named('zlib').map((row) => row.nativeVersion)).toEqual(expect.arrayContaining(['1.3.1', '1.2.13']));
        expect(named('zlib')).toHaveLength(2);
        expect(named('tinyexpr')).toHaveLength(1);
        expect(named('tinyexpr')[0].licenseNotes).toContain('first of @acme/first');
        expect(named('webview')).toHaveLength(1);
        expect(named('webview')[0].npmName).toBe('@crossbind/core-app-host');
        expect(named('@acme/first')).toHaveLength(0);
        expect(named('@acme/second')).toHaveLength(1);
        fs.rmSync(base, { recursive: true, force: true });
    });

    test('leaves webview/webview out of an iOS app, whose window UIKit makes', async () => {
        const rows = await collectLicenseRows('ios', { runtimeEnv: 'app' });

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten-embind', 'hermes', 'jsi']);
    });

    test("names, for an Android app, Hermes' AAR, what its Gradle build adds, and the NDK's libc++ it carries", async () => {
        const rows = await collectLicenseRows('android', { runtimeEnv: 'app' });
        const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

        expect(rows.map((row) => row.name)).toEqual(['androidx-webkit', 'crossbind', 'emscripten-embind', 'fbjni', 'hermes', 'jsi', 'llvm-runtimes']);
        expect(byName.hermes.sourceUrl).toMatch(/\/hermes-android-.+-release\.aar$/);
        expect(byName.hermes.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(byName.fbjni.license).toBe('Apache-2.0');
        expect(byName['androidx-webkit'].version).toMatch(/^\d+\.\d+\.\d+$/);
        expect(byName['llvm-runtimes'].licenseNotes).toContain('libc++_shared.so');
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
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

describe('collectLicenseRows across variants and for a published module', () => {
    beforeEach(() => {
        state.config = { allDependencies: [] };
        state.targets = [];
    });

    const variant = (platform, project) => ({
        general: { name: 'demo', alias: { package: '@crossbind/port-demo' } },
        paths: { project },
        package: { name: `@crossbind/port-demo-${platform}`, version: '1.0.0', license: 'MIT' },
        functions: { isEnabled: (target) => target.platform === platform },
    });

    test('names the package of the platform it reports, whichever variant comes first', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-variant-license-'));
        state.config = { allDependencies: [variant('darwin', project), variant('linux', project)] };
        state.targets = [{ platform: 'linux', path: 'linux-x64-mt-release' }];

        const [row] = (await collectLicenseRows('linux')).filter((entry) => entry.name === 'demo');

        expect(row.npmName).toBe('@crossbind/port-demo-linux');
        fs.rmSync(project, { recursive: true, force: true });
    });

    test("lists what a wasm module links and its glue bundles: Emscripten's libraries, LLVM's C++ runtime and crossbind's runtime", async () => {
        const rows = await collectLicenseRows('wasm');

        expect(rows.map((row) => row.name)).toEqual(['crossbind', 'emscripten', 'llvm-runtimes']);
        expect(rows.map((row) => row.license)).toEqual(['MIT', 'MIT OR NCSA', 'Apache-2.0 WITH LLVM-exception']);
        expect(rows[0]).toMatchObject({ isRuntime: true, licenseText: expect.stringContaining('MIT License') });
        rows.forEach((row) => expect(validateSpdx(row.license).isValid).toBe(true));
    });

    test("gives the project's own row the license of the package its alias names, not the expression it publishes", async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-own-license-'));
        const core = path.join(project, 'node_modules', 'demo-core');
        fs.mkdirSync(core, { recursive: true });
        fs.writeFileSync(path.join(core, 'package.json'), JSON.stringify({ name: 'demo-core', license: 'MIT' }));
        fs.writeFileSync(path.join(core, 'LICENSE'), 'MIT License of the core');
        fs.writeFileSync(path.join(project, 'LICENSE'), 'license of the published module');
        state.config = {
            general: { name: 'demo', alias: { package: 'demo-core' } },
            paths: { project },
            package: { name: '@demo/standalone', version: '1.0.0', license: 'LGPL-2.1-only AND MIT' },
            allDependencies: [],
        };

        const [row] = await collectLicenseRows();

        expect(row).toMatchObject({ name: 'demo', license: 'MIT', isPort: false });
        expect(row.licenseText).toContain('MIT License of the core');
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('marks the libraries whose data the packages that ship the module carry', async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-data-license-'));
        state.config = {
            allDependencies: [{
                general: { name: 'proj' },
                paths: { project },
                package: { name: '@crossbind/port-proj-wasm', version: '1.0.0', license: 'MIT' },
                targetSpecs: [{ specs: { data: { 'share/proj': 'proj' } } }],
            }, {
                general: { name: 'geos' },
                paths: { project },
                package: { name: '@crossbind/port-geos-wasm', version: '1.0.0', license: 'LGPL-2.1-only' },
                targetSpecs: [{ specs: { env: { A: '1' } } }],
            }],
        };

        const rows = await collectLicenseRows();

        expect(Object.fromEntries(rows.map((row) => [row.name, row.shipsData]))).toEqual({ geos: false, proj: true });
        fs.rmSync(project, { recursive: true, force: true });
    });
});

describe('collectLicenseRows upstream identity', () => {
    beforeEach(() => {
        state.config = { allDependencies: [] };
        state.targets = [];
    });

    test("names a port by its upstream project, with the CPE its family declares, and a project's own code by its repository", async () => {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-identity-license-'));
        const familyDir = path.join(project, 'node_modules', '@crossbind', 'port-zlib');
        fs.mkdirSync(familyDir, { recursive: true });
        fs.writeFileSync(path.join(familyDir, 'package.json'), JSON.stringify({
            name: '@crossbind/port-zlib',
            crossbind: { upstream: { name: 'zlib', cpe: 'zlib:zlib', license: { declared: 'Zlib', selected: null, files: ['LICENSE'] } } },
        }));
        fs.writeFileSync(path.join(project, 'LICENSE'), 'zlib license text');
        const library = path.join(project, 'library');
        fs.mkdirSync(library);
        fs.writeFileSync(path.join(library, 'LICENSE'), 'MIT License of the library');
        state.config = {
            allDependencies: [{
                general: { name: 'z', alias: { package: '@crossbind/port-zlib' } },
                paths: { project },
                package: { name: '@crossbind/port-zlib-wasm', version: '2.0.0', nativeVersion: '1.4' },
            }, {
                general: { name: 'demo-lib' },
                paths: { project: library },
                package: { name: 'demo-lib', version: '1.2.0', license: 'MIT', homepage: 'https://demo.example', repository: 'git+https://github.com/demo/lib.git' },
            }],
        };

        const rows = Object.fromEntries((await collectLicenseRows()).map((row) => [row.name, row]));

        expect(rows.zlib).toMatchObject({ cpe: 'cpe:2.3:a:zlib:zlib:1.4:*:*:*:*:*:*:*', nativeVersion: '1.4' });
        expect(rows['demo-lib'].sourceUrl).toBe('https://github.com/demo/lib');
        fs.rmSync(project, { recursive: true, force: true });
    });
});
