import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import upath from 'upath';

// The Rollup and webpack plugins on their own tools, through crossbind's integration api with the builds under it stood
// in for: a page that imports a header bundles the header's module, and the glue lands beside the page. A header the
// plugin left alone would stop either tool, which cannot parse C.
const holder = { config: {} };
const HEADER_MODULE = "export const one = () => 'one from the header';";
const PLUGINS = upath.normalize(fileURLToPath(new URL('../../../plugins', import.meta.url)));
function target(buildType) {
    return {
        platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType, runtimeEnv: 'browser', jsName: `${buildType}.js`, wasmName: `${buildType}.wasm`, dataTxtName: `${buildType}.data.txt`,
    };
}
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; }, targets: [] } }));
vi.mock('../src/utils/appBuild.js', () => ({ default: () => false }));
vi.mock('../src/utils/appSources.js', () => ({ default: vi.fn(() => []), isAppSource: () => false }));
vi.mock('../src/actions/target.js', () => ({
    getTargetParams: (params) => params,
    getFilteredBuildTargets: (params, { buildType }) => [target(buildType)],
}));
vi.mock('../src/actions/buildDependencies.js', () => ({ default: vi.fn(async () => {}) }));
vi.mock('../src/actions/createInterface.js', () => ({ default: vi.fn((header) => `${header}.i.cpp`) }));
vi.mock('../src/actions/createLib.js', () => ({ default: vi.fn(() => false) }));
vi.mock('../src/actions/buildWasm.js', () => ({ default: vi.fn(async () => {}) }));
vi.mock('../src/actions/isSourceNewer.js', () => ({ default: () => false }));
vi.mock('../src/actions/pageLicenses.js', () => ({ default: async () => null }));
vi.mock('../src/integration/getCrossbindScript.js', () => ({ default: () => HEADER_MODULE, getRustJsScript: vi.fn() }));
vi.mock('../src/integration/getDependFilePath.js', () => ({ default: () => undefined }));
vi.mock('crossbind', async () => ({
    integrationApi: (await import('../src/integration/api.js')).default,
    appSourceFiles: vi.fn(),
    createBridgeFile: vi.fn(),
    getCrossbindScript: vi.fn(),
    getData: vi.fn(),
    getFilteredBuildTargets: vi.fn(),
    getRustJsScript: vi.fn(),
    getTargetParams: vi.fn(),
    state: {},
}));

const { default: rollupCrossbindPlugin } = await import('../../../plugins/rollup/index.js');
const { default: CrossbindWebpackPlugin } = await import('../../../plugins/webpack/index.js');
const { default: buildDependencies } = await import('../src/actions/buildDependencies.js');
const { default: createBridgeFile } = await import('../src/actions/createInterface.js');
const { default: buildWasm } = await import('../src/actions/buildWasm.js');
let work;

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-bundler-runs-'))));
    fs.mkdirSync(`${work}/src`, { recursive: true });
    fs.mkdirSync(`${work}/build`, { recursive: true });
    fs.writeFileSync(`${work}/src/main.js`, "import { one } from './native.h';\nconsole.log(one());\n");
    fs.writeFileSync(`${work}/src/native.h`, 'int one();\n');
    fs.writeFileSync(`${work}/build/release.js`, 'glue release');
    fs.writeFileSync(`${work}/build/release.wasm`, 'wasm release');
    holder.config = {
        ext: { header: ['h'], module: ['i'], source: ['cpp'] },
        paths: {
            project: work, build: `${work}/build`, cache: `${work}/cache`, output: `${work}/build`, native: [], cli: '/cli',
        },
        allDependencies: [],
    };
    vi.clearAllMocks();
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

const read = (file) => fs.readFileSync(`${work}/${file}`, 'utf8');

describe('the plugins on their own tools', () => {
    test("plain Rollup bundles the header's module and emits the glue beside the page", async () => {
        const { rollup } = await import('rollup');
        const bundle = await rollup({ input: `${work}/src/main.js`, plugins: [rollupCrossbindPlugin()] });
        await bundle.write({ dir: `${work}/dist`, format: 'es' });
        await bundle.close();

        expect(read('dist/main.js')).toContain('one from the header');
        expect(read('dist/crossbind.js')).toBe('glue release');
        expect(read('dist/crossbind.wasm')).toBe('wasm release');
        expect(fs.existsSync(`${work}/dist/crossbind.data.txt`)).toBe(false);
        expect(createBridgeFile).toHaveBeenCalledWith(`${work}/src/native.h`, expect.objectContaining({ buildType: 'release' }));
        expect(buildWasm).toHaveBeenCalledTimes(1);
    });

    test("webpack bundles the header's module through the loader and copies the glue beside the page", async () => {
        const webpack = createRequire(`${PLUGINS}/webpack/package.json`)('webpack');
        const plugin = new CrossbindWebpackPlugin();
        const compiler = webpack({
            mode: 'production',
            context: work,
            entry: './src/main.js',
            output: { path: `${work}/dist`, filename: 'main.js' },
            module: { rules: [plugin.getRule()] },
            resolveLoader: { alias: { '@crossbind/plugin-webpack-loader': `${PLUGINS}/webpack-loader/index.js` } },
            plugins: [plugin],
            optimization: { minimize: false },
            infrastructureLogging: { level: 'error' },
        });
        const stats = await new Promise((resolve, reject) => {
            compiler.run((error, result) => (error ? reject(error) : resolve(result)));
        });
        await new Promise((resolve) => { compiler.close(resolve); });

        expect(stats.toJson({ all: false, errors: true }).errors).toEqual([]);
        expect(read('dist/main.js')).toContain('one from the header');
        expect(read('dist/crossbind.js')).toBe('glue release');
        expect(read('dist/crossbind.wasm')).toBe('wasm release');
        expect(buildDependencies).toHaveBeenCalledWith({ targetParams: expect.objectContaining({ buildType: ['release'] }) });
        expect(buildWasm).toHaveBeenCalledTimes(1);
    });
});
