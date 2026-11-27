import {
    afterEach, beforeEach, describe, expect, test, vi,
} from 'vitest';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import upath from 'upath';

// crossbind() on Rollup, webpack, esbuild and Rsbuild, which each pick crossbind's own integration for, on the integration
// api with the builds under it stood in for: a page that imports a header bundles the header's module, and the glue lands
// beside the page. A header the plugin left alone would stop any of them, which cannot parse C.
const holder = { config: {} };
const HEADER_MODULE = "export const one = () => 'one from the header';";
const EXTENSIONS = upath.normalize(fileURLToPath(new URL('../../../extensions', import.meta.url)));
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

const { default: crossbind } = await import('../src/index.js');
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

describe('crossbind() on the tools it speaks to', () => {
    test("plain Rollup bundles the header's module and emits the glue beside the page", async () => {
        const { rollup } = await import('rollup');
        const bundle = await rollup({ input: `${work}/src/main.js`, plugins: [crossbind()] });
        await bundle.write({ dir: `${work}/dist`, format: 'es' });
        await bundle.close();

        expect(read('dist/main.js')).toContain('one from the header');
        expect(read('dist/crossbind.js')).toBe('glue release');
        expect(read('dist/crossbind.wasm')).toBe('wasm release');
        expect(fs.existsSync(`${work}/dist/crossbind.data.txt`)).toBe(false);
        // Rollup names a module as the system spells its path, with backslashes on Windows.
        const [[header, target]] = createBridgeFile.mock.calls;
        expect(upath.normalize(header)).toBe(`${work}/src/native.h`);
        expect(target).toMatchObject({ buildType: 'release' });
        expect(buildWasm).toHaveBeenCalledTimes(1);
    });

    test("webpack bundles the header's module through the loader and copies the glue beside the page", async () => {
        const webpack = createRequire(`${EXTENSIONS}/webpack/package.json`)('webpack');
        const compiler = webpack({
            mode: 'production',
            context: work,
            entry: './src/main.js',
            output: { path: `${work}/dist`, filename: 'main.js' },
            plugins: [crossbind()],
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

    test("esbuild bundles the header's module and writes the glue beside the page", async () => {
        const esbuild = createRequire(`${EXTENSIONS}/esbuild/package.json`)('esbuild');
        const result = await esbuild.build({
            entryPoints: [`${work}/src/main.js`],
            bundle: true,
            format: 'esm',
            outdir: `${work}/dist`,
            plugins: [crossbind()],
            logLevel: 'silent',
        });

        expect(result.errors).toEqual([]);
        expect(read('dist/main.js')).toContain('one from the header');
        expect(read('dist/crossbind.js')).toBe('glue release');
        expect(read('dist/crossbind.wasm')).toBe('wasm release');
        expect(buildDependencies).toHaveBeenCalledWith({ targetParams: expect.objectContaining({ buildType: ['release'] }) });
        expect(buildWasm).toHaveBeenCalledTimes(1);
    });

    test("Rsbuild bundles the header's module through Rspack and copies the glue beside the page", async () => {
        const core = createRequire(`${EXTENSIONS}/rsbuild/package.json`).resolve('@rsbuild/core');
        const { createRsbuild } = await import(pathToFileURL(core).href);
        const rsbuild = await createRsbuild({
            cwd: work,
            rsbuildConfig: {
                logLevel: 'error',
                source: { entry: { main: './src/main.js' } },
                output: { distPath: { root: 'dist', js: '.' }, filenameHash: false, minify: false },
                tools: { htmlPlugin: false },
                plugins: [crossbind()],
            },
        });
        await rsbuild.build();

        expect(read('dist/main.js')).toContain('one from the header');
        expect(read('dist/crossbind.js')).toBe('glue release');
        expect(read('dist/crossbind.wasm')).toBe('wasm release');
        expect(buildDependencies).toHaveBeenCalledWith({ targetParams: expect.objectContaining({ buildType: ['release'] }) });
        expect(buildWasm).toHaveBeenCalledTimes(1);
    });
});
