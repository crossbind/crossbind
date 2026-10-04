import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { rollup } from 'rollup';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import scopedEmbind from '../src/utils/scopedEmbind.js';

// Every package's loader bundles its own embind runtime, and apps load several packages into one process.
describe('scopedEmbind', () => {
    let work;
    const source = [
        "globalThis.Module = typeof globalThis.Module != 'undefined' ? globalThis.Module : {};",
        'globalThis.__crossbind_scope_marker = Math.random();',
        "Module.tag = 'bare';",
        'export default globalThis.Module;',
        '',
    ].join('\n');

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-scoped-embind-'));
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('gives each bundle of the runtime a scope of its own over the real global', async () => {
        const embind = path.join(work, 'embind.js');
        fs.writeFileSync(embind, source);
        const plugin = scopedEmbind(embind);
        const load = (name) => {
            const file = path.join(work, name);
            fs.writeFileSync(file, plugin.transform(source, embind));
            return import(pathToFileURL(file).href);
        };

        const [first, second] = [await load('first.mjs'), await load('second.mjs')];

        expect(first.crossbindScope).not.toBe(second.crossbindScope);
        expect(first.default).toBe(first.crossbindScope.Module);
        expect(first.default).not.toBe(second.default);
        expect(first.default.tag).toBe('bare');
        expect(first.crossbindScope.JSON).toBe(JSON);
        expect(globalThis.__crossbind_scope_marker).toBeUndefined();
    });

    test('keeps the scope to the runtime when rollup bundles it with a module that reads the real global', async () => {
        const embind = path.join(work, 'embind.js');
        const entry = path.join(work, 'entry.js');
        fs.writeFileSync(embind, source);
        fs.writeFileSync(entry, "import Module, { crossbindScope } from './embind.js';\nexport default { Module, crossbindScope, realGlobal: globalThis };\n");
        const bundle = await rollup({ input: entry, plugins: [scopedEmbind(embind)] });
        const { output: [chunk] } = await bundle.generate({ format: 'cjs', exports: 'default' });
        await bundle.close();
        const load = (name) => {
            const file = path.join(work, name);
            fs.writeFileSync(file, chunk.code);
            return createRequire(import.meta.url)(file);
        };

        const [first, second] = [load('first.cjs'), load('second.cjs')];

        expect(first.crossbindScope).not.toBe(second.crossbindScope);
        expect(first.Module).toBe(first.crossbindScope.Module);
        expect(first.realGlobal).toBe(globalThis);
        expect(globalThis.__crossbind_scope_marker).toBeUndefined();
    });

    test('leaves the other modules of the bundle alone', () => {
        expect(scopedEmbind('/jsi/js/embind.js').transform('globalThis.x = 1;', '/napi/js/loader.js')).toBeNull();
    });
});
