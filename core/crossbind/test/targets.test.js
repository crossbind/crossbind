import { describe, test, expect } from 'vitest';
import {
    TARGETS, OPT_IN_PLATFORMS, RUNTIME_ENVS, runtimeEnvsOf, selectRuntimeEnvs, targetPathOf, filterTargetSpecs, nodeAddonNamesOf,
} from '../src/utils/targets.js';

describe('TARGETS', () => {
    test('covers every supported platform', () => {
        expect([...new Set(TARGETS.map((t) => t.platform))].sort()).toEqual(['android', 'darwin', 'ios', 'linux', 'linuxmusl', 'wasi', 'wasm', 'win32']);
    });

    test.each(['darwin', 'linux', 'linuxmusl', 'win32'])('%s builds Node-API addons for x64 and arm64', (platform) => {
        const desktop = TARGETS.filter((t) => t.platform === platform);
        expect(desktop.map((t) => `${t.arch}-${t.buildType}`).sort()).toEqual(['arm64-debug', 'arm64-release', 'x64-debug', 'x64-release']);
        for (const target of desktop) {
            expect(target.runtime).toBe('mt');
            expect(target.runtimeEnv).toBe('node');
        }
    });

    test('Node-API addon platforms build only when named, so a plain build keeps its output', () => {
        const platforms = new Set(TARGETS.map((t) => t.platform));
        expect(OPT_IN_PLATFORMS).toEqual(['darwin', 'linux', 'linuxmusl', 'win32']);
        for (const platform of OPT_IN_PLATFORMS) {
            expect(platforms.has(platform)).toBe(true);
        }
    });

    test('every entry carries the four fields the target path is built from', () => {
        for (const target of TARGETS) {
            expect(target.platform).toBeTruthy();
            expect(target.arch).toBeTruthy();
            expect(target.runtime).toBeTruthy();
            expect(target.buildType).toBeTruthy();
        }
    });

    test('target paths are unique per runtime environment', () => {
        const keys = TARGETS.map((t) => `${targetPathOf(t)}-${t.runtimeEnv ?? ''}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    test('wasi builds single-threaded wasm32 only', () => {
        const wasi = TARGETS.filter((t) => t.platform === 'wasi');
        expect(wasi.length).toBeGreaterThan(0);
        for (const target of wasi) {
            expect(target.arch).toBe('wasm32');
            expect(target.runtime).toBe('st');
        }
    });

    // The runtime environment names the binary a build makes, so a wasi command needs one too.
    test('a wasi command is asked for with the wasi runtime environment', () => {
        for (const target of TARGETS.filter((t) => t.platform === 'wasi')) {
            expect(target.runtimeEnv).toBe('wasi');
        }
    });
});

describe('runtime environments', () => {
    test('RUNTIME_ENVS lists every binary a build can make', () => {
        expect([...RUNTIME_ENVS].sort()).toEqual(['browser', 'edge', 'node', 'wasi']);
    });

    test('selectRuntimeEnvs takes -e first, then target.runtimeEnv, then nothing', () => {
        expect(selectRuntimeEnvs(['node', 'wasi'], 'browser')).toEqual(['node', 'wasi']);
        expect(selectRuntimeEnvs(undefined, 'edge')).toEqual(['edge']);
        expect(selectRuntimeEnvs(undefined, undefined)).toEqual([]);
    });

    test('runtimeEnvsOf lists the binaries of one platform', () => {
        expect(runtimeEnvsOf('wasm').sort()).toEqual(['browser', 'edge', 'node']);
        expect(runtimeEnvsOf('wasi')).toEqual(['wasi']);
        expect(runtimeEnvsOf('linux')).toEqual(['node']);
        expect(runtimeEnvsOf('android')).toEqual([]);
    });
});

describe('targetPathOf', () => {
    test('joins platform, arch, runtime and build type', () => {
        expect(targetPathOf({
            platform: 'wasi', arch: 'wasm32', runtime: 'st', buildType: 'release',
        })).toBe('wasi-wasm32-st-release');
    });
});

describe('nodeAddonNamesOf', () => {
    const darwin = (arch, buildType) => TARGETS.find((t) => (
        t.platform === 'darwin' && t.arch === arch && t.buildType === buildType));

    test('names one binary per platform and arch next to one loader per build type', () => {
        expect(nodeAddonNamesOf(darwin('arm64', 'release'), 'matrix')).toEqual({
            addonPattern: 'matrix.{platform}-{arch}.node',
            addonName: 'matrix.darwin-arm64.node',
            jsName: 'matrix.native.cjs',
        });
    });

    test('keeps debug output apart from release output', () => {
        expect(nodeAddonNamesOf(darwin('x64', 'debug'), 'matrix')).toEqual({
            addonPattern: 'matrix.{platform}-{arch}.debug.node',
            addonName: 'matrix.darwin-x64.debug.node',
            jsName: 'matrix.native.debug.cjs',
        });
    });
});

describe('filterTargetSpecs', () => {
    const target = {
        platform: 'wasm', arch: 'wasm32', runtime: 'mt', buildType: 'release', runtimeEnv: 'browser',
    };

    test('keeps specs whose declared fields all match', () => {
        const specs = filterTargetSpecs([
            { platform: 'wasm', specs: 'a' },
            { platform: 'wasm', runtime: 'mt', specs: 'b' },
            { runtimeEnv: 'browser', specs: 'c' },
        ], target);
        expect(specs).toEqual(['a', 'b', 'c']);
    });

    test('drops specs that disagree on any declared field', () => {
        const specs = filterTargetSpecs([
            { platform: 'wasi', specs: 'a' },
            { runtime: 'st', specs: 'b' },
            { runtimeEnv: 'node', specs: 'c' },
            { buildType: 'debug', specs: 'd' },
            { arch: 'wasm64', specs: 'e' },
        ], target);
        expect(specs).toEqual([]);
    });

    test('an undeclared field matches everything, and entries without specs are dropped', () => {
        expect(filterTargetSpecs([{ specs: 'always' }, { platform: 'wasm' }], target)).toEqual(['always']);
    });

    test('returns an empty list when nothing is declared', () => {
        expect(filterTargetSpecs(undefined, target)).toEqual([]);
        expect(filterTargetSpecs([], target)).toEqual([]);
    });
});
