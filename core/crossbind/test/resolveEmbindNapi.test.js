import { describe, test, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Without a project path the consumer-resolution branches are skipped, which puts the monorepo
// fallback under test.
const load = async () => {
    vi.resetModules();
    vi.doMock('../src/state/index.js', () => ({ default: { config: {} } }));
    return import('../src/utils/resolveEmbindNapi.js');
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('resolveEmbindNapiRoot', () => {
    test('falls back to the package shipped next to the engine', async () => {
        const { default: resolveEmbindNapiRoot } = await load();

        const root = resolveEmbindNapiRoot();

        expect(root.endsWith(path.join('core', 'embind-napi'))).toBe(true);
        expect(fs.existsSync(`${root}/cpp/src/node_api_module.cpp`)).toBe(true);
    });

    test('throws a directive error when nothing provides the package', async () => {
        const { default: resolveEmbindNapiRoot } = await load();
        vi.spyOn(fs, 'existsSync').mockReturnValue(false);

        expect(() => resolveEmbindNapiRoot())
            .toThrow(/native Node\.js builds need @crossbind\/core-embind-napi/);
    });
});

describe('resolveEmbindJsiRoot', () => {
    test('finds the embind runtime through the Node-API package', async () => {
        const { resolveEmbindJsiRoot } = await load();

        const root = resolveEmbindJsiRoot();

        expect(fs.existsSync(`${root}/cpp/src/emscripten/bind.cpp`)).toBe(true);
        expect(fs.existsSync(`${root}/js/embind.js`)).toBe(true);
    });
});
