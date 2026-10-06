import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ workerApi: { init: null } }));

// The adapter rebuilds comlink's handler table at load, reading the built-in proxy/throw
// handlers first, so the stub has to provide them.
vi.mock('comlink', () => ({
    transferHandlers: new Map([
        ['proxy', { canHandle: () => false, serialize: (v) => [v, []], deserialize: (v) => v }],
        ['throw', { canHandle: () => false, serialize: (v) => [v, []], deserialize: (v) => v }],
    ]),
    wrap: () => h.workerApi,
    expose: () => {},
    proxy: (value) => value,
}));

const { default: workerAdapter } = await import('../src/assets/js-runtime/adapters/worker-comlink.js');

let created;
const originalWorker = globalThis.Worker;

beforeEach(() => {
    created = [];
    h.workerApi.init = vi.fn(async () => ({ toArray: vi.fn(() => ['from-worker']), value: 42 }));
    globalThis.Worker = class {
        constructor(url) {
            created.push(url);
            this.terminate = vi.fn();
        }
    };
});

afterEach(() => {
    workerAdapter.terminate();
    globalThis.Worker = originalWorker;
});

describe('initWithWorker', () => {
    test('derives the worker script url from the configured path prefix', async () => {
        await workerAdapter.initWithWorker({ path: '/assets', paths: { js: 'crossbind.js' } }, {});

        expect(created).toEqual(['/assets/crossbind.js']);
    });

    test('makes a bare script name absolute and lets an explicit workerUrl win', async () => {
        await workerAdapter.initWithWorker({ paths: { js: 'crossbind.js' } }, {});
        await workerAdapter.initWithWorker({ workerUrl: 'https://cdn.example/w.js', paths: { js: 'ignored.js' } }, {});

        expect(created).toEqual(['/crossbind.js', 'https://cdn.example/w.js']);
    });

    test('strips the non-cloneable config before it crosses the worker boundary', async () => {
        // Functions cannot be structured-cloned; sending them would fail with DataCloneError.
        await workerAdapter.initWithWorker({ paths: { js: 'w.js' } }, {
            logHandler: () => {},
            errorHandler: () => {},
            onRuntimeInitialized: () => {},
            getWasmFunction: () => {},
            useWorker: true,
            workerUrl: '/w.js',
            env: { KEY: 'value' },
        });

        expect(h.workerApi.init).toHaveBeenCalledWith({ env: { KEY: 'value' } });
    });

    // A worker resolves a relative URL against its own script, not the page.
    test('resolves a relative path against the page and hands the worker the result', async () => {
        globalThis.document = { baseURI: 'https://site.example/app/index.html' };
        try {
            await workerAdapter.initWithWorker({ path: './dist', paths: { js: 'crossbind.js' } }, { path: './dist' });

            expect(created).toEqual(['https://site.example/app/dist/crossbind.js']);
            expect(h.workerApi.init).toHaveBeenCalledWith({ path: 'https://site.example/app/dist' });
        } finally {
            delete globalThis.document;
        }
    });

    test('toArray passes a plain array through instead of round-tripping it', async () => {
        const module = await workerAdapter.initWithWorker({ paths: { js: 'w.js' } }, {});

        expect(module.toArray([1, 2])).toEqual([1, 2]);
        expect(module.value).toBe(42);
    });
});

describe('terminate', () => {
    test('terminates the live worker once and stays safe afterwards', async () => {
        await workerAdapter.initWithWorker({ paths: { js: 'w.js' } }, {});

        workerAdapter.terminate();
        workerAdapter.terminate();

        expect(created).toHaveLength(1);
    });
});
