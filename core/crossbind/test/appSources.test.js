import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import appSourceFiles, { appSourceImports, isAppSource } from '../src/utils/appSources.js';

const project = path.join(path.sep, 'work', 'app');

describe('appSourceFiles', () => {
    test('finds nothing in a project directory that does not exist', () => {
        expect(appSourceFiles(path.join(project, 'missing'))).toEqual([]);
    });

    test('reads inline scripts, framework sources, nested build folders and imported dependencies', () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-sources-'));
        try {
            const sources = {
                'package.json': JSON.stringify({ dependencies: { helper: '1' } }),
                'index.html': '<script type="module">import "helper";</script>',
                'src/build/page.astro': 'import { compress } from "zlib.h";',
                'src/android/page.mdx': 'import { version } from "zlib.h";',
                'node_modules/helper/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/helper/index.js': 'export { compress } from "./native.js";',
                'node_modules/helper/native.js': 'export { compress } from "@crossbind/port-zlib/zlib.h";',
                'node_modules/unrelated/index.js': 'export { unused } from "unused.h";',
                'dist/bundle.js': 'import "unused.h";',
            };
            for (const [relative, text] of Object.entries(sources)) {
                const file = path.join(work, relative);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, text);
            }
            expect(appSourceFiles(work).map((file) => path.relative(fs.realpathSync(work), fs.realpathSync(file)).split(path.sep).join('/')).sort()).toEqual([
                'index.html', 'node_modules/helper/index.js', 'node_modules/helper/native.js',
                'src/android/page.mdx', 'src/build/page.astro',
            ]);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });

    test('follows optional dependencies and import/browser export branches, including wildcard subpaths', () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-app-exports-'));
        try {
            const sources = {
                'package.json': JSON.stringify({ optionalDependencies: { helper: '1' } }),
                'src/main.js': 'import "helper"; import "helper/features/native";',
                'node_modules/helper/package.json': JSON.stringify({ exports: {
                    '.': { browser: './browser.js', import: './esm.js', types: './types.d.ts' },
                    './features/*': { import: './src/*.js' },
                } }),
                'node_modules/helper/browser.js': 'export { compress } from "zlib.h";',
                'node_modules/helper/esm.js': 'export { compressBound } from "zlib.h";',
                'node_modules/helper/src/native.js': 'export { version } from "zlib.h";',
                'node_modules/helper/types.d.ts': 'export {}',
            };
            for (const [relative, text] of Object.entries(sources)) {
                const file = path.join(work, relative);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, text);
            }
            expect(appSourceFiles(work).map((file) => path.relative(fs.realpathSync(work), fs.realpathSync(file)).split(path.sep).join('/')).sort()).toEqual([
                'node_modules/helper/browser.js', 'node_modules/helper/esm.js',
                'node_modules/helper/src/native.js', 'src/main.js',
            ]);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });

    // A framework's config names its type in a comment or imports it as a type: neither loads the framework, whose own
    // sources the scan would otherwise read by the thousand.
    test('follows no import that loads nothing: one in a comment, or of types alone', () => {
        const work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-app-types-')));
        try {
            const sources = {
                'package.json': JSON.stringify({ dependencies: { framework: '1', helper: '1' } }),
                'framework.config.mjs': "/** @type {import('framework').Config} */\nexport default {}; // import('framework')\n",
                'framework.config.ts': "import type { Config } from 'framework';\nexport type { Options } from 'framework';\nconst site = 'https://example.com'; import 'helper';\nexport default {};\n",
                'node_modules/framework/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/framework/index.js': 'export { unused } from "unused.h";',
                'node_modules/helper/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/helper/index.js': 'export { compress } from "zlib.h";',
            };
            for (const [relative, text] of Object.entries(sources)) {
                const file = upath.join(work, relative);
                fs.mkdirSync(upath.dirname(file), { recursive: true });
                fs.writeFileSync(file, text);
            }
            expect(appSourceFiles(work).map((file) => upath.relative(fs.realpathSync(work), fs.realpathSync(file))).sort()).toEqual([
                'framework.config.mjs', 'framework.config.ts', 'node_modules/helper/index.js',
            ]);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });

    // A regex literal can hold a comment's two characters after a backslash, and a type alias is no import of types even
    // with no semicolon after it: the code after either still loads its packages.
    test('reads on after a regex literal with a slash in it and after a type alias', () => {
        const work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-app-lexing-')));
        try {
            const sources = {
                'package.json': JSON.stringify({ dependencies: { geo: '1', maps: '1', tiles: '1' } }),
                'src/trim.js': "export const trim = (url) => url.replace(/\\/*$/, '');\nexport const load = () => import('geo');\n/** After it. */\n",
                'src/url.js': "export const isUrl = (s) => /^https?:\\/\\//.test(s), load = () => import('maps');\n",
                'src/index.ts': "export type Props = { name: string }\nexport { Tile } from 'tiles'\n",
                'node_modules/geo/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/geo/index.js': 'export { area } from "geos.h";',
                'node_modules/maps/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/maps/index.js': 'export { project } from "proj.h";',
                'node_modules/tiles/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/tiles/index.js': 'export { Tile } from "tiff.h";',
            };
            for (const [relative, text] of Object.entries(sources)) {
                const file = upath.join(work, relative);
                fs.mkdirSync(upath.dirname(file), { recursive: true });
                fs.writeFileSync(file, text);
            }
            expect(appSourceFiles(work).map((file) => upath.relative(fs.realpathSync(work), fs.realpathSync(file))).sort()).toEqual([
                'node_modules/geo/index.js', 'node_modules/maps/index.js', 'node_modules/tiles/index.js',
                'src/index.ts', 'src/trim.js', 'src/url.js',
            ]);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });

    // A tool with no resolver crossbind can hook names each import ahead, so it takes the scan's imports, not a file's
    // text: an import in a comment names nothing.
    test("names what the app's sources import, once each, past comments and imports of types alone", () => {
        const work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-app-imports-')));
        try {
            const sources = {
                'package.json': JSON.stringify({ dependencies: { dep: '1' } }),
                'src/main.ts': "import a from 'dep';\n// import { Gone } from 'cargo:gone';\n/* require('dep/old.h') */\nimport type { T } from 'types-only';\nconst util = require('./util.js');\nexport * from 'cargo:uuid';\n",
                'src/util.js': "import 'dep/extra.h'; import a from 'dep';",
                'node_modules/dep/package.json': JSON.stringify({ main: 'index.js' }),
                'node_modules/dep/index.js': 'export { compress } from "zlib.h";',
            };
            for (const [relative, text] of Object.entries(sources)) {
                const file = upath.join(work, relative);
                fs.mkdirSync(upath.dirname(file), { recursive: true });
                fs.writeFileSync(file, text);
            }
            expect(appSourceImports(work).sort()).toEqual(['./util.js', 'cargo:uuid', 'dep', 'dep/extra.h', 'zlib.h']);
        } finally { fs.rmSync(work, { recursive: true, force: true }); }
    });
});

describe('isAppSource', () => {
    test.each(['src/main.js', 'src/App.vue', 'src/routes/page.tsx', 'App.svelte', 'src/worker.mts', 'src/build/page.astro', 'index.html', 'src/a.mdx', 'node_modules/pkg/index.js'])('takes %s, a source the import scan reads', (file) => {
        expect(isAppSource(project, path.join(project, file))).toBe(true);
    });

    test.each([
        'dist/assets/index.js',
        '.crossbind/build/bridge/zlib.i.cpp',
        'src/style.css',
        'src/native/zlib.h',
        '../other/main.js',
    ])('leaves out %s', (file) => {
        expect(isAppSource(project, path.join(project, file))).toBe(false);
    });
});
