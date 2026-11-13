import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { state, collectLicenseRows } = vi.hoisted(() => ({ state: { config: {}, targets: [] }, collectLicenseRows: vi.fn() }));
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/licenses.js', async (importOriginal) => ({ ...(await importOriginal()), default: collectLicenseRows }));

const { default: pageLicensesAsset } = await import('../src/actions/pageLicenses.js');

let root;

const write = (file, content) => {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
    return full;
};
const chunk = (...moduleIds) => ({ type: 'chunk', moduleIds });
const asset = (...originalFileNames) => ({ type: 'asset', originalFileNames });
const helper = () => {
    write('node_modules/crossbind/package.json', { name: 'crossbind', version: '9.9.9', license: 'MIT' });
    return write('node_modules/crossbind/src/licenses/index.js', 'export async function licenses() {}');
};
const listOf = async (bundle, options = {}) => JSON.parse((await pageLicensesAsset(bundle, { root, platform: 'wasm', ...options })).source);
const others = (list) => list.filter((entry) => entry.name !== 'crossbind');

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-page-licenses-'));
    state.config = { paths: { project: root } };
    write('package.json', { name: 'my-app', version: '1.0.0', private: true });
    collectLicenseRows.mockReset().mockResolvedValue([]);
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('pageLicensesAsset', () => {
    test('writes nothing for a page that does not read its licenses', async () => {
        const main = write('src/main.js', '');

        expect(await pageLicensesAsset({ 'index.js': chunk(main) }, { root, platform: 'wasm' })).toBeNull();
        expect(collectLicenseRows).not.toHaveBeenCalled();
    });

    test('lists what the module links and the app carries as crossbind-licenses.json, by the version of the code it holds', async () => {
        collectLicenseRows.mockResolvedValue([
            {
                name: 'libjpeg-turbo',
                version: '2.0.0-beta.72',
                nativeVersion: '3.2.1',
                license: 'IJG AND BSD-3-Clause AND Zlib',
                sourceUrl: 'https://example.org/libjpeg-turbo-3.2.1.tar.gz',
                licenseText: '=== LICENSE.md ===\n\nlibjpeg-turbo license',
            },
            { name: 'hermes', version: '250829098.0.17', nativeVersion: null, license: 'MIT', sourceUrl: null, licenseText: null },
        ]);

        const { fileName, source } = await pageLicensesAsset({ 'index.js': chunk(helper()) }, { root, platform: 'ios', runtimeEnv: 'app' });

        expect(fileName).toBe('crossbind-licenses.json');
        expect(collectLicenseRows).toHaveBeenCalledWith('ios', { runtimeEnv: 'app' });
        expect(others(JSON.parse(source))).toEqual([
            { name: 'hermes', version: '250829098.0.17', license: 'MIT', source: null, text: null },
            {
                name: 'libjpeg-turbo',
                version: '3.2.1',
                license: 'IJG AND BSD-3-Clause AND Zlib',
                source: 'https://example.org/libjpeg-turbo-3.2.1.tar.gz',
                text: '=== LICENSE.md ===\n\nlibjpeg-turbo license',
            },
        ]);
    });

    test('lists every npm package whose modules or files the bundle holds once, with the license texts it carries', async () => {
        const runtime = write('node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js', '');
        const shared = write('node_modules/@vue/runtime-dom/dist/shared.js', '');
        write('node_modules/@vue/runtime-dom/package.json', {
            name: '@vue/runtime-dom', version: '3.5.0', license: 'MIT', repository: { type: 'git', url: 'git+https://github.com/vuejs/core.git' },
        });
        write('node_modules/@vue/runtime-dom/LICENSE', 'MIT License of Vue');
        // A package's subfolder can hold a package.json that names no package.
        write('node_modules/@vue/runtime-dom/dist/package.json', { type: 'module' });
        write('node_modules/font-pkg/package.json', { name: 'font-pkg', version: '0.4.1', license: 'MIT AND OFL-1.1', homepage: 'https://example.org/font-pkg' });
        write('node_modules/font-pkg/LICENSE', 'MIT License of the package');
        write('node_modules/font-pkg/LICENSE_FONT', 'SIL Open Font License');
        write('node_modules/font-pkg/400Regular/Font_400Regular.ttf', '');

        const list = await listOf({
            'index.js': chunk(helper(), runtime, `${shared}?commonjs-proxy`),
            // A stylesheet's url() brings the font as an asset, which no module of the bundle holds.
            'assets/Font_400Regular.ttf': asset('node_modules/font-pkg/400Regular/Font_400Regular.ttf'),
        });

        expect(others(list)).toEqual([
            { name: '@vue/runtime-dom', version: '3.5.0', license: 'MIT', source: 'https://github.com/vuejs/core', text: '=== LICENSE ===\n\nMIT License of Vue' },
            {
                name: 'font-pkg',
                version: '0.4.1',
                license: 'MIT AND OFL-1.1',
                source: 'https://example.org/font-pkg',
                text: '=== LICENSE ===\n\nMIT License of the package\n\n=== LICENSE_FONT ===\n\nSIL Open Font License',
            },
        ]);
    });

    test("leaves out the project's own code, private packages and modules no file holds", async () => {
        write('package.json', { name: 'my-lib', version: '1.0.0', license: 'MIT' });
        const main = write('src/main.js', '');
        write('packages/ui/package.json', { name: '@my/ui', private: true });
        const button = write('packages/ui/button.js', '');

        const list = await listOf({ 'index.js': chunk(helper(), main, button, '\0vite/preload-helper.js', 'virtual:pwa-register') });

        expect(list.map((entry) => entry.name)).toEqual(['crossbind']);
    });

    test('lists a component the module links and the bundle holds once', async () => {
        collectLicenseRows.mockResolvedValue([{
            name: 'crossbind', version: '9.9.9', nativeVersion: null, license: 'MIT', sourceUrl: 'https://github.com/crossbind/crossbind', licenseText: 'crossbind license',
        }]);

        const list = await listOf({ 'index.js': chunk(helper()) });

        expect(list).toEqual([{ name: 'crossbind', version: '9.9.9', license: 'MIT', source: 'https://github.com/crossbind/crossbind', text: 'crossbind license' }]);
    });

    test('names a package.json that holds no JSON', async () => {
        write('node_modules/broken/package.json', '{ name: ');
        const broken = write('node_modules/broken/index.js', '');

        await expect(pageLicensesAsset({ 'index.js': chunk(helper(), broken) }, { root, platform: 'wasm' }))
            .rejects.toThrow(/node_modules[\\/]broken[\\/]package\.json/);
    });
});
