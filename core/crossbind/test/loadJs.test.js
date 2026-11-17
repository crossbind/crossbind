import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import loadJs from '../src/utils/loadJs.js';

describe('loadJs', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = path.join(os.tmpdir(), `crossbind-loadjs-${process.pid}-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('returns null when no matching file exists', async () => {
        const result = await loadJs(tmpDir, 'missing');
        expect(result).toBeNull();
    });

    test('loads a JSON file and returns its parsed value', async () => {
        fs.writeFileSync(path.join(tmpDir, 'obj.json'), JSON.stringify({ x: 1, y: [2, 3] }));
        const result = await loadJs(tmpDir, 'obj');
        expect(result).toEqual({ x: 1, y: [2, 3] });
    });

    test('loads an .mjs module exporting a default object', async () => {
        fs.writeFileSync(path.join(tmpDir, 'mod.mjs'), 'export default { y: 2 };');
        const result = await loadJs(tmpDir, 'mod');
        expect(result).toEqual({ y: 2 });
    });

    test('invokes a default export that is a function and returns its result', async () => {
        fs.writeFileSync(path.join(tmpDir, 'fn.mjs'), 'export default () => ({ called: true });');
        const result = await loadJs(tmpDir, 'fn');
        expect(result).toEqual({ called: true });
    });

    test('respects custom fileExt order — first match wins', async () => {
        fs.writeFileSync(path.join(tmpDir, 'cfg.json'), '{"from":"json"}');
        fs.writeFileSync(path.join(tmpDir, 'cfg.mjs'), 'export default { from: "mjs" };');
        const result = await loadJs(tmpDir, 'cfg', ['mjs', 'json']);
        expect(result).toEqual({ from: 'mjs' });
    });

    test('reads an ES or a CommonJS module again for isFresh, as its file may have changed since the first read', async () => {
        fs.writeFileSync(upath.join(tmpDir, 'esm.mjs'), 'export default { v: 1 };');
        fs.writeFileSync(upath.join(tmpDir, 'cjs.cjs'), 'module.exports = { v: 1 };');
        expect([await loadJs(tmpDir, 'esm'), await loadJs(tmpDir, 'cjs')]).toEqual([{ v: 1 }, { v: 1 }]);
        fs.writeFileSync(upath.join(tmpDir, 'esm.mjs'), 'export default { v: 2 };');
        fs.writeFileSync(upath.join(tmpDir, 'cjs.cjs'), 'module.exports = { v: 2 };');
        expect([await loadJs(tmpDir, 'esm'), await loadJs(tmpDir, 'cjs')]).toEqual([{ v: 1 }, { v: 1 }]);
        expect([await loadJs(tmpDir, 'esm', undefined, { isFresh: true }), await loadJs(tmpDir, 'cjs', undefined, { isFresh: true })]).toEqual([{ v: 2 }, { v: 2 }]);
    });
});
