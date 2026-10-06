import { describe, test, expect } from 'vitest';
import * as Comlink from 'comlink';
import '../src/assets/js-runtime/adapters/worker-comlink.js';

const embindObject = () => ({ delete() {}, isDeleted: () => false, area: () => 4 });
const roundTrip = (name, value) => {
    const handler = Comlink.transferHandlers.get(name);
    return handler.deserialize(handler.serialize(value)[0]);
};

// The three ways a worker hands an embind object to the main thread.
const arrivals = {
    'returned by a call': () => roundTrip('embindObject', embindObject()),
    constructed: () => roundTrip('proxy', Comlink.proxy(embindObject())),
    'an element of a vector': () => roundTrip('embindVector', { size: () => 1, get: embindObject, delete() {} })[0],
};

describe('a worker handle', () => {
    test.each(Object.keys(arrivals))('%s converts to JSON and to a string as a direct-mode object does', async (arrival) => {
        const handle = arrivals[arrival]();

        expect(JSON.stringify(handle)).toBe('{}');
        expect(String(handle)).toBe('[object Object]');
        expect(`${handle}`).toBe('[object Object]');
        expect(await handle.area()).toBe(4);
        expect(Comlink.transferHandlers.get('embindProxy').canHandle(handle)).toBe(true);
    });
});
