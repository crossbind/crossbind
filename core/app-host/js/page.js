// The page's crossbind.js in an app: initNative() resolves to the module the app's host runs, with the contract of a
// worker-backed web build.
import {
    concatenate, toBase64, unpack, CODEC_TAG as TAG,
} from './codec.js';
import { connect } from './lean-client.js';

// The app's host gives this to the top frame of its page alone.
const token = globalThis.__crossbind_token;

// A request the host refuses fails its call with what the host answered.
async function checked(response) {
    if (!response.ok) throw new Error((await response.text()) || `crossbind: the app's host answered ${response.status}`);
    return response;
}

// macOS, iOS and Linux: WebKit's message handler, and crossbind:// requests for the bytes.
const WEBKIT = {
    send: (text) => window.webkit.messageHandlers.crossbind.postMessage(text),
    frame: (query, body) => fetch(`crossbind://app/b/frame?${query}`, { method: 'POST', body }).then(checked).then((response) => response.text()),
    result: (query) => fetch(`crossbind://app/b/result?${query}`).then(checked).then((response) => response.arrayBuffer()),
    attachBytes: 16384,
    token,
};

// Android: the port the app hands the top frame as the page starts. A message goes as "<id>|m|<text>", a large result's
// request as "<id>|r|<query>", and a frame as one ArrayBuffer, "<header length><id>|<query>" and the bytes; an answer
// is "<id>|<text>", "<id>|!<what the host refused>", or an ArrayBuffer whose first four bytes hold the id.
function androidTransport(port) {
    const pending = new Map();
    let nextId = 1;
    port.onmessage = ({ data }) => {
        const isBytes = data instanceof ArrayBuffer;
        const bar = isBytes ? 0 : data.indexOf('|');
        const id = isBytes ? new DataView(data).getUint32(0, true) : Number(data.slice(0, bar));
        const { resolve, reject } = pending.get(id);
        pending.delete(id);
        if (isBytes) resolve(data.slice(4));
        else if (data[bar + 1] === '!') reject(new Error(data.slice(bar + 2)));
        else resolve(data.slice(bar + 1));
    };
    const call = (post) => new Promise((resolve, reject) => {
        const id = nextId;
        nextId += 1;
        pending.set(id, { resolve, reject });
        post(id);
    });
    const encoder = new TextEncoder();
    return {
        send: (text) => call((id) => port.postMessage(`${id}|m|${text}`)),
        frame: (query, body) => call((id) => {
            const header = encoder.encode(`${id}|${query}`);
            const bytes = new Uint8Array(4 + header.length + body.length);
            new DataView(bytes.buffer).setUint32(0, header.length, true);
            bytes.set(header, 4);
            bytes.set(body, 4 + header.length);
            port.postMessage(bytes.buffer, [bytes.buffer]);
        }),
        result: (query) => call((id) => port.postMessage(`${id}|r|${query}`)),
        attachBytes: 16384,
        token,
    };
}

const transport = globalThis.__crossbind_port ? globalThis.__crossbind_port.then(androidTransport) : WEBKIT;

// What the host pushes, a batch for each request the page leaves waiting for them: the events crossbind/app's
// listeners wait for, and what concerns the functions the page passed to the module, which the protocol's client takes.
// A request the channel failed is made again a moment later; one the host answers null, as when another took its place,
// is the last.
const RETRY_MS = 1000;
const listeners = new Map();
let pushedToClient = null;
let isListening = false;

// The calls of the app's functions that take messages, by the id each went with: what takes them, how many came, and
// what waits for the rest once the answer has told how many there were. Each page counts from a number of its own, so a
// cancel of the page before that comes late cancels none of its calls.
const calls = new Map();
let nextCall = 1 + crypto.getRandomValues(new Uint32Array(1))[0];

// Nothing waits for a listener, so the page hears of its failure as of any uncaught one.
function deliver(listener, value) {
    try {
        listener(value);
    } catch (error) {
        queueMicrotask(() => {
            throw error;
        });
    }
}

function received(id, value) {
    const call = calls.get(id);
    if (!call) return;
    call.received += 1;
    deliver(call.onMessage, unpack(value));
    if (call.received >= call.expected) call.done();
}

async function askForPushes(chosen) {
    try {
        return JSON.parse(await chosen.send(token + JSON.stringify(['events', 0, [], []])));
    } catch {
        await new Promise((resolve) => {
            setTimeout(resolve, RETRY_MS);
        });
        return [0, []];
    }
}

function listen() {
    if (isListening) return;
    isListening = true;
    (async () => {
        const chosen = await transport;
        for (;;) {
            const [failed, entries] = await askForPushes(chosen);
            if (failed) throw new Error(entries.message);
            if (entries === null) return;
            for (const entry of entries) {
                // A listener added as the event arrives waits for the next.
                if (entry[0] === 'event') [...(listeners.get(entry[1]) ?? [])].forEach(({ listener }) => deliver(listener, entry[2]));
                else if (entry[0] === 'msg') received(entry[1], entry[2]);
                else pushedToClient?.(entry);
            }
        }
    })().catch((error) => {
        console.error(`crossbind: the page stopped hearing from the app's host: ${error.message}`);
    }).finally(() => {
        // The next call or listener asks again; a call that waits for its messages hears no more of them.
        isListening = false;
        for (const call of calls.values()) call.fail?.(new Error("crossbind: the page stopped hearing from the app's host before the call's messages came"));
    });
}

// Calls listener with each event of this name the app's native code emits from now on, until the function it returns
// is called. Each call listens anew, as a listener passed twice runs twice.
function on(name, listener) {
    if (!token) throw new Error("crossbind: only the top frame of an app's own page reaches the app's events");
    if (!listeners.has(name)) listeners.set(name, new Set());
    const subscription = { listener };
    listeners.get(name).add(subscription);
    listen();
    return () => {
        const named = listeners.get(name);
        named?.delete(subscription);
        if (named?.size === 0) listeners.delete(name);
    };
}

let booted = null;

function initNative(config = {}) {
    if (!booted) {
        booted = token
            ? Promise.resolve(transport).then((chosen) => connect({
                ...chosen,
                listen: (handler) => {
                    pushedToClient = handler;
                    listen();
                },
            }, config.env))
            : Promise.reject(new Error("crossbind: only the top frame of an app's own page reaches the app's module"));
    }
    return booted;
}

initNative.terminate = () => {
    booted = null;
};

const isBuffer = (value) => value instanceof ArrayBuffer || (typeof SharedArrayBuffer === 'function' && value instanceof SharedArrayBuffer);

// The JSON of a call's message, each typed array, DataView and ArrayBuffer in it as its bytes: in the text, or from
// transport.attachBytes up as an attachment of its frame. A view's own toJSON, as a Buffer's, gives way to its bytes.
function bytesReplacer(attachments, attachBytes) {
    return function replace(key, value) {
        const raw = this[key];
        const view = isBuffer(raw) ? new Uint8Array(raw) : raw;
        if (!ArrayBuffer.isView(view)) return value;
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        if (bytes.byteLength < attachBytes) return { [TAG]: 'view', k: 'Uint8Array', v: toBase64(bytes) };
        attachments.push(bytes);
        return { [TAG]: 'att', i: attachments.length - 1 };
    };
}

function sendCall(chosen, text, attachments) {
    if (attachments.length === 0) return chosen.send(token + text);
    // A frame's message names the kind and the length of each attachment after its own four parts.
    const framed = `${text.slice(0, -1)},${JSON.stringify(attachments.map((bytes) => ['Uint8Array', bytes.byteLength]))}]`;
    return chosen.frame(`m=${encodeURIComponent(framed)}&t=${token}`, concatenate(attachments));
}

const isBig = (value) => value !== null && typeof value === 'object' && value[TAG] === 'big';

// A result whose bytes the host keeps for a request of their own, from a size up, or what the reply carried.
async function resultOf(chosen, value) {
    if (isBig(value)) return new Uint8Array(await chosen.result(`id=${value.v}&t=${token}`));
    return unpack(value);
}

// The host lets go of a large result once it is asked for, so one the page no longer waits for is asked for still.
function releaseResult(chosen, reply) {
    const [failed, value] = JSON.parse(reply);
    if (!failed && isBig(value)) chosen.result(`id=${value.v}&t=${token}`).catch(() => {});
}

// As fetch() rejects for an aborted signal, where an engine gives the signal no reason of its own.
const reasonOf = (signal) => signal.reason ?? new DOMException('crossbind: the call was cancelled', 'AbortError');

// One of the app's own functions, which crossbind/app calls: its answer, or the error the host gave, once the messages
// the function sent before it have reached onMessage. signal cancels it, which the host tells the function, unless it
// has answered.
async function callApp(name, options, { onMessage, signal } = {}) {
    if (!token) throw new Error("crossbind: only the top frame of an app's own page reaches the app's functions");
    if (signal?.aborted) throw reasonOf(signal);
    // Each wait of the call ends as the signal aborts, which then tells the host what it has to know.
    let onAbort = null;
    let cancel = () => {};
    const aborted = signal && new Promise((resolve, reject) => {
        onAbort = () => {
            reject(reasonOf(signal));
            cancel();
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
    aborted?.catch(() => {});
    const unlessAborted = (promise) => (aborted ? Promise.race([promise, aborted]) : promise);
    let id = 0;
    try {
        const chosen = await unlessAborted(transport);
        id = nextCall;
        nextCall += 1;
        const attachments = [];
        const text = JSON.stringify(['app', id, [name], [options, onMessage ? 1 : 0]], bytesReplacer(attachments, chosen.attachBytes));
        const call = {
            onMessage, received: 0, expected: Infinity, done: null, fail: null,
        };
        if (onMessage) {
            calls.set(id, call);
            listen();
        }
        const sending = sendCall(chosen, text, attachments);
        let isAnswered = false;
        let isRead = false;
        sending.then(() => { isAnswered = true; }, () => { isAnswered = true; });
        cancel = () => {
            calls.delete(id);
            sending.then((reply) => (isRead ? undefined : releaseResult(chosen, reply)), () => {});
            if (isAnswered) return;
            try {
                // A call in a frame may come after its cancel, which the host keeps for it.
                chosen.send(token + JSON.stringify(['cancel', id, [], [attachments.length > 0 ? 1 : 0]])).catch(() => {});
            } catch {
                // The channel went with the page.
            }
        };
        const [failed, value, sent = 0] = JSON.parse(await unlessAborted(sending));
        isRead = true;
        const result = failed ? null : resultOf(chosen, value);
        result?.catch(() => {});
        if (onMessage && call.received < sent) {
            listen();
            await unlessAborted(new Promise((resolve, reject) => {
                call.expected = sent;
                call.done = resolve;
                call.fail = reject;
            }));
        }
        if (failed) throw Object.assign(new Error(value.message), { name: value.name });
        return await unlessAborted(result);
    } finally {
        calls.delete(id);
        if (onAbort) signal.removeEventListener('abort', onAbort);
    }
}

// takesMessages: the third argument of crossbind/app's invoke() reaches the host.
globalThis.Crossbind = {
    initNative, app: callApp, on, takesMessages: true,
};
