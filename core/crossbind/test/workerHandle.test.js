import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as Comlink from 'comlink';
import {
    adoptModule, moduleOnMainThread, moduleRoot, setCoercionModule,
} from '../src/assets/js-runtime/adapters/worker-comlink.js';

function Box() {
    this.width = 1;
}
Box.prototype.delete = function del() {};
Box.prototype.isDeleted = () => false;
Box.prototype.area = function area() {
    return this.width * 4;
};

let channel;
let remote;
let moduleMessages;

// The worker's module on one end of a channel, as initWithWorker gets it on the other.
beforeEach(() => {
    const m = {
        Box,
        makeBox: () => new Box(),
        boxes: () => ({ size: () => 1, get: () => new Box(), delete() {} }),
        widthOf: (box) => box.width,
        fail: () => {
            throw new Error('native failure');
        },
    };
    setCoercionModule(m);
    channel = new MessageChannel();
    moduleMessages = [];
    channel.port1.addEventListener('message', ({ data }) => moduleMessages.push(`${data.type} ${data.path.at(-1)}`));
    Comlink.expose(moduleRoot(m), channel.port1);
    remote = adoptModule(Comlink.wrap(channel.port2));
});

afterEach(() => {
    channel.port1.close();
    channel.port2.close();
    setCoercionModule(null);
});

// The three ways the worker hands an embind object to the main thread.
const arrivals = {
    'returned by a call': () => remote.makeBox(),
    constructed: () => new remote.Box(),
    'read from a vector': async () => (await remote.boxes())[0],
};

describe('a worker handle', () => {
    test.each(Object.keys(arrivals))('%s converts to JSON and to a string as a direct-mode object does', async (arrival) => {
        const handle = await arrivals[arrival]();

        expect(JSON.stringify(handle)).toBe('{}');
        expect(String(handle)).toBe('[object Object]');
        expect(`${handle}`).toBe('[object Object]');
        expect(await handle.area()).toBe(4);
        expect(await remote.widthOf(handle)).toBe(1);
    });

    // Messages on different channels keep no order, so a write over a channel of its own could arrive after the call.
    test.each(Object.keys(arrivals))('%s takes a field write ahead of the next call on the module channel', async (arrival) => {
        const handle = await arrivals[arrival]();
        moduleMessages.length = 0;

        handle.width = 7;
        const width = await remote.widthOf(handle);

        expect(moduleMessages).toEqual(['SET width', 'APPLY widthOf']);
        expect(width).toBe(7);
    });
});

// The worker fails such a call with a TypeError from inside comlink that names nothing.
describe('a function the module does not bind', () => {
    test('fails a call with an error that names it', async () => {
        await expect(moduleOnMainThread(remote).zlibVersion()).rejects.toThrow('crossbind: zlibVersion is not bound');
    });

    test('still reads as undefined', async () => {
        expect(await moduleOnMainThread(remote).zlibVersion).toBeUndefined();
    });

    test('leaves the error of a bound function as it is', async () => {
        await expect(moduleOnMainThread(remote).fail()).rejects.toThrow('native failure');
    });

    test('leaves a bound call alone', async () => {
        expect(await moduleOnMainThread(remote).widthOf(await remote.makeBox())).toBe(1);
    });
});
