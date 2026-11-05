import {
    afterAll, beforeAll, describe, expect, test, vi,
} from 'vitest';
import { installHost } from '../../app-host/js/lean-host.js';

// The page of an Android app over a real message port: a stand-in for the activity reads what the page sends as the
// activity does, and answers from the host's functions as the activity relays the module's answers.

const TOKEN = 'android-token';
const REFUSED = "crossbind: this request does not carry the page's token";
const { port1: pagePort, port2: activityPort } = new MessageChannel();
const seen = [];
const pageIds = new Map();
let nextCall = 0;
let refusesFrames = false;

// The functions the module holds of those the page passed.
const kept = [];
const fakeModule = {
    Crossbind: { getEnv: () => '', setEnv: () => 0 },
    add: (a, b) => a + b,
    sum: (bytes) => bytes.reduce((total, byte) => total + byte, 0),
    filled: (length) => new Uint8Array(length).fill(7),
    notify: (fn, x) => (fn(x * 2) === undefined ? 'no answer' : 'answered'),
    keep: (fn) => {
        kept.push(fn);
    },
    fire: (x) => kept.at(-1)(x),
    fireAt: (index, x) => kept[index](x),
};
let refusesPolls = false;

// As the host keeps one function for each the page passed while the module holds it, counting the messages that
// passed it, and as Hermes collecting one tells the page.
const pageFunctions = new Map();
function hostPageFunction(id) {
    if (!pageFunctions.has(id)) pageFunctions.set(id, { passed: 0, fn: (...args) => globalThis.__crossbind_called(id, ...args) });
    const held = pageFunctions.get(id);
    held.passed += 1;
    return held.fn;
}

function collect(fn) {
    const [id, held] = [...pageFunctions].find(([, entry]) => entry.fn === fn);
    pageFunctions.delete(id);
    globalThis.__crossbind_dropped(id, held.passed);
}

async function until(isDone) {
    for (let i = 0; i < 200 && !isDone(); i += 1) await new Promise((resolve) => { setTimeout(resolve, 5); });
    expect(isDone()).toBe(true);
}

const messages = [];
const lastCallbackId = () => Number(messages.findLast((text) => text.includes('"cb"')).match(/"cb","v":(\d+)/)[1]);

// "<id>|m|<message>" or "<id>|r|<query>", or as an ArrayBuffer "<header length><id>|<query>" and the bytes.
activityPort.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer) {
        seen.push('frame');
        const headerLength = new DataView(data).getUint32(0, true);
        const header = new TextDecoder().decode(new Uint8Array(data, 4, headerLength));
        const bar = header.indexOf('|');
        const [id, query] = [header.slice(0, bar), header.slice(bar + 1)];
        if (refusesFrames || new URLSearchParams(query).get('t') !== TOKEN) {
            activityPort.postMessage(`${id}|!${REFUSED}`);
            return;
        }
        // As the host answers a frame once its message has.
        const call = String(nextCall);
        nextCall += 1;
        pageIds.set(call, id);
        globalThis.__crossbind_frame(call, query, data.slice(4 + headerLength));
        return;
    }
    const bar = data.indexOf('|');
    const id = data.slice(0, bar);
    const rest = data.slice(bar + 3);
    if (data[bar + 1] === 'r') {
        seen.push('result');
        const view = globalThis.__crossbind_result(rest);
        const framed = new Uint8Array(4 + view.byteLength);
        new DataView(framed.buffer).setUint32(0, Number(id), true);
        framed.set(view, 4);
        activityPort.postMessage(framed.buffer, [framed.buffer]);
        return;
    }
    seen.push('message');
    messages.push(rest);
    if (refusesPolls && rest.startsWith(`${TOKEN}["events"`)) {
        refusesPolls = false;
        activityPort.postMessage(`${id}|!${REFUSED}`);
        return;
    }
    const call = String(nextCall);
    nextCall += 1;
    pageIds.set(call, id);
    globalThis.__crossbind_receive(call, rest.slice(TOKEN.length));
};

let m;
beforeAll(async () => {
    globalThis.__host_reply = (call, text) => {
        activityPort.postMessage(`${pageIds.get(call)}|${text}`);
        pageIds.delete(call);
    };
    globalThis.__host_page_function = hostPageFunction;
    installHost(fakeModule, {});
    // What the activity's script gives the top frame before the page's own scripts run.
    globalThis.__crossbind_token = TOKEN;
    globalThis.__crossbind_port = Promise.resolve(pagePort);
    await import('../../app-host/js/page.js');
    m = await globalThis.Crossbind.initNative();
});

afterAll(() => {
    pagePort.close();
    activityPort.close();
});

describe('the page of an Android app', () => {
    test('calls the module over the port the activity handed it', async () => {
        expect(await m.add(2, 3)).toBe(5);
        expect(seen).toContain('message');
    });

    test('sends a large byte array in one frame, and takes a large result as one buffer', async () => {
        seen.length = 0;
        const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 256);

        expect(await m.sum(bytes)).toBe(bytes.reduce((total, byte) => total + byte, 0));
        const filled = await m.filled(8192);

        expect(filled).toBeInstanceOf(Uint8Array);
        expect(filled.length).toBe(8192);
        expect(filled.every((byte) => byte === 7)).toBe(true);
        expect(seen).toEqual(['frame', 'message', 'result']);
    });

    test('matches each answer to its own call when calls run at once', async () => {
        expect(await Promise.all([1, 2, 3, 4].map((n) => m.add(n, n)))).toEqual([2, 4, 6, 8]);
    });

    test("calls one of the app's own functions, which the host answers itself", async () => {
        // As the host does once the main thread has done the work.
        globalThis.__app_call = (call, name, options) => {
            const answer = name === 'app.paths' ? [0, { data: '/data', asked: options }] : [1, { name: 'Error', message: `no ${name}` }];
            globalThis.__host_reply(call, JSON.stringify(answer));
        };

        await expect(globalThis.Crossbind.app('app.paths', { a: 1 })).resolves.toEqual({ data: '/data', asked: { a: 1 } });
        await expect(globalThis.Crossbind.app('app.none', {})).rejects.toThrow('no app.none');
    });

    test('rejects a call whose frame the activity refuses, with what it answered, and goes on', async () => {
        refusesFrames = true;
        try {
            await expect(m.sum(new Uint8Array(20000))).rejects.toThrow(REFUSED);
        } finally {
            refusesFrames = false;
        }
        expect(await m.add(1, 2)).toBe(3);
    });

    test("carries bytes in a call's options and its result: in the message, in a frame, and as a large result of its own", async () => {
        const passed = [];
        // As the host answers through the module's thread, with a Uint8Array for bytes.
        globalThis.__app_call = (call, name, options) => {
            passed.push(options);
            globalThis.__crossbind_answered(call, { size: options.data.byteLength, back: options.data.slice().reverse() }, 0);
        };
        seen.length = 0;

        const small = await globalThis.Crossbind.app('probe.bytes', { data: new Uint8Array([1, 2, 3]) });
        const large = Uint8Array.from({ length: 20000 }, (_, i) => i % 251);
        const echoed = await globalThis.Crossbind.app('probe.bytes', { data: large.buffer });
        globalThis.__app_call = (call) => globalThis.__crossbind_answered(call, new Uint8Array(8192).fill(9), 0);
        const big = await globalThis.Crossbind.app('probe.big', {});

        expect(passed[0].data).toBeInstanceOf(Uint8Array);
        expect(small.size).toBe(3);
        expect(small.back).toBeInstanceOf(Uint8Array);
        expect([...small.back]).toEqual([3, 2, 1]);
        expect(passed[1].data).toEqual(large);
        expect(echoed.size).toBe(20000);
        expect(big).toBeInstanceOf(Uint8Array);
        expect(big.length).toBe(8192);
        expect(big.every((byte) => byte === 9)).toBe(true);
        expect(seen).toEqual(['message', 'frame', 'message', 'result']);
    });

    test("hands onMessage a call's messages in order, all of them before the call resolves, those after its answer too", async () => {
        const calls = [];
        globalThis.__app_call = (call, name, options, id, wantsMessages) => {
            calls.push({ id, wantsMessages });
            globalThis.__crossbind_message(id, { done: 1 });
            // The answer tells how many messages went before it, the last of which may reach the page after it.
            globalThis.__crossbind_answered(call, 'finished', 2);
            setTimeout(() => globalThis.__crossbind_message(id, { done: 2, bytes: new Uint8Array([7]) }), 30);
        };
        const got = [];

        const result = await globalThis.Crossbind.app('downloads.fetch', {}, { onMessage: (message) => got.push(message) });
        await globalThis.Crossbind.app('downloads.fetch', {});

        expect(result).toBe('finished');
        expect(got).toEqual([{ done: 1 }, { done: 2, bytes: new Uint8Array([7]) }]);
        expect(calls.map(({ wantsMessages }) => wantsMessages)).toEqual([true, false]);
        expect(calls[1].id).toBe(calls[0].id + 1);
    });

    test("rejects a call its signal aborts with the signal's reason, and tells the host, which cancels it", async () => {
        const cancelled = [];
        const called = [];
        globalThis.__app_cancel = (id) => cancelled.push(id);
        // A function that answers only once it is cancelled, as the host does then.
        globalThis.__app_call = (call, name, options, id) => called.push(id);
        const controller = new AbortController();

        const pending = globalThis.Crossbind.app('probe.wait', {}, { signal: controller.signal });
        await until(() => called.length === 1);
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await until(() => cancelled.length === 1);
        expect(cancelled).toEqual(called);
        await expect(globalThis.Crossbind.app('probe.wait', {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(called).toHaveLength(1);
    });

    test('hands onMessage the messages a function sent before it failed, then rejects', async () => {
        globalThis.__app_call = (call, name, options, id) => {
            globalThis.__crossbind_message(id, 1);
            // As the host answers a failure, with how many messages went before it.
            globalThis.__host_reply(call, JSON.stringify([1, { name: 'Error', message: 'crossbind: the import failed' }, 2]));
            setTimeout(() => globalThis.__crossbind_message(id, 2), 30);
        };
        const got = [];

        await expect(globalThis.Crossbind.app('rows.import', {}, { onMessage: (message) => got.push(message) })).rejects.toThrow('crossbind: the import failed');

        expect(got).toEqual([1, 2]);
    });

    test('lets go of a large result the page no longer waits for, and tells the host of no cancel once the call has answered', async () => {
        const cancelled = [];
        globalThis.__app_cancel = (id) => cancelled.push(id);
        let answer = null;
        globalThis.__app_call = (call, name, options, id) => {
            answer = () => globalThis.__crossbind_answered(call, new Uint8Array(8192), 0);
            if (name === 'probe.messages') {
                globalThis.__crossbind_answered(call, 'done', 1);
                answer = () => globalThis.__crossbind_message(id, 'late');
            }
        };
        seen.length = 0;
        const first = new AbortController();
        const pending = globalThis.Crossbind.app('probe.big', {}, { signal: first.signal });
        await until(() => answer !== null);
        first.abort();
        answer();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await until(() => seen.includes('result'));
        answer = null;
        const second = new AbortController();
        const waiting = globalThis.Crossbind.app('probe.messages', {}, { signal: second.signal, onMessage: () => {} });
        await until(() => answer !== null);
        await new Promise((resolve) => { setTimeout(resolve, 30); });
        second.abort();

        await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
        expect(cancelled).toHaveLength(1);
    });

    test("carries a Buffer's bytes, which its toJSON would turn into an object", async () => {
        const passed = [];
        globalThis.__app_call = (call, name, options) => {
            passed.push(options.data);
            globalThis.__crossbind_answered(call, null, 0);
        };
        class Buffer extends Uint8Array {
            toJSON() {
                return { type: 'Buffer', data: [...this] };
            }
        }

        await globalThis.Crossbind.app('probe.bytes', { data: Buffer.from([1, 2]) });

        expect(passed[0]).toBeInstanceOf(Uint8Array);
        expect([...passed[0]]).toEqual([1, 2]);
    });
});

describe('what the host pushes to the page', () => {
    test('runs a function the page passes to the module once the module calls it, without an answer for the module', async () => {
        const got = [];

        expect(await m.notify((x) => got.push(x), 21)).toBe('no answer');

        await until(() => got.length === 1);
        expect(got).toEqual([42]);
    });

    test('gives the module the same function each time the page passes one while the module holds it', async () => {
        const got = [];
        const fn = (x) => got.push(x);

        await m.keep(fn);
        await m.keep(fn);
        await m.fire(7);

        expect(kept.at(-1)).toBe(kept.at(-2));
        await until(() => got.length === 1);
        expect(got).toEqual([7]);
    });

    test('lets go of a function once the module has, and of none a message still carries', async () => {
        const fn = () => {};
        await m.keep(fn);
        const first = lastCallbackId();
        collect(kept.at(-1));
        // An answer that left the host after the push has the page take the push first.
        await m.add(0, 0);
        await m.keep(fn);
        expect(lastCallbackId()).not.toBe(first);

        const got = [];
        const carried = (x) => got.push(x);
        await m.keep(carried);
        const sent = m.keep(carried);
        collect(kept.at(-1));
        await sent;
        await m.add(0, 0);
        await m.fire(5);
        await until(() => got.length === 1);
        expect(got).toEqual([5]);
    });

    test("hands a listener the events the app's native code emits under its name, until it stops listening", async () => {
        const got = [];
        const off = globalThis.Crossbind.on('progress', (value) => got.push(value));
        const done = [];
        globalThis.Crossbind.on('done', (value) => done.push(value));
        await until(() => messages.some((text) => text.startsWith(`${TOKEN}["events"`)));

        globalThis.__crossbind_event('progress', '{"done":0.5}');
        globalThis.__crossbind_event('other', '1');
        await until(() => got.length === 1);
        off();
        globalThis.__crossbind_event('progress', '1');
        globalThis.__crossbind_event('done', 'true');
        await until(() => done.length === 1);

        expect(got).toEqual([{ done: 0.5 }]);
    });

    test('runs each listening apart, even of one listener, and a listener added as an event arrives from the next', async () => {
        const got = [];
        const listener = (value) => got.push(value);
        const offFirst = globalThis.Crossbind.on('tick', listener);
        globalThis.Crossbind.on('tick', listener);
        let added = false;
        globalThis.Crossbind.on('tick', () => {
            if (added) return;
            added = true;
            globalThis.Crossbind.on('tick', (value) => got.push(`late ${value}`));
        });

        globalThis.__crossbind_event('tick', '1');
        await until(() => got.length === 2);
        offFirst();
        globalThis.__crossbind_event('tick', '2');
        await until(() => got.length === 4);

        expect(got).toEqual([1, 1, 2, 'late 2']);
    });

    test('keeps the functions of one session apart from those of the next, which native code may still call', async () => {
        const got = [];
        await m.keep((x) => got.push(`first ${x}`));
        const firstAt = kept.length - 1;
        globalThis.Crossbind.initNative.terminate();
        const next = await globalThis.Crossbind.initNative();

        await next.keep((x) => got.push(`second ${x}`));
        await next.fire(1);
        await next.fireAt(firstAt, 2);
        await until(() => got.length === 2);

        expect(got).toEqual(['second 1', 'first 2']);
        m = next;
    });

    test('goes on running the functions the page passed after one of them throws, which the page hears of', async () => {
        const rethrown = [];
        const spy = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((task) => rethrown.push(task));
        const got = [];
        try {
            await m.keep(() => {
                throw new Error('listener boom');
            });
            await m.fire(1);
            await m.notify((x) => got.push(x), 2);
            await until(() => got.length === 1);
        } finally {
            spy.mockRestore();
        }

        expect(got).toEqual([4]);
        expect(rethrown).toHaveLength(1);
        expect(rethrown[0]).toThrow('listener boom');
    });

    test('asks again a moment after the channel failed its request for pushes', async () => {
        const got = [];
        globalThis.Crossbind.on('again', (value) => got.push(value));
        refusesPolls = true;
        // The request waiting now is answered, so the next one is refused.
        globalThis.__crossbind_event('again', '1');
        await until(() => got.length === 1 && !refusesPolls);

        globalThis.__crossbind_event('again', '2');
        await until(() => got.length === 2);

        expect(got).toEqual([1, 2]);
    });
});
