import { describe, test, expect } from 'vitest';
import flattenConfigForTable from '../src/utils/flattenConfigForTable.js';

describe('flattenConfigForTable', () => {
    test('flattens nested objects into dotted keys', () => {
        const out = flattenConfigForTable({ general: { name: 'app', alias: { package: 'gdal3.js' } } });
        expect(out['general.name']).toBe('app');
        expect(out['general.alias.package']).toBe('gdal3.js');
    });

    test('joins arrays of primitives inline', () => {
        const out = flattenConfigForTable({ ext: { header: ['h', 'hpp', 'hxx'] } });
        expect(out['ext.header']).toBe('h, hpp, hxx');
    });

    test('collapses arrays of dependency objects to their names', () => {
        const out = flattenConfigForTable({
            allDependencies: [{ general: { name: 'gdal' } }, { package: { name: '@crossbind/port-proj' } }],
        });
        expect(out.allDependencies).toBe('gdal, @crossbind/port-proj');
    });

    test('recurses arrays of nameless objects into indexed keys', () => {
        const out = flattenConfigForTable({ targetSpecs: [{ specs: { env: { FOO: '1' } } }] });
        expect(out['targetSpecs.0.specs.env.FOO']).toBe('1');
    });

    test('summarizes nameless object arrays once depth is exhausted', () => {
        const out = flattenConfigForTable({ targetSpecs: [{ specs: {} }, { specs: {} }] }, { maxDepth: 1 });
        expect(out.targetSpecs).toBe('<2 items>');
    });

    test('renders functions as [Function]', () => {
        const out = flattenConfigForTable({ functions: { isEnabled: () => true } });
        expect(out['functions.isEnabled']).toBe('[Function]');
    });

    test('shows keys for large maps of objects instead of expanding them', () => {
        const targets = {};
        for (let i = 0; i < 10; i += 1) targets[`t${i}`] = { gdal: { root: '/x' } };
        const out = flattenConfigForTable({ allDependencyPaths: targets });
        expect(out.allDependencyPaths).toContain('t0');
        expect(out['allDependencyPaths.t0']).toBeUndefined();
        expect(out['allDependencyPaths.t0.gdal']).toBeUndefined();
    });

    test('recurses small maps of objects to show their contents', () => {
        const out = flattenConfigForTable({ specs: { env: { FOO: '1', BAR: '2' } } });
        expect(out['specs.env.FOO']).toBe('1');
        expect(out['specs.env.BAR']).toBe('2');
    });

    test('caps nesting depth to keep output terse', () => {
        const out = flattenConfigForTable({ a: { b: { c: { d: 1 } } } }, { maxDepth: 2 });
        expect(out['a.b']).toBe('{…}');
        expect(out['a.b.c']).toBeUndefined();
    });

    test('marks empty objects and arrays', () => {
        const out = flattenConfigForTable({ build: {}, binHeaders: [] });
        expect(out.build).toBe('{}');
        expect(out.binHeaders).toBe('[]');
    });

    test('relativizes absolute paths under base, leaving outside paths absolute', () => {
        const out = flattenConfigForTable(
            { paths: { native: '/repo/packages/core/native', systemConfig: '/home/u/.crossbind/config.json' } },
            { base: '/repo' },
        );
        expect(out['paths.native']).toBe('packages/core/native');
        expect(out['paths.systemConfig']).toBe('/home/u/.crossbind/config.json');
    });

    test('relativizes each entry of an absolute-path array (globs)', () => {
        const out = flattenConfigForTable(
            { dependencyParameters: { nativeGlob: ['/repo/src/*.c', '/repo/src/*.cpp'] } },
            { base: '/repo' },
        );
        expect(out['dependencyParameters.nativeGlob']).toBe('src/*.c, src/*.cpp');
    });

    test('truncates long values in the middle, preserving head and tail', () => {
        const long = `/repo/${'x'.repeat(100)}/CMakeLists.txt`;
        const out = flattenConfigForTable({ paths: { cmake: long } }, { base: '/repo', maxValueLength: 40 });
        const value = out['paths.cmake'];
        expect(value.length).toBe(40);
        expect(value).toContain('…');
        expect(value.endsWith('CMakeLists.txt')).toBe(true);
    });

    test('never truncates the dependency name list', () => {
        const deps = Array.from({ length: 20 }, (_, i) => ({ general: { name: `dep${i}` } }));
        const out = flattenConfigForTable({ allDependencies: deps }, { maxValueLength: 20 });
        expect(out.allDependencies).toContain('dep19');
        expect(out.allDependencies).not.toContain('…');
    });
});
