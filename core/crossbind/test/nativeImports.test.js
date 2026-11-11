import { describe, test, expect } from 'vitest';
import { findImportSpecifiers, nativeSpecifierTest, schemeTest } from '../src/utils/nativeImports.js';

const isNative = nativeSpecifierTest({ header: ['h', 'hpp', 'hxx', 'hh'], module: ['i'] }, ['cargo', 'conan']);

describe('findImportSpecifiers', () => {
    test('finds every way a module names a literal specifier, once each', () => {
        const source = [
            "import { Native } from './native/native.h';",
            "import initNative from './a.h';",
            "import './b.h';",
            "export * from '@crossbind/port-zlib/zlib.h';",
            "const c = await import('./c.hpp');",
            "const d = require('cargo:serde_json/de');",
            "import { Native as Again } from './native/native.h';",
        ].join('\n');

        expect(findImportSpecifiers(source)).toEqual([
            './native/native.h', './a.h', './b.h', '@crossbind/port-zlib/zlib.h', './c.hpp', 'cargo:serde_json/de',
        ]);
    });

    test('finds no specifier built at run time', () => {
        expect(findImportSpecifiers("const name = 'zlib';\nawait import(`./${name}.h`);\nrequire(name + '.h');\n")).toEqual([]);
    });
});

describe('nativeSpecifierTest', () => {
    test('takes headers, modules, Rust files and the schemes of the project, as cargo: and conan:', () => {
        expect(['./a.h', './a.hpp', './a.i', './lib.rs', 'cargo:serde_json', 'conan:zlib/zlib.h', '@scope/pkg/x.hxx'].every(isNative)).toBe(true);
    });

    test('leaves every other module to Node, a scheme the project has not among them', () => {
        expect(['./a.js', 'node:fs', '@scope/pkg', './header.h.js', 'https://example.com/a.h.txt', 'vcpkg:fmt/format'].some(isNative)).toBe(false);
    });

    test("a project's schemes are those of its package sources, beside cargo", () => {
        const hasScheme = schemeTest(['cargo', 'conan', 'vcpkg']);

        expect(['cargo:uuid', 'conan:zlib/zlib.h', 'vcpkg:fmt/format'].every(hasScheme)).toBe(true);
        expect(['./conan:zlib.h', 'conans:zlib/zlib.h', 'node:fs', 'conan'].some(hasScheme)).toBe(false);
    });
});
