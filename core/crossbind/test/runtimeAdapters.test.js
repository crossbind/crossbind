import { describe, test, expect, vi, afterEach } from 'vitest';
import pathUrl from '../src/assets/js-runtime/adapters/path-url.js';
import pathFs from '../src/assets/js-runtime/adapters/path-fs.js';
import fsNode from '../src/assets/js-runtime/adapters/fs-node.js';

describe('path-url', () => {
    afterEach(() => {
        delete globalThis.document;
    });

    test('serves assets from the site root when the app gives no path', () => {
        expect(pathUrl.getDefaultPathPrefix()).toBe('/');
    });

    // An app served from /app/ passes `path: './dist'` for /app/dist/, as the vanilla template does.
    test('resolves a relative path against the page', () => {
        globalThis.document = { baseURI: 'https://site.example/app/index.html' };

        expect(pathUrl.finalizePath('./dist/crossbind.wasm')).toBe('https://site.example/app/dist/crossbind.wasm');
        expect(pathUrl.finalizePath('dist/crossbind.wasm')).toBe('https://site.example/app/dist/crossbind.wasm');
    });

    test('leaves an absolute path and an http(s) URL alone', () => {
        expect(pathUrl.finalizePath('/assets/crossbind.wasm')).toBe('/assets/crossbind.wasm');
        expect(pathUrl.finalizePath('https://cdn.example/crossbind.wasm')).toBe('https://cdn.example/crossbind.wasm');
        expect(pathUrl.finalizePath('http://cdn.example/crossbind.wasm')).toBe('http://cdn.example/crossbind.wasm');
    });
});

describe('path-fs', () => {
    test('serves the prefix and data path it was built with', () => {
        const adapter = pathFs({ defaultPathPrefix: '/opt/app/', dataPath: '/opt/app/data' });

        expect(adapter.getDefaultPathPrefix()).toBe('/opt/app/');
        expect(adapter.getDataPath()).toBe('/opt/app/data');
    });
});

describe('fs-node extendModule', () => {
    const moduleWithFs = () => {
        const dirs = {
            '/memfs': ['.', '..', 'a.txt', 'sub'],
            '/memfs/sub': ['.', '..', 'b.bin'],
            '/': ['.', '..', 'root.txt'],
        };
        const stats = {
            '/memfs/a.txt': { mode: 0o100644, size: 3 },
            '/memfs/sub': { mode: 0o040755, size: 0 },
            '/memfs/sub/b.bin': { mode: 0o100644, size: 5 },
            '/root.txt': { mode: 0o100644, size: 7 },
        };
        const m = {
            FS: {
                readdir: (p) => dirs[p],
                stat: (p) => stats[p],
                readFile: vi.fn(() => new Uint8Array([1, 2, 3])),
            },
        };
        fsNode.extendModule(m);
        return m;
    };

    test('walks nested directories and reports only regular files', () => {
        const m = moduleWithFs();

        expect(m.getFileList()).toEqual([
            { path: '/memfs/a.txt', size: 3 },
            { path: '/memfs/sub/b.bin', size: 5 },
        ]);
    });

    test('joins root entries without doubling the slash', () => {
        const m = moduleWithFs();

        expect(m.getFileList('/')).toEqual([{ path: '/root.txt', size: 7 }]);
    });

    test('reads file bytes as binary and answers empty for a missing path', () => {
        const m = moduleWithFs();

        expect(m.getFileBytes('/memfs/a.txt')).toEqual(new Uint8Array([1, 2, 3]));
        expect(m.FS.readFile).toHaveBeenCalledWith('/memfs/a.txt', { encoding: 'binary' });
        expect(m.getFileBytes('')).toEqual(new Uint8Array());
    });
});
