import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

const CONFIG = { paths: { js: 'w.js' } };
const TERMINATED = { name: 'AbortError', message: expect.stringContaining('terminated') };
// A handle the main thread lets go of is released in a later task.
const RELEASE_MS = 20;

let Comlink;
let adapter;
let deleted;
let watched;
let ports;
let initOf;

class Box {
    constructor() {
        this.$$ = { ptr: 1, count: { value: 1, owned: true } };
    }

    delete() {
        this.$$.ptr = undefined;
        deleted.push(this);
    }

    isDeleted() {
        return !this.$$.ptr;
    }
}

// `never` is a job the worker is still in when it is terminated.
const moduleOf = () => ({
    makeBox: () => new Box(),
    answer: () => 42,
    never: () => new Promise(() => {}),
});

// The worker's end of initWithWorker in this thread: a channel stands for the worker's own, and init hands the module
// out as exposeWorker's does. It answers after terminate as well, so a rejection is the main thread's own doing.
class ChannelWorker {
    constructor() {
        const { port1, port2 } = new MessageChannel();
        ports.push(port1, port2);
        Comlink.expose({ init: () => initOf() }, port1);
        port2.start();
        this.postMessage = (message, transfer) => port2.postMessage(message, transfer);
        this.addEventListener = (type, listener) => port2.addEventListener(type, listener);
        this.removeEventListener = (type, listener) => port2.removeEventListener(type, listener);
        this.terminate = vi.fn();
    }
}

// The runtime is loaded afresh, so it creates its registry from the one below, which lets a test collect a handle
// when it chooses.
beforeEach(async () => {
    vi.resetModules();
    deleted = [];
    watched = [];
    ports = [];
    vi.stubGlobal('FinalizationRegistry', class {
        constructor(cleanup) {
            this.cleanup = cleanup;
        }

        register(target, id) {
            watched.push({ target, collect: () => this.cleanup(id) });
        }
    });
    vi.stubGlobal('Worker', ChannelWorker);
    Comlink = await import('comlink');
    adapter = await import('../src/assets/js-runtime/adapters/worker-comlink.js');
    initOf = () => {
        const m = moduleOf();
        adapter.setCoercionModule(m);
        return Comlink.proxy(adapter.moduleRoot(m));
    };
});

afterEach(() => {
    adapter.terminate();
    ports.forEach((port) => port.close());
    vi.unstubAllGlobals();
});

describe('terminate', () => {
    test('rejects a call the worker has not answered', async () => {
        const module = await adapter.initWithWorker(CONFIG, {});
        const job = module.never();

        adapter.terminate();

        await expect(job).rejects.toMatchObject(TERMINATED);
    });

    test('rejects the calls made afterwards on what the worker had handed out', async () => {
        const module = await adapter.initWithWorker(CONFIG, {});
        const box = await module.makeBox();

        adapter.terminate();

        await expect(module.answer()).rejects.toMatchObject(TERMINATED);
        await expect(box.isDeleted()).rejects.toMatchObject(TERMINATED);
    });

    test('rejects an init the worker has not finished', async () => {
        initOf = () => new Promise(() => {});
        const starting = adapter.initWithWorker(CONFIG, {});

        adapter.terminate();

        await expect(starting).rejects.toMatchObject(TERMINATED);
    });

    test('leaves the calls of the next worker alone', async () => {
        await adapter.initWithWorker(CONFIG, {});
        adapter.terminate();

        const module = await adapter.initWithWorker(CONFIG, {});

        expect(await module.answer()).toBe(42);
    });

    // A worker numbers its objects from one, so an id of the last worker names another object in the next.
    test('a handle of the terminated worker, once collected, frees nothing in the next one', async () => {
        const first = await adapter.initWithWorker(CONFIG, {});
        const box = await first.makeBox();
        adapter.terminate();
        await adapter.initWithWorker(CONFIG, {});

        watched.find(({ target }) => target === box).collect();
        await new Promise((resolve) => { setTimeout(resolve, RELEASE_MS); });

        expect(deleted).toEqual([]);
    });
});
