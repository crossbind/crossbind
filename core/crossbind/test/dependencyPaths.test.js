import { describe, test, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import state, { setAllDependecyPaths } from '../src/state/index.js';

// These strings become the -I / -L / -l flags and the --with-<lib>config arguments a build
// recipe passes to configure. A wrong shape here does not fail loudly: the compiler just cannot
// find the dependency it was told to link.
// Shaped like a filled config: getFilledConfig always defaults targetSpecs to [].
const dep = (name, { libName = [name], targetSpecs = [] } = {}) => ({
    general: { name },
    paths: { output: `/pkg/${name}/dist`, project: `/pkg/${name}` },
    export: { libName },
    targetSpecs,
});

const target = (over) => ({ platform: 'wasm', arch: 'wasm32', runtime: 'st', buildType: 'release', path: 'wasm-wasm32-st-release', ...over });

const originalTargets = state.targets;
const originalConfig = state.config;

const run = (targets, allDependencies) => {
    state.targets = targets;
    state.config = { allDependencies };
    setAllDependecyPaths();
    return state.config.allDependencyPaths;
};

afterEach(() => {
    state.targets = originalTargets;
    state.config = originalConfig;
});

describe('setAllDependecyPaths', () => {
    test('lays out the prebuilt tree the recipes expect', () => {
        const paths = run([target()], [dep('zlib', { libName: ['z'] })]);

        expect(paths['wasm-wasm32-st-release'].z).toEqual({
            root: '/pkg/zlib/dist/prebuilt/wasm-wasm32-st-release',
            header: '/pkg/zlib/dist/prebuilt/wasm-wasm32-st-release/include',
            libPath: '/pkg/zlib/dist/prebuilt/wasm-wasm32-st-release/lib',
            lib: '/pkg/zlib/dist/prebuilt/wasm-wasm32-st-release/lib/libz.a',
            bin: '/pkg/zlib/dist/prebuilt/wasm-wasm32-st-release/bin',
        });
    });

    // libpng is png16 on Windows; a configure build would take -lpng16 on every platform otherwise.
    test('leaves out a library a Conan package has no archive of for the target', () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-deppaths-'));
        fs.mkdirSync(path.join(output, 'prebuilt', 'darwin-arm64-mt-release', 'lib'), { recursive: true });
        fs.writeFileSync(path.join(output, 'prebuilt', 'darwin-arm64-mt-release', 'lib', 'libpng.a'), '');
        const libpng = { ...dep('conan_libpng', { libName: ['png', 'png16'] }), paths: { output, project: output } };
        libpng.general.conan = { name: 'libpng' };

        const darwin = target({
            platform: 'darwin', arch: 'arm64', runtime: 'mt', buildType: 'debug', path: 'darwin-arm64-mt-debug', releasePath: 'darwin-arm64-mt-release',
        });
        const paths = run([darwin], [libpng]);
        fs.rmSync(output, { recursive: true, force: true });

        expect(Object.keys(paths['darwin-arm64-mt-debug'])).toEqual(['cmake', 'png']);
    });

    test('points CMake at the package prebuilt root by dependency name', () => {
        const paths = run([target()], [dep('zlib', { libName: ['z'] })]);

        expect(paths['wasm-wasm32-st-release'].cmake.zlib).toBe('/pkg/zlib/dist/prebuilt');
    });

    test('gives every exported library of one package its own entry', () => {
        // geos ships geos + geos_c; a recipe links them by separate -l flags.
        const paths = run([target()], [dep('geos', { libName: ['geos', 'geos_c'] })]);

        expect(paths['wasm-wasm32-st-release'].geos.lib).toMatch(/libgeos\.a$/);
        expect(paths['wasm-wasm32-st-release'].geos_c.lib).toMatch(/libgeos_c\.a$/);
    });

    test('links android against the shared object unless the package asks for static', () => {
        const androidTarget = target({ platform: 'android', arch: 'arm64-v8a', runtime: 'mt', path: 'android-arm64-v8a-mt-release' });

        const shared = run([androidTarget], [dep('zlib', { libName: ['z'] })]);
        expect(shared['android-arm64-v8a-mt-release'].z.lib).toMatch(/libz\.so$/);

        const staticDep = dep('zlib', { libName: ['z'], targetSpecs: [{ platform: 'android', specs: { libType: 'static' } }] });
        const stat = run([androidTarget], [staticDep]);
        expect(stat['android-arm64-v8a-mt-release'].z.lib).toMatch(/libz\.a$/);
    });

    test('resolves ios to the matching xcframework slice', () => {
        const device = target({ platform: 'ios', arch: 'iphoneos', runtime: 'mt', path: 'ios-iphoneos-mt-release' });
        const simulator = target({ platform: 'ios', arch: 'iphonesimulator', runtime: 'mt', path: 'ios-iphonesimulator-mt-release' });

        const paths = run([device, simulator], [dep('zlib', { libName: ['z'] })]);

        expect(paths['ios-iphoneos-mt-release'].z.header).toBe('/pkg/zlib/z.xcframework/ios-arm64/Headers');
        expect(paths['ios-iphoneos-mt-release'].z.lib).toBe('/pkg/zlib/z.xcframework/ios-arm64/libz.a');
        expect(paths['ios-iphonesimulator-mt-release'].z.libPath).toBe('/pkg/zlib/z.xcframework/ios-arm64-simulator');
    });
});
