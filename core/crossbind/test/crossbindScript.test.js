import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, test, expect, vi, afterAll, afterEach, beforeEach } from 'vitest';

vi.mock('../src/actions/getData.js', () => ({ default: () => ({}) }));
vi.mock('../src/utils/loadJson.js', () => ({ default: () => ['VectorMatrix', 'Matrix'] }));
vi.mock('../src/state/index.js', () => ({ default: { config: { paths: {}, ext: {} } } }));

const { default: getCrossbindScript } = await import('../src/integration/getCrossbindScript.js');

const TARGET = { platform: 'wasm' };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-script-'));

// The generated text is an ES module, so it has to be evaluated as one to observe live bindings.
async function loadModule(name, source) {
    const file = path.join(dir, `${name}.mjs`);
    fs.writeFileSync(file, source);
    return import(pathToFileURL(file).href);
}

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('generated proxy modules', () => {
    test('every module exports initNative alongside its symbols', async () => {
        const proxy = await loadModule('proxy-a', getCrossbindScript(TARGET, '/nonexistent/bridge'));

        expect(typeof proxy.initNative).toBe('function');
        // One name only: the old init / initCrossbind aliases are gone.
        expect(proxy.init).toBeUndefined();
        expect(proxy.initCrossbind).toBeUndefined();
    });

    test('a bridge file is required - there is no bare runtime module any more', () => {
        expect(() => getCrossbindScript(TARGET)).toThrow(/bridge file/);
    });

    test('a single init binds the exports of every imported module', async () => {
        const module = { Matrix: 'MATRIX', VectorMatrix: 'VECTOR' };
        // Pre-seeding the boot promise keeps __crossbindBoot (which fetches /crossbind.js) out of the test.
        globalThis.__crossbindBinders = undefined;
        globalThis.__crossbindModule = undefined;
        globalThis.__crossbindBootPromise = Promise.resolve(module);

        const one = await loadModule('proxy-b1', getCrossbindScript(TARGET, '/nonexistent/bridge'));
        const proxy = await loadModule('proxy-b2', getCrossbindScript(TARGET, '/nonexistent/bridge'));

        expect(proxy.Matrix).toBeNull();

        // init() comes from whichever module the app already imports.
        const resolved = await one.initNative();

        expect(resolved).toBe(module);
        expect(proxy.Matrix).toBe('MATRIX');
        expect(proxy.VectorMatrix).toBe('VECTOR');
        expect(proxy.AllSymbols).toBe(module);
    });

    test('calling initNative on one module binds the others too', async () => {
        // Apps import several generated modules; whichever one they boot binds all of them.
        const module = { Matrix: 'LEGACY', VectorMatrix: 'LEGACY_VEC' };
        globalThis.__crossbindBinders = undefined;
        globalThis.__crossbindModule = undefined;
        globalThis.__crossbindBootPromise = Promise.resolve(module);

        const one = await loadModule('proxy-legacy-1', getCrossbindScript(TARGET, '/nonexistent/bridge'));
        const two = await loadModule('proxy-legacy-2', getCrossbindScript(TARGET, '/nonexistent/bridge'));

        // One call resolves both modules.
        await one.initNative();

        expect(one.Matrix).toBe('LEGACY');
        expect(two.Matrix).toBe('LEGACY');

        // A second call on another module is a harmless no-op.
        await expect(two.initNative()).resolves.toBe(module);
    });

    test('a module imported after init binds immediately', async () => {
        const module = { Matrix: 'LATE', VectorMatrix: 'LATE_VEC' };
        globalThis.__crossbindBinders = undefined;
        globalThis.__crossbindModule = undefined;
        globalThis.__crossbindBootPromise = Promise.resolve(module);

        const early = await loadModule('proxy-c1', getCrossbindScript(TARGET, '/nonexistent/bridge'));
        await early.initNative();

        const late = await loadModule('proxy-c', getCrossbindScript(TARGET, '/nonexistent/bridge'));
        expect(late.Matrix).toBe('LATE');
    });

    test('terminate drops the boot promise so a later init starts a fresh runtime', async () => {
        globalThis.__crossbindBinders = undefined;
        globalThis.__crossbindModule = undefined;
        globalThis.__crossbindBootPromise = Promise.resolve({ Matrix: 'FIRST', VectorMatrix: 'V' });

        const proxy = await loadModule('proxy-d', getCrossbindScript(TARGET, '/nonexistent/bridge'));
        await proxy.initNative();
        expect(globalThis.__crossbindModule).toBeTruthy();

        proxy.initNative.terminate();
        expect(globalThis.__crossbindBootPromise).toBeNull();
        expect(globalThis.__crossbindModule).toBeNull();
    });
});

// Vite's base and Rspack's publicPath name where the app is served; the plugins hand it to the boot code.
describe('the browser boot', () => {
    let apps = 0;
    let app;
    let appUrl;

    // Each test serves its own app: a module imported once is not run again.
    beforeEach(() => {
        apps += 1;
        app = path.join(dir, 'site', `app${apps}`);
        appUrl = `${pathToFileURL(app).href}/`;
        fs.mkdirSync(app, { recursive: true });
        fs.writeFileSync(path.join(app, 'crossbind.js'), 'globalThis.crossbindLoadedFrom = import.meta.url;\n');
        globalThis.window = globalThis;
        globalThis.Crossbind = { initNative: (config) => ({ config }) };
        globalThis.document = { baseURI: `${appUrl}index.html` };
        globalThis.__crossbindBinders = undefined;
        globalThis.__crossbindModule = undefined;
        globalThis.__crossbindBootPromise = undefined;
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.Crossbind;
        delete globalThis.document;
        delete globalThis.crossbindLoadedFrom;
    });

    test.each([['relative to the page', () => './'], ['a URL', () => appUrl]])('loads crossbind.js from a base %s and serves its assets from there', async (_, base) => {
        const proxy = await loadModule(`proxy-base-${apps}`, getCrossbindScript(TARGET, '/nonexistent/bridge', { base: base() }));

        const m = await proxy.initNative();

        expect(fileURLToPath(globalThis.crossbindLoadedFrom)).toBe(path.join(app, 'crossbind.js'));
        expect(m.config.path).toBe(appUrl);
    });

    // Webpack and Rspack put their public path there at run time, 'auto' included.
    test("takes webpack's public path in a webpack bundle", async () => {
        globalThis.__webpack_public_path__ = appUrl;
        try {
            const proxy = await loadModule(`proxy-base-${apps}`, getCrossbindScript(TARGET, '/nonexistent/bridge'));

            const m = await proxy.initNative();

            expect(fileURLToPath(globalThis.crossbindLoadedFrom)).toBe(path.join(app, 'crossbind.js'));
            expect(m.config.path).toBe(appUrl);
        } finally {
            delete globalThis.__webpack_public_path__;
        }
    });

    test('lets the path the app passes win over the base', async () => {
        const proxy = await loadModule(`proxy-base-${apps}`, getCrossbindScript(TARGET, '/nonexistent/bridge', { base: './' }));

        const m = await proxy.initNative({ path: '/assets' });

        expect(m.config.path).toBe('/assets');
    });
});
