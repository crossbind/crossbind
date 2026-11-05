import { beforeAll, describe, expect, test } from 'vitest';
import { installHost } from '../../app-host/js/lean-host.js';
import { connect } from '../../app-host/js/lean-client.js';

// The two sides of an app's protocol joined in one process: the page's messages reach the host directly, and so do
// the frames and results that carry bytes, as the host's byte routes take them.

const points = [];
class Point {
    constructor(x) {
        this.x = x;
        this.freed = false;
        // JavaScript owns what it constructs, as embind marks it.
        this.$$ = { count: { owned: true } };
        points.push(this);
    }

    delete() {
        this.freed = true;
    }

    isDeleted() {
        return this.freed;
    }

    moved(dx) {
        return new Point(this.x + dx);
    }
}

class ColorValue {
    constructor(value) {
        this.value = value;
    }
}

const env = { PRESET: 'machine', CROSSBIND_DATA_PATH: '/app/data' };
const fakeModule = {
    Crossbind: {
        getEnv: (key) => env[key] ?? '',
        setEnv: (key, value, overwrite) => {
            if (overwrite || !(key in env)) env[key] = value;
            return 0;
        },
    },
    Point,
    Color: { Red: new ColorValue(0), Green: new ColorValue(1) },
    add: (a, b) => a + b,
    big: (n) => n * 2n,
    xOf: (point) => point.x,
    same: (color) => color,
    fail: () => {
        throw Object.assign(new Error('bad input'), { code: 'E_BAD' });
    },
    sum: (bytes) => bytes.reduce((total, byte) => total + byte, 0),
    byteLengthOf: (view) => view.byteLength,
    filled: (length) => new Uint8Array(length).fill(7),
};

// As the host takes messages, which come with the token it gave the page and get their replies later.
const TOKEN = 'session-token';
const REFUSED = JSON.stringify([1, { name: 'Error', message: "crossbind: this message does not carry the page's token" }]);
let nextCall = 0;
const pending = new Map();
const sent = [];
const transport = {
    send: (text) => new Promise((resolve) => {
        sent.push(text);
        if (!text.startsWith(TOKEN)) {
            resolve(REFUSED);
            return;
        }
        const call = String(nextCall);
        nextCall += 1;
        pending.set(call, resolve);
        setImmediate(() => globalThis.__crossbind_receive(call, text.slice(TOKEN.length)));
    }),
    // As the host's byte routes answer: a request without the page's token is refused.
    frame: async (query, body) => {
        requests.push('frame');
        if (new URLSearchParams(query).get('t') !== TOKEN) throw new Error("crossbind: this request does not carry the page's token");
        return globalThis.__crossbind_frame(query, body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    },
    result: async (query) => {
        requests.push('result');
        if (new URLSearchParams(query).get('t') !== TOKEN) throw new Error("crossbind: this request does not carry the page's token");
        return globalThis.__crossbind_result(query).slice().buffer;
    },
    attachBytes: 8,
    token: TOKEN,
};
const requests = [];

let m;
beforeAll(async () => {
    globalThis.__host_reply = (call, text) => {
        pending.get(call)(text);
        pending.delete(call);
    };
    installHost(fakeModule, { PRESET: 'build', DATA: '_CROSSBIND_DATA_PATH_/proj', REPLACED: 'build' });
    m = await connect(transport, { RUNTIME: '_CROSSBIND_DATA_PATH_/runtime', REPLACED: 'runtime' });
});

describe('the lean protocol of an app', () => {
    test('sends every message with the token the host gave the page', async () => {
        await m.add(1, 1);

        expect(sent.length).toBeGreaterThan(0);
        expect(sent.every((text) => text.startsWith(TOKEN))).toBe(true);
    });

    test('calls a function on the host and hands back what it returns', async () => {
        expect(await m.add(2, 3)).toBe(5);
        expect(await m.big(21n)).toBe(42n);
    });

    test('keeps an object on the host and hands the page a handle that calls it and passes back as itself', async () => {
        const point = await new m.Point(4);
        const moved = await point.moved(2);

        expect(await m.xOf(moved)).toBe(6);
        expect(points.at(-1).x).toBe(6);
    });

    test('gives an enum value one token, which goes back as the value itself', async () => {
        const red = await m.Color.Red;

        expect(await m.Color.Red).toBe(red);
        expect(red.value).toBe(0);
        expect(await m.same(red)).toBe(red);
    });

    test('rethrows a failure with the fields of its error', async () => {
        await expect(m.fail()).rejects.toMatchObject({ message: 'bad input', code: 'E_BAD' });
    });

    test('hands back a function member, awaited, as something to call or construct', async () => {
        const add = await m.add;
        const PointClass = await m.Point;
        const point = await new PointClass(3);

        expect(await add(1, 2)).toBe(3);
        expect(await m.xOf(point)).toBe(3);
    }, 1000);

    test('sends a large DataView whole', async () => {
        expect(await m.byteLengthOf(new DataView(new ArrayBuffer(64)))).toBe(64);
    });

    test('rejects a call whose frame the host refuses, with what the host answered, and goes on', async () => {
        const { frame } = transport;
        transport.frame = async () => {
            throw new Error('crossbind: bad frame');
        };
        try {
            await expect(m.sum(new Uint8Array(64))).rejects.toMatchObject({ message: 'crossbind: bad frame' });
        } finally {
            transport.frame = frame;
        }
        expect(await m.add(1, 2)).toBe(3);
    });

    test('sends a large byte array with the frame that carries it, and asks for a large result', async () => {
        requests.length = 0;
        const bytes = Uint8Array.from({ length: 64 }, (_, i) => i);

        expect(await m.sum(bytes)).toBe((63 * 64) / 2);
        const filled = await m.filled(8192);

        expect(filled).toBeInstanceOf(Uint8Array);
        expect(filled.length).toBe(8192);
        expect(filled.every((byte) => byte === 7)).toBe(true);
        expect(requests).toEqual(['frame', 'result']);
    });

    test("leaves a variable the process has to the build's env, lets initNative()'s replace one, and fills in the data path", () => {
        expect(env.PRESET).toBe('machine');
        expect(env.DATA).toBe('/app/data/proj');
        expect(env.RUNTIME).toBe('/app/data/runtime');
        expect(env.REPLACED).toBe('runtime');
    });

    test('frees an object the page owns once the page releases its last handle', async () => {
        const [, handle] = JSON.parse(await transport.send(TOKEN + JSON.stringify(['new', 0, ['Point'], [9]])));
        const point = points.at(-1);

        expect(point.freed).toBe(false);
        await transport.send(TOKEN + JSON.stringify(['release', 0, [], [[handle.v]]]));

        expect(point.freed).toBe(true);
    });

    test('frees what a page held once another page replaces it', async () => {
        const handle = await new m.Point(5);
        const point = points.at(-1);

        globalThis.__crossbind_reset();

        expect(point.freed).toBe(true);
        await expect(m.xOf(handle)).rejects.toThrow('already released');
    });
});

describe('what the host pushes to the page', () => {
    const askForPushes = () => transport.send(TOKEN + JSON.stringify(['events', 0, [], []]));

    test('holds the request for pushes until there are some, and gets the events emitted once the page asks', async () => {
        globalThis.__crossbind_reset();
        globalThis.__crossbind_event('early', '1');
        const waiting = askForPushes();
        await new Promise(setImmediate);

        globalThis.__crossbind_event('progress', '{"done":0.5}');

        expect(JSON.parse(await waiting)).toEqual([0, [['event', 'progress', { done: 0.5 }]]]);
        globalThis.__crossbind_event('later', 'null');
        expect(JSON.parse(await askForPushes())).toEqual([0, [['event', 'later', null]]]);
    });

    test('names the event whose text is no JSON', () => {
        expect(() => globalThis.__crossbind_event('broken', '{')).toThrow('the event broken carries no JSON text');
    });

    test('answers null, to stop asking, the request of a page another one replaced, and keeps none of what was for it', async () => {
        const waiting = askForPushes();
        await new Promise(setImmediate);

        globalThis.__crossbind_reset();
        globalThis.__crossbind_event('stale', '1');

        expect(JSON.parse(await waiting)).toEqual([0, null]);
        const next = askForPushes();
        await new Promise(setImmediate);
        globalThis.__crossbind_event('fresh', '2');
        expect(JSON.parse(await next)).toEqual([0, [['event', 'fresh', 2]]]);
    });

    test('answers null a request another request took the place of', async () => {
        const first = askForPushes();
        await new Promise(setImmediate);
        const second = askForPushes();
        await new Promise(setImmediate);

        expect(JSON.parse(await first)).toEqual([0, null]);
        globalThis.__crossbind_event('now', '3');
        expect(JSON.parse(await second)).toEqual([0, [['event', 'now', 3]]]);
    });

    const askForHeld = (name) => transport.send(TOKEN + JSON.stringify(['app', 0, ['events.held'], [{ name }]]));
    const hold = (name, json) => globalThis.__crossbind_event(name, json, true);
    // The page listens, and the request for pushes it makes takes the next one.
    const listenAgain = async () => {
        const next = askForPushes();
        await new Promise(setImmediate);
        globalThis.__crossbind_event('resumed', '1');
        expect(JSON.parse(await next)).toEqual([0, [['event', 'resumed', 1]]]);
    };

    test('holds the events held for the page that come before it asks for those of their name, and hands each over once', async () => {
        globalThis.__crossbind_reset();
        hold('open-url', '{"url":"myapp://launch"}');
        const waiting = askForPushes();
        await new Promise(setImmediate);
        hold('open-url', '{"url":"myapp://before"}');
        hold('tapped', '{"id":7}');
        globalThis.__crossbind_event('other', '1');
        expect(JSON.parse(await waiting)).toEqual([0, [['event', 'other', 1]]]);

        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, [{ url: 'myapp://launch' }, { url: 'myapp://before' }]]);
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, []]);
        const next = askForPushes();
        await new Promise(setImmediate);
        hold('open-url', '{"url":"myapp://later"}');
        expect(JSON.parse(await next)).toEqual([0, [['event', 'open-url', { url: 'myapp://later' }]]]);
        // The page has not asked for those of another name.
        expect(JSON.parse(await askForHeld('tapped'))).toEqual([0, [{ id: 7 }]]);
    });

    test('holds an event pushed for a page another replaced before it got it, for the new one to ask for', async () => {
        hold('open-url', '{"url":"myapp://unseen"}');
        globalThis.__crossbind_reset();
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, [{ url: 'myapp://unseen' }]]);
        await listenAgain();
    });

    // The page listens, and its request for pushes has come back, so a push waits for the next.
    const listenWithoutRequest = async () => {
        globalThis.__crossbind_reset();
        const waiting = askForPushes();
        await new Promise(setImmediate);
        globalThis.__crossbind_event('first', '1');
        await waiting;
    };

    test('holds again at a reload the held events alone that the page had not got', async () => {
        await listenWithoutRequest();
        await askForHeld('open-url');
        hold('open-url', '{"url":"myapp://held"}');
        globalThis.__crossbind_event('open-url', '{"url":"myapp://plain"}');
        globalThis.__crossbind_reset();
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, [{ url: 'myapp://held' }]]);
        await listenAgain();
    });

    test('holds again a held event that later events pushed out of those waiting, for the next ask', async () => {
        await listenWithoutRequest();
        await askForHeld('open-url');
        hold('open-url', '{"url":"myapp://oldest"}');
        for (let i = 0; i < 1000; i += 1) globalThis.__crossbind_event('tick', String(i));
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, [{ url: 'myapp://oldest' }]]);
        const [, entries] = JSON.parse(await askForPushes());
        expect([entries.length, entries.some(([, name]) => name === 'open-url')]).toEqual([1000, false]);
    });

    test('holds what comes once the page asked but before it listens', async () => {
        globalThis.__crossbind_reset();
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, []]);
        hold('open-url', '{"url":"myapp://early"}');
        expect(JSON.parse(await askForHeld('open-url'))).toEqual([0, [{ url: 'myapp://early' }]]);
        await listenAgain();
    });

    test('holds a thousand events of a name at most, and refuses an ask without a name', async () => {
        globalThis.__crossbind_reset();
        for (let i = 0; i < 1001; i += 1) hold('open-url', JSON.stringify({ url: `myapp://${i}` }));
        const [, values] = JSON.parse(await askForHeld('open-url'));
        expect([values.length, values[0], values.at(-1)]).toEqual([1000, { url: 'myapp://0' }, { url: 'myapp://999' }]);
        const [status, error] = JSON.parse(await transport.send(TOKEN + JSON.stringify(['app', 0, ['events.held'], [{}]])));
        expect(status).toBe(1);
        expect(JSON.stringify(error)).toContain('events.held takes the name of an event');
        await listenAgain();
    });

    test('keeps the latest events for a page that asks no more, up to a limit', async () => {
        for (let i = 0; i < 1005; i += 1) globalThis.__crossbind_event('tick', String(i));

        const [, entries] = JSON.parse(await askForPushes());

        expect(entries).toHaveLength(1000);
        expect(entries[0]).toEqual(['event', 'tick', 5]);
        expect(entries.at(-1)).toEqual(['event', 'tick', 1004]);
    });

    test('refuses a function the page names by no id', async () => {
        const reply = JSON.parse(await transport.send(`${TOKEN}["call",0,["add"],[{"\\u0001t":"cb","v":1e999},1]]`));

        expect(reply).toEqual([1, expect.objectContaining({ message: 'crossbind: no function of the page goes as Infinity' })]);
    });
});
