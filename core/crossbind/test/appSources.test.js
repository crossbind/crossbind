import { describe, test, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import appSourceFiles, { isAppSource } from '../src/utils/appSources.js';

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
