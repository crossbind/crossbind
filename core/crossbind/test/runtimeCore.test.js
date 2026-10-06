import { describe, test, expect, vi } from 'vitest';
import { isObject, mergeDeep, createInitCrossbind } from '../src/assets/js-runtime/core.js';

const workerStub = (overrides = {}) => ({
    isWorkerScope: false,
    exposeWorker: vi.fn(),
    initWithWorker: vi.fn(async () => ({ viaWorker: true })),
    terminate: vi.fn(),
    ...overrides,
});

const moduleFactory = () => vi.fn(async () => ({ ready: true }));

// The emscripten factory receives the options object the runtime assembles; grabbing it is the
// only way to exercise locateFile / toArray / toVector / the stdout routing.
async function captureModuleOptions(config) {
    let captured;
    const Module = vi.fn(async (m) => { captured = m; return m; });
    const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: false }, adapter: {}, worker: workerStub() });
    await initNative(config);
    return { captured, config };
}

describe('isObject', () => {
    // Guard used in boolean position, so the negative cases assert falsiness rather than the
    // particular falsy value the && chain happens to return.
    test('accepts plain objects only', () => {
        expect(isObject({})).toBe(true);
        expect(isObject([])).toBeFalsy();
        expect(isObject(null)).toBeFalsy();
        expect(isObject('x')).toBeFalsy();
    });
});

describe('mergeDeep', () => {
    test('merges nested config without dropping untouched keys', () => {
        const target = { paths: { wasm: 'a.wasm', data: 'a.data' }, useWorker: true };

        mergeDeep(target, { paths: { wasm: 'b.wasm' } });

        expect(target).toEqual({ paths: { wasm: 'b.wasm', data: 'a.data' }, useWorker: true });
    });

    test('replaces arrays instead of merging them element-wise', () => {
        const target = { env: { LIST: ['a', 'b'] } };

        mergeDeep(target, { env: { LIST: ['c'] } });

        expect(target.env.LIST).toEqual(['c']);
    });
});

describe('createInitCrossbind', () => {
    test('delegates to the worker when the config asks for one', async () => {
        const Module = moduleFactory();
        const worker = workerStub();
        const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: true }, adapter: {}, worker });

        await initNative();

        expect(worker.initWithWorker).toHaveBeenCalledTimes(1);
        expect(Module).not.toHaveBeenCalled();
    });

    test('instantiates in-process when no worker is requested', async () => {
        const Module = moduleFactory();
        const onRuntimeInitialized = vi.fn();
        const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: false }, adapter: {}, worker: workerStub() });

        const mod = await initNative({ onRuntimeInitialized });

        expect(Module).toHaveBeenCalledTimes(1);
        expect(onRuntimeInitialized).toHaveBeenCalledTimes(1);
        expect(mod).toBeTruthy();
    });

    test('memoizes, so concurrent callers share one instantiation', async () => {
        // Two instantiations mean two embind registries: a vector built by one is rejected by
        // the other ("Expected null or instance of VectorInt, got an instance of VectorInt").
        const Module = moduleFactory();
        const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: false }, adapter: {}, worker: workerStub() });

        const [a, b] = await Promise.all([initNative(), initNative()]);

        expect(Module).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
    });

    test('terminate clears the memo so a later init starts a fresh module', async () => {
        const Module = moduleFactory();
        const worker = workerStub();
        const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: false }, adapter: {}, worker });

        await initNative();
        initNative.terminate();
        await initNative();

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(Module).toHaveBeenCalledTimes(2);
    });

    test('exposes the module factory to comlink when running inside the worker', () => {
        const worker = workerStub({ isWorkerScope: true });

        createInitCrossbind({ Module: moduleFactory(), systemConfig: {}, adapter: {}, worker });

        expect(worker.exposeWorker).toHaveBeenCalledTimes(1);
    });

    test('routes wasm stdout and stderr to the configured handlers', async () => {
        const options = await captureModuleOptions({ logHandler: vi.fn(), errorHandler: vi.fn() });

        options.captured.print('out');
        options.captured.printErr('err');

        expect(options.config.logHandler).toHaveBeenCalledWith('out', 'stdout');
        expect(options.config.errorHandler).toHaveBeenCalledWith('err', 'stderr');
    });

    test('locateFile redirects the wasm and data files and applies the path prefix', async () => {
        const { captured } = await captureModuleOptions({ path: '/assets', paths: { wasm: 'x.wasm', data: 'x.data' } });

        expect(captured.locateFile('anything.wasm')).toBe('/assets/x.wasm');
        // .data always resolves to the .txt payload the loader actually serves.
        expect(captured.locateFile('anything.data')).toBe('/assets/x.data.txt');
        expect(captured.locateFile('plain.js')).toBe('/assets/plain.js');
    });

    test('toArray drains an embind vector and passes plain arrays through', async () => {
        const { captured } = await captureModuleOptions({});
        const vector = { size: () => 2, get: (i) => [7, 8][i] };

        expect(captured.toArray(vector)).toEqual([7, 8]);
        expect(captured.toArray([1, 2])).toEqual([1, 2]);
    });

    test('toVector builds the named vector class from a plain array', async () => {
        const { captured } = await captureModuleOptions({});
        const pushed = [];
        captured.VectorInt = class { push_back(v) { pushed.push(v); } };

        const vector = captured.toVector('VectorInt', [4, 5]);

        expect(pushed).toEqual([4, 5]);
        expect(vector).toBeInstanceOf(captured.VectorInt);
    });

    // WASMFS (emsdk 6.0.9) writes FS.writeFile at the end of a file that exists; the classic FS replaces the file.
    test('FS.writeFile replaces a file that exists', async () => {
        const files = new Map();
        const FS = {
            open: (path, flags) => {
                if (flags === 'w') files.set(path, '');
                return { path };
            },
            close: () => {},
            writeFile: (path, data) => files.set(path, (files.get(path) ?? '') + data),
        };
        const initNative = createInitCrossbind({ Module: vi.fn(async () => ({ FS })), systemConfig: { useWorker: false }, adapter: {}, worker: workerStub() });
        const m = await initNative();

        m.FS.writeFile('/memfs/app/note.txt', 'hello world');
        m.FS.writeFile('/memfs/app/note.txt', 'bye');

        expect(files.get('/memfs/app/note.txt')).toBe('bye');
    });

    test('does not delegate to a worker from inside the worker scope', async () => {
        const Module = moduleFactory();
        const worker = workerStub({ isWorkerScope: true });
        const initNative = createInitCrossbind({ Module, systemConfig: { useWorker: true }, adapter: {}, worker });

        await initNative();

        expect(worker.initWithWorker).not.toHaveBeenCalled();
        expect(Module).toHaveBeenCalledTimes(1);
    });
});
