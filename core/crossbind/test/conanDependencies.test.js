import { describe, test, expect } from 'vitest';
import { normalizeConanDependencies, conanRequires, conanOptionArgs } from '../src/utils/conanDependencies.js';

describe('conanDependencies', () => {
    test('a version string is the whole spec', () => {
        expect(normalizeConanDependencies({ zlib: '1.3.1' })).toEqual({ zlib: { version: '1.3.1', options: {} } });
    });

    test('an object carries package options', () => {
        expect(normalizeConanDependencies({ sqlite3: { version: '3.53.4', options: { enable_fts5: true } } }))
            .toEqual({ sqlite3: { version: '3.53.4', options: { enable_fts5: true } } });
    });

    test('takes a Conan version range', () => {
        expect(normalizeConanDependencies({ zlib: '[>=1.3 <2]' }).zlib.version).toBe('[>=1.3 <2]');
    });

    test('a project without the key has no Conan packages', () => {
        expect(normalizeConanDependencies(undefined)).toEqual({});
    });

    test('refuses anything but a map of packages', () => {
        for (const bad of [[], 'zlib', 3, null]) {
            expect(() => normalizeConanDependencies(bad), JSON.stringify(bad)).toThrow(/must be an object/);
        }
    });

    test('refuses a name Conan would not accept', () => {
        expect(() => normalizeConanDependencies({ ZLib: '1.3.1' })).toThrow(/Conan package name/);
    });

    test('refuses a missing version and a full reference in its place', () => {
        for (const spec of ['', {}, '1.3.1@user/channel', 'zlib/1.3.1', '1.3.1#a3359ecaabb8e4dcd47c0f37ea28ddfe']) {
            expect(() => normalizeConanDependencies({ zlib: spec }), JSON.stringify(spec)).toThrow(/version/);
        }
    });

    test('refuses option values that are not plain scalars', () => {
        expect(() => normalizeConanDependencies({ zlib: { version: '1.3.1', options: { minizip: [] } } })).toThrow(/options/);
    });

    test('refuses the shared option, since every package links into one static module', () => {
        expect(() => normalizeConanDependencies({ zlib: { version: '1.3.1', options: { shared: true } } })).toThrow(/statically/);
    });

    test('turns into the requirements and host options of conan install', () => {
        const deps = normalizeConanDependencies({
            zlib: '1.3.1',
            sqlite3: { version: '3.53.4', options: { enable_fts5: true, max_column: 4000 } },
        });
        expect(conanRequires(deps)).toEqual(['zlib/1.3.1', 'sqlite3/3.53.4']);
        expect(conanOptionArgs(deps)).toEqual(['-o:h', 'sqlite3/*:enable_fts5=True', '-o:h', 'sqlite3/*:max_column=4000']);
    });
});
