import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import loadConfig, { getFilledConfig, assertBinarySelection } from '../src/state/loadConfig.js';

describe('excludedDependencies', () => {
    let tmpDir;

    const project = (name) => {
        const dir = path.join(tmpDir, name);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    };

    const depNames = (cfg) => cfg.allDependencies.map((d) => d.general.name).sort();

    // app → geotiff → [z, jpeg, tiff]; each node gets a distinct project dir
    // because allDependencies dedupes by paths.project.
    const appTree = () => ({
        general: { name: 'app' },
        paths: { project: project('app') },
        dependencies: [
            {
                general: { name: 'geotiff' },
                paths: { project: project('geotiff') },
                dependencies: [
                    { general: { name: 'z' }, paths: { project: project('z') } },
                    { general: { name: 'jpeg' }, paths: { project: project('jpeg') } },
                    { general: { name: 'tiff' }, paths: { project: project('tiff') } },
                ],
            },
        ],
    });

    const fill = (config, exclude = []) => getFilledConfig(
        config,
        { isDepend: false, exclude, seen: new Set() },
    );

    beforeEach(() => {
        tmpDir = path.join(os.tmpdir(), `crossbind-exclude-${process.pid}-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('keeps every dependency when no exclude is given', () => {
        expect(depNames(fill(appTree()))).toEqual(['geotiff', 'jpeg', 'tiff', 'z']);
    });

    test('prunes a transitive dependency by general.name, keeping siblings and parent', () => {
        const cfg = fill(appTree(), ['z']);
        expect(depNames(cfg)).toEqual(['geotiff', 'jpeg', 'tiff']);
        expect(depNames(cfg)).not.toContain('z');
    });

    test('removes the excluded node from the nested tree, not just allDependencies', () => {
        const cfg = fill(appTree(), ['z']);
        const geotiff = cfg.dependencies.find((d) => d.general.name === 'geotiff');
        expect(geotiff.dependencies.map((d) => d.general.name).sort()).toEqual(['jpeg', 'tiff']);
    });

    test('excluding a parent drops its whole subtree', () => {
        const cfg = fill(appTree(), ['geotiff']);
        expect(depNames(cfg)).toEqual([]);
    });

    test('records every dependency name in seen for unmatched-exclude detection', () => {
        const seen = new Set();
        getFilledConfig(appTree(), { isDepend: false, exclude: [], seen });
        expect([...seen].sort()).toEqual(['geotiff', 'jpeg', 'tiff', 'z']);
    });

    test('matches by npm package name as an alias for general.name', () => {
        const zDir = project('z');
        fs.writeFileSync(
            path.join(zDir, 'package.json'),
            JSON.stringify({ name: '@crossbind/port-zlib-wasm' }),
        );
        const config = {
            general: { name: 'app' },
            paths: { project: project('app') },
            dependencies: [
                { general: { name: 'z' }, paths: { project: zDir } },
                { general: { name: 'jpeg' }, paths: { project: project('jpeg') } },
            ],
        };
        expect(depNames(fill(config, ['@crossbind/port-zlib-wasm']))).toEqual(['jpeg']);
    });

    test('matches by general.alias.package, the same handle imports use', () => {
        const config = {
            general: { name: 'app' },
            paths: { project: project('app') },
            dependencies: [
                {
                    general: { name: 'z', alias: { package: '@myorg/zlib' } },
                    paths: { project: project('z') },
                },
                { general: { name: 'jpeg' }, paths: { project: project('jpeg') } },
            ],
        };
        expect(depNames(fill(config, ['@myorg/zlib']))).toEqual(['jpeg']);
    });

    test('loadConfig prunes via crossbind.overrides (exclude)', async () => {
        const appDir = project('app');
        const zDir = project('z');
        const jpegDir = project('jpeg');
        fs.writeFileSync(path.join(appDir, 'crossbind.config.mjs'), `export default {
  general: { name: 'app' },
  paths: { project: ${JSON.stringify(appDir)} },
  dependencies: [
    { general: { name: 'z' }, paths: { project: ${JSON.stringify(zDir)} } },
    { general: { name: 'jpeg' }, paths: { project: ${JSON.stringify(jpegDir)} } },
  ],
};
`);
        fs.writeFileSync(path.join(appDir, 'crossbind.overrides.mjs'), 'export default { z: { exclude: true } };\n');
        const cfg = await loadConfig(appDir);
        expect(depNames(cfg)).toEqual(['jpeg']);
        expect(cfg.excludedDependencies).toEqual(['z']);
    });
});

describe('dependency replacement', () => {
    const fill = (config, replaces) => getFilledConfig(
        config,
        { isDepend: false, exclude: [], seen: new Set(), replaces },
    );

    test('replaces a dependency, keeping old identity and taking new implementation', () => {
        const app = {
            general: { name: 'app' },
            paths: { project: '/app' },
            dependencies: [{
                general: { name: 'gdal', alias: { package: '@crossbind/port-gdal' } },
                paths: { project: '/old/gdal' },
                export: { libName: ['gdal'] },
            }],
        };
        const replaces = {
            '@crossbind/port-gdal': {
                replace: {
                    general: { name: 'aaagdal' },
                    paths: { project: '/new/aaagdal' },
                    export: { libName: ['aaagdal'] },
                },
            },
        };

        const dep = fill(app, replaces).allDependencies[0];
        expect(dep.general.name).toBe('gdal');
        expect(dep.general.alias.package).toBe('@crossbind/port-gdal');
        expect(dep.export.libName).toEqual(['gdal']);
        expect(dep.paths.project).toBe(upath.resolve('/new/aaagdal'));
    });

    test('leaves a dependency untouched when no replace entry matches', () => {
        const app = {
            general: { name: 'app' },
            paths: { project: '/app' },
            dependencies: [{ general: { name: 'gdal' }, paths: { project: '/old/gdal' } }],
        };
        const dep = fill(app, { proj: { replace: {} } }).allDependencies[0];
        expect(dep.paths.project).toBe(upath.resolve('/old/gdal'));
    });
});

describe('raw config isolation', () => {
    const fill = (config) => getFilledConfig(
        config,
        { isDepend: false, exclude: [], seen: new Set() },
    );

    // Raw crossbind.config modules are import singletons: mutating a filled node (e.g. the
    // rebuild-marker consumption setting paths.project) must never leak into the raw
    // config, or the next loadConfig in the same process refills from poisoned paths.
    test('mutating a filled dependency path does not poison the raw config', () => {
        const rawDep = { general: { name: 'z' }, paths: { project: '/pkg/zlib-wasm' } };
        const app = {
            general: { name: 'app' },
            paths: { project: '/app' },
            dependencies: [rawDep],
        };

        const first = fill(app).allDependencies[0];
        first.paths.project = '/app/.crossbind/deps/z';
        first.paths.output = '/app/.crossbind/deps/z/dist';

        expect(rawDep.paths.project).toBe('/pkg/zlib-wasm');
        expect(fill(app).allDependencies[0].paths.project).toBe(upath.resolve('/pkg/zlib-wasm'));
    });
});

describe('binary selection', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-binary-selection-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const writeConfig = (fields) => {
        const config = { general: { name: 'app' }, paths: { project: tmpDir }, ...fields };
        fs.writeFileSync(path.join(tmpDir, 'crossbind.config.mjs'), `export default ${JSON.stringify(config)};\n`);
    };

    // Published port packages still carry it, and dependency builds load their configs as well.
    test('loadConfig keeps loading a config that sets export.bundle', async () => {
        const depDir = path.join(tmpDir, 'dep');
        fs.mkdirSync(depDir);
        writeConfig({ dependencies: [{ general: { name: 'dep' }, paths: { project: depDir }, export: { bundle: false } }] });
        await expect(loadConfig(tmpDir)).resolves.toBeTruthy();
    });

    test('the project being built may not set export.bundle, which a build no longer reads', async () => {
        writeConfig({ export: { bundle: false } });
        const config = await loadConfig(tmpDir);
        expect(() => assertBinarySelection(config)).toThrow(/export\.bundle.*-e.*target\.runtimeEnv/);
    });

    test('accepts one known target.runtimeEnv, or none', () => {
        expect(() => assertBinarySelection({ export: {}, target: { runtimeEnv: 'node' } })).not.toThrow();
        expect(() => assertBinarySelection({ export: {}, target: { runtimeEnv: null } })).not.toThrow();
        expect(() => assertBinarySelection({ export: {}, target: {} })).not.toThrow();
    });

    test('rejects an unknown or list-valued target.runtimeEnv', () => {
        expect(() => assertBinarySelection({ export: {}, target: { runtimeEnv: ['node'] } }))
            .toThrow(/target\.runtimeEnv must be one of browser, edge, node/);
        expect(() => assertBinarySelection({ export: {}, target: { runtimeEnv: 'deno' } }))
            .toThrow(/target\.runtimeEnv must be one of/);
    });
});

describe('specs.cmake shape', () => {
    const fill = (specs) => getFilledConfig(
        { general: { name: 'app' }, paths: { project: '/app' }, targetSpecs: [{ platform: 'wasm', specs }] },
        { isDepend: false, exclude: [], seen: new Set() },
    );

    test('rejects an array of configure flags and points to getBuildParams', () => {
        expect(() => fill({ cmake: ['-DFOO=ON'] })).toThrow(/specs\.cmake.*compileOptions.*getBuildParams/);
    });

    test('accepts the compileOptions object', () => {
        expect(() => fill({ cmake: { compileOptions: ['-O3', '-DFOO=1'] } })).not.toThrow();
    });
});
