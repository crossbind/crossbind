import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL_NAMES, findHeaderImports, findHeaderImportsIn } from '../src/utils/headerImports.js';

const HEADER_EXTENSIONS = ['h', 'hpp', 'hxx', 'hh'];

describe('findHeaderImports', () => {
    test('reads the names each import and re-export takes from a header', () => {
        const source = [
            "import { deflate, Z_FINISH as FINISH } from '@crossbind/port-zlib/zlib.h';",
            "import initNative, { Native } from './native/native.h';",
            "export { CONF_INT, CONF_STRING as NAME } from '@crossbind/conformance/native/confconstants.h';",
            "import { helper } from './helper.js';",
        ].join('\n');

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([
            { specifier: '@crossbind/port-zlib/zlib.h', names: ['deflate', 'Z_FINISH'] },
            { specifier: './native/native.h', names: ['Native'] },
            { specifier: '@crossbind/conformance/native/confconstants.h', names: ['CONF_INT', 'CONF_STRING'] },
        ]);
    });

    test('takes every name through a namespace import or an export star', () => {
        const source = "import * as zlib from './zlib.h';\nexport * from './tiffio.hxx';\nexport * as geos from './geos_c.h';\n";

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([
            { specifier: './zlib.h', names: ALL_NAMES },
            { specifier: './tiffio.hxx', names: ALL_NAMES },
            { specifier: './geos_c.h', names: ALL_NAMES },
        ]);
    });

    test('reads lists over several lines with comments, and leaves types out', () => {
        const source = [
            "import type { Options } from './a.h';",
            'import {',
            '    type Mode, // an enum type',
            '    Z_OK, /* status */ Z_STREAM_END,',
            "} from './a.h';",
        ].join('\n');

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([{ specifier: './a.h', names: ['Z_OK', 'Z_STREAM_END'] }]);
    });

    // Each of these hands the app the whole module, whose members it reaches by name.
    test('takes every name through a dynamic import, a side-effect import or a require', () => {
        const source = "const m = await import('./a.h');\nimport './b.h';\nconst c = require(\"./c.h\");\n";

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([
            { specifier: './a.h', names: ALL_NAMES },
            { specifier: './b.h', names: ALL_NAMES },
            { specifier: './c.h', names: ALL_NAMES },
        ]);
    });

    test('takes every name through a lazy import with a bundler comment or a template literal', () => {
        const source = "import(/* webpackChunkName: \"gdal\" */ './a.h');\nimport(/* @vite-ignore */ \"./b.h\");\nimport(`./c.h`);\n";

        expect(findHeaderImports(source, HEADER_EXTENSIONS).map(({ specifier, names }) => [specifier, names])).toEqual([
            ['./a.h', ALL_NAMES],
            ['./b.h', ALL_NAMES],
            ['./c.h', ALL_NAMES],
        ]);
    });

    // Every source of the app is read on each transform, so the comments before a lazy import's argument must not be
    // tried in every grouping.
    test('reads a lazy import after many comments in linear time', () => {
        const source = `import(${'/* chunk */ '.repeat(28)}name)`;
        const started = performance.now();

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([]);
        expect(performance.now() - started).toBeLessThan(100);
    });

    test('reads an import list with a run of comments that never close in linear time', () => {
        const source = `import { a, ${'/*a'.repeat(64000)} } from './x.h';`;
        const started = performance.now();

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([{ specifier: './x.h', names: ['a'] }]);
        expect(performance.now() - started).toBeLessThan(100);
    });

    test('finds no names in a default-only import or a specifier built at run time', () => {
        const source = "import c from './c.h';\nconst d = await import(`./${name}.h`);\n";

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([]);
    });

    test('reads the import after an unrelated default export', () => {
        const source = "export default function run() { return 1; }\nimport { Z_OK } from './zlib.h';\n";

        expect(findHeaderImports(source, HEADER_EXTENSIONS)).toEqual([{ specifier: './zlib.h', names: ['Z_OK'] }]);
    });
});

describe('findHeaderImportsIn', () => {
    let project;

    beforeEach(() => {
        project = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-header-imports-'));
        const write = (file, text) => {
            fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
            fs.writeFileSync(path.join(project, file), text);
        };
        write('src/App.vue', "<script setup>\nimport { Z_OK } from './zlib.h'\n</script>\n");
        write('node_modules/pkg/index.js', "import { HIDDEN } from './zlib.h';\n");
        write('dist/bundle.js', "import { BUILT } from './zlib.h';\n");
        write('.crossbind/cache.js', "import { CACHED } from './zlib.h';\n");
    });

    afterEach(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('reads the app sources and skips dependencies, build outputs and hidden directories', () => {
        expect(findHeaderImportsIn(project, HEADER_EXTENSIONS)).toEqual([
            { importer: path.join(project, 'src/App.vue'), specifier: './zlib.h', names: ['Z_OK'] },
        ]);
    });

    test('sees an import added after an earlier scan', () => {
        findHeaderImportsIn(project, HEADER_EXTENSIONS);
        const file = path.join(project, 'src/App.vue');
        fs.writeFileSync(file, "<script setup>\nimport { Z_OK, Z_FINISH } from './zlib.h'\n</script>\n");
        const later = new Date(Date.now() + 5000);
        fs.utimesSync(file, later, later);

        expect(findHeaderImportsIn(project, HEADER_EXTENSIONS)[0].names).toEqual(['Z_OK', 'Z_FINISH']);
    });
});
