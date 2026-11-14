import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

// The worker's objects, as embind hands them out after utils/embindObjectLifetime.js: `count.owned` marks a copy of a
// returned value, which JavaScript owns, and its absence a raw pointer, which stays its library's.
const owned = () => ({ ptr: 1, count: { value: 1, owned: true } });
const borrowed = () => ({ ptr: 1, count: { value: 1 } });

let deleted;

class Box {
    constructor(record) {
        this.$$ = record;
        this.width = 1;
    }

    delete() {
        this.$$.ptr = undefined;
        deleted.push(this);
    }

    isDeleted() {
        return !this.$$.ptr;
    }
}

const vectorOf = (items, record) => ({
    $$: record,
    size: () => items.length,
    get: (i) => items[i],
    delete() {
        record.ptr = undefined;
        deleted.push(this);
    },
    isDeleted: () => !record.ptr,
});

// A raw pointer a member hands out holds a clone of its owner's handle on its count, as utils/embindPointerOwners.js
// gives it; `clones` more handles share that count.
const pointerInto = (clones) => {
    const owner = new Box(owned());
    const pointer = new Box(borrowed());
    pointer.$$.count.value += clones;
    pointer.$$.count.owner = owner;
    owners.push(owner);
    return pointer;
};

let owners;
let channel;
let remote;
let m;
let watched;
let messages;

// A FinalizationRegistry that hands each test the cleanup the runtime registered for a handle, so a test collects a
// handle when it chooses. The runtime is loaded afresh, so it creates its registry from this one.
beforeEach(async () => {
    vi.resetModules();
    watched = [];
    deleted = [];
    owners = [];
    vi.stubGlobal('FinalizationRegistry', class {
        constructor(cleanup) {
            this.cleanup = cleanup;
        }

        register(target, id) {
            watched.push({ target, id, collect: () => this.cleanup(id) });
        }
    });
    const Comlink = await import('comlink');
    const worker = await import('../src/assets/js-runtime/adapters/worker-comlink.js');
    m = {
        makeBox: () => new Box(owned()),
        boxAt: () => new Box(borrowed()),
        boxInto: (clones) => pointerInto(clones),
        numbers: () => vectorOf([1, 2], owned()),
        numbersAt: () => vectorOf([3], borrowed()),
        // Globals, as emscripten::constant leaves them: owned handles the module keeps.
        counter: new Box(owned()),
        primes: vectorOf([2, 3], owned()),
    };
    worker.setCoercionModule(m);
    channel = new MessageChannel();
    messages = [];
    channel.port1.addEventListener('message', ({ data }) => messages.push(`${data.type} ${data.path.at(-1)}`));
    Comlink.expose(worker.moduleRoot(m), channel.port1);
    remote = worker.adoptModule(Comlink.wrap(channel.port2));
});

afterEach(() => {
    channel.port1.close();
    channel.port2.close();
    vi.unstubAllGlobals();
});

const watchOf = (handle) => watched.find(({ target }) => target === handle);
const forgotten = (id) => m.__crossbindHandles[id] === undefined;

describe('a vector the worker hands over as an array', () => {
    test('is freed there, as nothing else can reach it', async () => {
        expect(await remote.numbers()).toEqual([1, 2]);
        expect(deleted).toHaveLength(1);
    });

    test('stays when the worker only points at it', async () => {
        expect(await remote.numbersAt()).toEqual([3]);
        expect(deleted).toEqual([]);
    });

    test('stays when the module keeps it', async () => {
        expect(await remote.primes).toEqual([2, 3]);
        expect(await remote.primes).toEqual([2, 3]);
        expect(deleted).toEqual([]);
    });
});

describe('a handle the main thread no longer reaches', () => {
    test('frees the object the worker holds for it', async () => {
        const box = await remote.makeBox();
        const { id, collect } = watchOf(box);

        collect();

        await vi.waitFor(() => expect(deleted).toHaveLength(1));
        expect(forgotten(id)).toBe(true);
    });

    test('to a raw pointer is forgotten without freeing what it points at', async () => {
        const box = await remote.boxAt();
        const { id, collect } = watchOf(box);

        collect();

        await vi.waitFor(() => expect(forgotten(id)).toBe(true));
        expect(deleted).toEqual([]);
    });

    test('to a raw pointer a member handed out lets go of the clone of its owner the pointer holds', async () => {
        const box = await remote.boxInto(0);
        const { id, collect } = watchOf(box);

        collect();

        await vi.waitFor(() => expect(forgotten(id)).toBe(true));
        expect(deleted).toEqual(owners);
    });

    test('to such a pointer keeps that clone while another handle shares the pointer', async () => {
        const box = await remote.boxInto(1);
        const { id, collect } = watchOf(box);

        collect();

        await vi.waitFor(() => expect(forgotten(id)).toBe(true));
        expect(deleted).toEqual([]);
    });

    test('to a global the module keeps is forgotten without freeing it', async () => {
        const counter = await remote.counter;
        const { id, collect } = watchOf(counter);

        collect();

        await vi.waitFor(() => expect(forgotten(id)).toBe(true));
        expect(deleted).toEqual([]);
    });

    test('deleted by hand already is only forgotten', async () => {
        const box = await remote.makeBox();
        await box.delete();
        const { id, collect } = watchOf(box);

        collect();

        await vi.waitFor(() => expect(forgotten(id)).toBe(true));
        expect(deleted).toHaveLength(1);
    });

    test('goes to the worker in one message with the others let go of in the same task', async () => {
        const boxes = [await remote.makeBox(), await remote.makeBox()];
        messages.length = 0;

        boxes.forEach((box) => watchOf(box).collect());

        await vi.waitFor(() => expect(deleted).toHaveLength(2));
        expect(messages.filter((message) => message.endsWith('__crossbindRelease'))).toHaveLength(1);
    });
});
