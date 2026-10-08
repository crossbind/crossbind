import { describe, test, expect } from 'vitest';
import path from 'node:path';
import appSourceFiles, { isAppSource } from '../src/utils/appSources.js';

const project = path.join(path.sep, 'work', 'app');

describe('appSourceFiles', () => {
    test('finds nothing in a project directory that does not exist', () => {
        expect(appSourceFiles(path.join(project, 'missing'))).toEqual([]);
    });
});

describe('isAppSource', () => {
    test.each(['src/main.js', 'src/App.vue', 'src/routes/page.tsx', 'App.svelte', 'src/worker.mts'])('takes %s, a source the import scan reads', (file) => {
        expect(isAppSource(project, path.join(project, file))).toBe(true);
    });

    test.each([
        'node_modules/pkg/index.js',
        'dist/assets/index.js',
        '.crossbind/build/bridge/zlib.i.cpp',
        'src/style.css',
        'src/native/zlib.h',
        '../other/main.js',
    ])('leaves out %s', (file) => {
        expect(isAppSource(project, path.join(project, file))).toBe(false);
    });
});
