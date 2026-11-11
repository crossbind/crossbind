import { describe, test, expect } from 'vitest';
import {
    normalizeConanDependencies, conanRequires, conanOptionArgs, assertRecipeOptions,
} from '../../../extensions/conan/src/dependencies.js';

describe('what a project declares under packages.conan', () => {
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
        expect(() => normalizeConanDependencies({ zlib: '' }))
            .toThrow("crossbind: packages.conan.zlib needs a version such as '1.3.1' or a range such as '[>=1.3 <2]' (got \"\").");
    });

    test('refuses a key a package spec does not take, such as a misspelt options', () => {
        expect(() => normalizeConanDependencies({ sqlite3: { version: '3.53.4', option: { enable_fts5: true } } }))
            .toThrow("crossbind: packages.conan.sqlite3 takes version and options, not 'option'.");
        expect(() => normalizeConanDependencies({ zlib: { version: '1.3.1', '': true } })).toThrow("not ''.");
    });

    test('names a misspelt version rather than asking for one', () => {
        expect(() => normalizeConanDependencies({ zlib: { vesion: '1.3.1' } }))
            .toThrow("crossbind: packages.conan.zlib takes version and options, not 'vesion'.");
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

// Nodes as a `conan install --format=json` graph has them: the options the recipe keeps for the target, what each
// may be, and the defaults the recipe was written with.
const recipeNode = (name, kept, written = kept) => ({
    name,
    context: 'host',
    options: Object.fromEntries(kept.map((option) => [option, 'False'])),
    options_definitions: Object.fromEntries(kept.map((option) => [option, ['True', 'False']])),
    default_options: Object.fromEntries(written.map((option) => [option, false])),
});
const CONSUMER = {
    ref: 'conanfile', name: null, context: 'host', options: {}, options_definitions: {}, default_options: null,
};

describe('the options a project declares, against the recipes conan read', () => {
    test('refuses an option the recipe does not have, with the ones it has', () => {
        const nodes = { 0: CONSUMER, 1: recipeNode('sqlite3', ['shared', 'fPIC', 'enable_fts4', 'enable_fts5']) };
        const declared = (options) => ({ sqlite3: { version: '3.53.4', options } });

        expect(() => assertRecipeOptions(declared({ enable_fts5: true }), nodes)).not.toThrow();
        expect(() => assertRecipeOptions(declared({ enable_fts5: true, enable_fts: true }), nodes))
            .toThrow("crossbind: packages.conan.sqlite3.options - sqlite3/3.53.4 has no option 'enable_fts'. It has: enable_fts4, enable_fts5, fPIC, shared.");
    });

    // zlib's recipe deletes fPIC on Windows, where conan skips it, and one config serves every target.
    test('lets through an option the recipe drops for this target', () => {
        const nodes = { 0: CONSUMER, 1: recipeNode('zlib', ['shared'], ['shared', 'fPIC']) };

        expect(() => assertRecipeOptions({ zlib: { version: '1.3.2', options: { fPIC: true } } }, nodes)).not.toThrow();
    });

    test('lets through an option the recipe gives no default', () => {
        const nodes = { 0: CONSUMER, 1: recipeNode('codec', ['shared', 'backend'], ['shared']) };

        expect(() => assertRecipeOptions({ codec: { version: '2.0', options: { backend: 'neon' } } }, nodes)).not.toThrow();
    });

    // `-o:h` sets an option on the host package alone.
    test('reads the recipe of the host package, not of a build tool of the same name', () => {
        const nodes = {
            0: CONSUMER,
            1: recipeNode('protobuf', ['shared', 'lite']),
            2: { ...recipeNode('protobuf', ['shared', 'with_zlib']), context: 'build' },
        };
        const declared = (options) => ({ protobuf: { version: '3.21.12', options } });

        expect(() => assertRecipeOptions(declared({ lite: true }), nodes)).not.toThrow();
        expect(() => assertRecipeOptions(declared({ with_zlib: true }), nodes))
            .toThrow("protobuf/3.21.12 has no option 'with_zlib'. It has: lite, shared.");
    });

    // A recipe can write the graph: a name that is no text names no declared package.
    test('passes over a node whose name is no text', () => {
        const zlib = recipeNode('zlib', ['shared']);
        const nodes = { 0: CONSUMER, 1: { ...zlib, name: { toString: 0 } }, 2: { ...zlib, name: ['zlib'] } };

        expect(() => assertRecipeOptions({ zlib: { version: '1.3.2', options: { fpic: true } } }, nodes)).not.toThrow();
    });

    test('names plain option names only, and a recipe without options as one', () => {
        // A recipe writes these names: one for a requirement, or with characters no option name has, is left out.
        const libpng = {
            name: 'libpng',
            context: 'host',
            options: { sse: 'True', 'zlib/*:shared': 'False' },
            options_definitions: { sse: ['True', 'False'] },
            default_options: { sse: true, 'neon\u001b[31m': true },
        };
        const rapidjson = { ...CONSUMER, name: 'rapidjson' };

        expect(() => assertRecipeOptions({ libpng: { version: '[>=1.6 <2]', options: { simd: true } } }, { 1: libpng }))
            .toThrow("crossbind: packages.conan.libpng.options - libpng/[>=1.6 <2] has no option 'simd'. It has: sse.");
        expect(() => assertRecipeOptions({ rapidjson: { version: '1.1.0', options: { simd: true } } }, { 1: rapidjson }))
            .toThrow("rapidjson/1.1.0 has no option 'simd'. It has none.");
    });
});
