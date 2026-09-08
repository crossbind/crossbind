import { describe, test, expect } from 'vitest';
import {
    mergeBuildOverride, getOverrideKey, resolveDependencyOverride,
    resolveDependencyReplace, restampIdentity, resolveExcludedNames,
} from '../src/utils/overrideDependency.js';

describe('resolveDependencyOverride', () => {
    const dep = () => ({
        general: { name: 'gdal', alias: { package: '@crossbind/port-gdal' } },
        package: { name: '@crossbind/port-gdal-wasm', nativeVersion: '3.13.0' },
    });

    test('matches by general.name and normalizes { rebuild: true } to an empty recipe', () => {
        expect(resolveDependencyOverride({ gdal: { rebuild: true } }, dep())).toEqual({ key: 'gdal', override: {} });
    });

    test('matches by package.name and returns the override object', () => {
        const r = resolveDependencyOverride({ '@crossbind/port-gdal-wasm': { nativeVersion: '3.12.0' } }, dep());
        expect(r).toEqual({ key: '@crossbind/port-gdal-wasm', override: { nativeVersion: '3.12.0' } });
    });

    test('matches by alias.package', () => {
        expect(resolveDependencyOverride({ '@crossbind/port-gdal': { rebuild: true } }, dep())?.key)
            .toBe('@crossbind/port-gdal');
    });

    test('returns null when no key matches the dependency', () => {
        expect(resolveDependencyOverride({ proj: { rebuild: true } }, dep())).toBeNull();
    });

    test('returns null for a bare boolean value (no longer a shorthand)', () => {
        expect(resolveDependencyOverride({ gdal: true }, dep())).toBeNull();
        expect(resolveDependencyOverride({ gdal: false }, dep())).toBeNull();
    });

    test('treats a replace-only entry as no build override', () => {
        expect(resolveDependencyOverride({ gdal: { replace: {} } }, dep())).toBeNull();
    });

    test('rebuilds the replacement when replace is paired with rebuild/recipe', () => {
        expect(resolveDependencyOverride({ gdal: { replace: {}, rebuild: true } }, dep()))
            .toEqual({ key: 'gdal', override: {} });
        expect(resolveDependencyOverride({ gdal: { replace: {}, nativeVersion: '3.12.0' } }, dep()))
            .toEqual({ key: 'gdal', override: { nativeVersion: '3.12.0' } });
    });

    test('treats an exclude entry as no build override', () => {
        expect(resolveDependencyOverride({ gdal: { exclude: true } }, dep())).toBeNull();
    });
});

describe('resolveDependencyReplace', () => {
    const dep = () => ({
        general: { name: 'gdal', alias: { package: '@crossbind/port-gdal' } },
        package: { name: '@crossbind/port-gdal-wasm' },
    });
    const replacement = { general: { name: 'aaagdal' }, paths: { project: '/new' } };

    test('returns the replacement config when an entry has `replace`', () => {
        expect(resolveDependencyReplace({ gdal: { replace: replacement } }, dep())).toBe(replacement);
    });

    test('matches by package.name and alias.package', () => {
        expect(resolveDependencyReplace({ '@crossbind/port-gdal-wasm': { replace: replacement } }, dep())).toBe(replacement);
        expect(resolveDependencyReplace({ '@crossbind/port-gdal': { replace: replacement } }, dep())).toBe(replacement);
    });

    test('returns null without `replace` or on no match', () => {
        expect(resolveDependencyReplace({ gdal: true }, dep())).toBeNull();
        expect(resolveDependencyReplace({ gdal: { nativeVersion: '1' } }, dep())).toBeNull();
        expect(resolveDependencyReplace({ proj: { replace: replacement } }, dep())).toBeNull();
    });
});

describe('restampIdentity', () => {
    const oldNode = () => ({
        general: { name: 'gdal', alias: { package: '@crossbind/port-gdal' } },
        package: { name: '@crossbind/port-gdal-wasm', nativeVersion: '3.13.0' },
        export: { type: 'cmake', libName: ['gdal'] },
        paths: { project: '/old', output: '/old/dist' },
    });
    const newNode = () => ({
        general: { name: 'aaagdal', alias: { package: 'aaa-gdal' } },
        package: { name: 'aaa-gdal', nativeVersion: '9.9.9' },
        export: { type: 'cmake', libName: ['aaagdal'], bundle: false },
        paths: { project: '/new', output: '/new/dist' },
        dependencies: [{ general: { name: 'sub' } }],
        build: { withBuildConfig: true },
    });

    test('keeps the old identity and takes the new implementation', () => {
        const r = restampIdentity(newNode(), oldNode());
        expect(r.general).toEqual(oldNode().general);
        expect(r.package.name).toBe('@crossbind/port-gdal-wasm');
        expect(r.package.nativeVersion).toBe('9.9.9');
        expect(r.export.libName).toEqual(['gdal']);
        expect(r.export.bundle).toBe(false);
        expect(r.paths).toEqual({ project: '/new', output: '/new/dist' });
        expect(r.dependencies).toHaveLength(1);
        expect(r.build).toEqual({ withBuildConfig: true });
    });

    test('does not mutate its inputs', () => {
        const o = oldNode();
        const n = newNode();
        restampIdentity(n, o);
        expect(n.general.name).toBe('aaagdal');
        expect(o.export.libName).toEqual(['gdal']);
    });
});

describe('resolveExcludedNames', () => {
    test('collects keys marked { exclude: true }', () => {
        expect(resolveExcludedNames({ z: { exclude: true }, proj: { exclude: true } })).toEqual(['z', 'proj']);
    });

    test('ignores rebuild / replace / recipe entries and bare booleans', () => {
        expect(resolveExcludedNames({
            z: { rebuild: true }, gdal: { replace: {} }, curl: { nativeVersion: '1' }, x: false, y: true,
        })).toEqual([]);
    });

    test('handles a missing map', () => {
        expect(resolveExcludedNames(null)).toEqual([]);
        expect(resolveExcludedNames(undefined)).toEqual([]);
    });
});

describe('mergeBuildOverride', () => {
    const recipe = () => ({
        buildType: 'cmake',
        configureProgram: './configure',
        getURL: (v) => `base/${v}`,
        replaceList: [{ regex: 'a', replacement: 'b', paths: ['x'] }],
        getBuildParams: (target) => [`-DBASE=${target.platform}`],
    });

    test('replace-wins for scalar/function recipe fields', () => {
        const merged = mergeBuildOverride(recipe(), { buildType: 'configure', configureProgram: './Configure', getURL: (v) => `o/${v}` });
        expect(merged.buildType).toBe('configure');
        expect(merged.configureProgram).toBe('./Configure');
        expect(merged.getURL('1')).toBe('o/1');
    });

    test('replaceList appends by default and with { append }, replaces with { set }', () => {
        const extra = { regex: 'c', replacement: 'd', paths: ['y'] };
        expect(mergeBuildOverride(recipe(), { replaceList: [extra] }).replaceList).toHaveLength(2);
        expect(mergeBuildOverride(recipe(), { replaceList: { append: [extra] } }).replaceList).toHaveLength(2);
        expect(mergeBuildOverride(recipe(), { replaceList: { set: [extra] } }).replaceList).toEqual([extra]);
    });

    test('getBuildParams wrap passes the original recipe function as `base`', () => {
        const merged = mergeBuildOverride(recipe(), {
            getBuildParams: (base, target) => [...base(target), '-DEXTRA=ON'],
        });
        expect(merged.getBuildParams({ platform: 'wasm' })).toEqual(['-DBASE=wasm', '-DEXTRA=ON']);
    });

    test('does not mutate the input recipe', () => {
        const r = recipe();
        mergeBuildOverride(r, {
            buildType: 'configure',
            replaceList: [{ regex: 'c', replacement: 'd', paths: ['y'] }],
        });
        expect(r.buildType).toBe('cmake');
        expect(r.replaceList).toHaveLength(1);
    });
});

describe('getOverrideKey', () => {
    const dep = (override, nativeVersion = '3.13.0') => ({
        general: { name: 'gdal' },
        package: { nativeVersion },
        overrideBuild: override,
    });

    test('is stable for identical inputs', () => {
        expect(getOverrideKey(dep({ a: 1 }))).toBe(getOverrideKey(dep({ a: 1 })));
    });

    test('changes when the override source version changes', () => {
        expect(getOverrideKey(dep({ nativeVersion: '3.12.0' })))
            .not.toBe(getOverrideKey(dep({ nativeVersion: '3.11.0' })));
    });

    test('changes when a function body in the override changes', () => {
        const a = dep({ getBuildParams: () => ['-DA'] });
        const b = dep({ getBuildParams: () => ['-DB'] });
        expect(getOverrideKey(a)).not.toBe(getOverrideKey(b));
    });
});
