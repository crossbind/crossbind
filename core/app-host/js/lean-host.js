// The lean protocol's host side, with the contract a worker-backed web build has: objects as handles the page releases,
// enum values with their identity, vectors returned as arrays, plain arrays coerced into vector parameters, errors
// with their own fields, and large byte arrays as attachments of a crossbind:// request. Beyond it, a function the page
// passes reaches the module as one whose calls run it in the page, later and without an answer, and the page gets the
// events the app's native code emits. Each window's page has its own of all this, by the page's id, as the host gives
// it with each message: the module is the app's one.
/* global __host_reply, __app_call, __app_cancel, __host_page_function */
import { pack, unpack, CODEC_TAG as TAG } from './codec.js';
import { setCoercionModule, unwrapCoercionProxy, wrapWithVectorCoercion } from 'crossbind/runtime/adapters/vector-coercion.js';
import { UNBOUND_MESSAGE } from 'crossbind/runtime/adapters/unboundMessage.js';

// Results holding a typed array at least this large go back as a crossbind:// response body.
const BIG_RESULT_BYTES = 4096;

// The objects the pages hold, by their handles, each with the page that holds it, and how many handles hold each.
const registry = new Map();
const owners = new Map();
const holders = new WeakMap();
let nextHandle = 1;

const enumValues = new WeakSet();
const enumIds = new WeakMap();
const enumsById = new Map();
let nextEnum = 1;

let nextBig = 1;

const MAX_WAITING_EVENTS = 1000;
const STOP = '[0,null]';
// The events the app's native code holds, by name, that came before a page asked for them with events.held() since it
// loaded: the links of app.urlSchemes among them, as open-url, the one the app was launched with too. Each reaches one
// page once, in the answer or as the event while it listens, and one pushed for a page that went goes to another that
// asked for those of its name, or waits for the next ask.
const held = new Map();
const MAX_HELD = 1000;

// What each page has:
// - the handles it holds and its large results, which go with it;
// - what it is pushed, a batch for each request it makes for them: the calls of the functions it passed, the ones the
//   module let go of, and the events of the names it listens to. Events wait for a page that asks no more, as one in
//   the background, up to a limit, past which the oldest go;
// - the call of its request for pushes, which waits for the next. One that another request replaced, or a page that
//   went, is answered null: it stops asking;
// - the names it listens to, and those it asked for the held events of;
// - the held events pushed for it, which wait for the next ask if it goes before it gets them.
const pages = new Map();

function pageOf(id) {
    let page = pages.get(id);
    if (!page) {
        page = {
            id,
            handles: new Set(),
            bigResults: new Map(),
            pushes: [],
            waitingEvents: 0,
            poll: null,
            isListening: false,
            listensTo: new Set(),
            askedFor: new Set(),
            heldPushes: new WeakSet(),
        };
        pages.set(id, page);
    }
    return page;
}

function hold(name, value) {
    const values = held.get(name) ?? [];
    if (values.length < MAX_HELD) values.push(value);
    held.set(name, values);
}

let module = null;
let root = null;

const isEmbindObject = (value) => typeof value.delete === 'function' && typeof value.isDeleted === 'function';
const isVector = (value) => isEmbindObject(value) && typeof value.size === 'function' && typeof value.get === 'function';
// What JavaScript owns, as the worker adapter decides it: a smart pointer or a copy embind marked as owned.
const ownsObject = (value) => Boolean(value.$$ && (value.$$.smartPtr || value.$$.count?.owned));

// The module's own objects, its globals above all, live as long as the module, so letting go of a handle to one
// frees nothing.
const moduleObjects = new WeakSet();

// A pointer a member handed out holds a clone of the handle of the object it points into, as the worker adapter
// releases it: the clone goes once no handle shares the pointer's count.
function releaseOwner(value) {
    const count = value?.$$?.count;
    if (!count?.owner || count.value > (value.isDeleted() ? 0 : 1)) return;
    const { owner } = count;
    count.owner = undefined;
    if (!owner.isDeleted()) owner.delete();
}

function freeIfOwned(value) {
    if (ownsObject(value) && !moduleObjects.has(value) && !value.isDeleted()) value.delete();
    releaseOwner(value);
}

function register(value, page) {
    const id = nextHandle;
    nextHandle += 1;
    registry.set(id, value);
    owners.set(id, page.id);
    page.handles.add(id);
    holders.set(value, (holders.get(value) ?? 0) + 1);
    return id;
}

// The object of a page's handle: none of another page's.
function objectOf(page, id) {
    if (owners.get(id) !== page.id) throw new Error(`crossbind: object ${id} was already released`);
    return registry.get(id);
}

function release(page, ids) {
    for (const id of ids) {
        if (owners.get(id) !== page.id) continue;
        const value = registry.get(id);
        registry.delete(id);
        owners.delete(id);
        page.handles.delete(id);
        const left = holders.get(value) - 1;
        if (left > 0) {
            holders.set(value, left);
        } else {
            holders.delete(value);
            freeIfOwned(value);
        }
    }
}

// embind hangs enum values off the enum type; an instance with a numeric value and no lifecycle methods is one.
function collectEnums() {
    for (const key of Object.keys(module)) {
        const holder = module[key];
        if (holder == null || (typeof holder !== 'object' && typeof holder !== 'function') || ArrayBuffer.isView(holder)) continue;
        for (const value of Object.values(holder)) {
            if (value != null && typeof value === 'object' && typeof value.value === 'number'
                && typeof value.delete !== 'function' && value.constructor && value.constructor !== Object) {
                enumValues.add(value);
            }
        }
    }
}

function enumIdOf(value) {
    let id = enumIds.get(value);
    if (!id) {
        id = nextEnum;
        nextEnum += 1;
        enumIds.set(value, id);
        enumsById.set(id, value);
    }
    return id;
}

// The build's env never replaces a variable the process already has; values the page passes to initNative() do.
function setEnv(env, overwrite) {
    const dataPath = module.Crossbind.getEnv('CROSSBIND_DATA_PATH');
    for (const [key, value] of Object.entries(env)) {
        module.Crossbind.setEnv(key, String(value).replace('_CROSSBIND_DATA_PATH_', dataPath), overwrite);
    }
}

function encode(value, page) {
    return pack(value, (item) => {
        if (typeof item === 'function') return { [TAG]: 'fn' };
        if (item === null || typeof item !== 'object' || ArrayBuffer.isView(item)) return undefined;
        const raw = unwrapCoercionProxy(item);
        if (enumValues.has(raw)) return { [TAG]: 'e', v: enumIdOf(raw), n: raw.value };
        if (isVector(raw)) {
            const elements = [];
            for (let i = 0; i < raw.size(); i += 1) elements.push(encode(raw.get(i), page));
            freeIfOwned(raw);
            return elements;
        }
        if (isEmbindObject(raw)) return { [TAG]: 'h', v: register(raw, page) };
        return undefined;
    });
}

// The functions a message passes, each counted as the message arrives, whatever its decoding does after, as the page
// counted them when it sent it. The host keeps one for each the page passed while the module holds it.
function pageFunctionsOf(page, value, found = new Map()) {
    if (value === null || typeof value !== 'object') return found;
    if (value[TAG] === 'cb') {
        if (!Number.isSafeInteger(value.v) || value.v < 1) throw new Error(`crossbind: no function of the page goes as ${value.v}`);
        found.set(value.v, __host_page_function(page.id, value.v));
        return found;
    }
    for (const item of Object.values(value)) pageFunctionsOf(page, item, found);
    return found;
}

function decode(page, value, attachments) {
    const pageFunctions = pageFunctionsOf(page, value);
    return unpack(value, (tag, item) => {
        if (tag === 'h') return objectOf(page, item.v);
        if (tag === 'e') return enumsById.get(item.v);
        if (tag === 'att') return attachments[item.i];
        if (tag === 'cb') return pageFunctions.get(item.v);
        return undefined;
    });
}

// What the page passed one of the app's functions: JSON values, with bytes among them.
function decodeOptions(value, attachments) {
    return unpack(value, (tag, item) => (tag === 'att' ? attachments[item.i] : undefined));
}

// A batch of pushes holds this much text beyond its first push at most: the rest waits for the page's next request.
const MAX_BATCH_TEXT = 4 * 1024 * 1024;

function flush(page) {
    if (page.poll === null || page.pushes.length === 0) return;
    const texts = [];
    let size = 0;
    while (texts.length < page.pushes.length && (texts.length === 0 || size < MAX_BATCH_TEXT)) {
        const entry = page.pushes[texts.length];
        let text;
        try {
            text = JSON.stringify(entry);
        } catch {
            // A call's message counts for the page, which gets it as null.
            text = JSON.stringify(entry[0] === 'msg' ? ['msg', entry[1], null] : ['event', entry[1], null]);
        }
        texts.push(text);
        size += text.length;
    }
    const sent = page.pushes.splice(0, texts.length);
    page.waitingEvents -= sent.filter(([kind]) => kind === 'event').length;
    const call = page.poll;
    page.poll = null;
    __host_reply(call, `[0,[${texts.join(',')}]]`);
}

function push(page, entry) {
    if (entry[0] === 'event') {
        if (page.waitingEvents === MAX_WAITING_EVENTS) {
            const [oldest] = page.pushes.splice(page.pushes.findIndex(([kind]) => kind === 'event'), 1);
            // A held event the page has not had waits for the next ask.
            if (page.heldPushes.has(oldest)) hold(oldest[1], oldest[2]);
            page.waitingEvents -= 1;
        }
        page.waitingEvents += 1;
    }
    page.pushes.push(entry);
    flush(page);
}

function encodeResult(page, op, value) {
    // What JavaScript constructs stays an object, a vector too, as the worker adapter hands out what `new` makes.
    if (op === 'new' && value !== null && typeof value === 'object' && isEmbindObject(unwrapCoercionProxy(value))) {
        return { [TAG]: 'h', v: register(unwrapCoercionProxy(value), page) };
    }
    if (ArrayBuffer.isView(value) && value.byteLength >= BIG_RESULT_BYTES) {
        const id = nextBig;
        nextBig += 1;
        page.bigResults.set(id, value);
        return { [TAG]: 'big', v: id, k: value.constructor.name };
    }
    return encode(value, page);
}

function encodeError(error) {
    const fields = { name: error?.name ?? 'Error', message: String(error?.message ?? error) };
    if (error !== null && typeof error === 'object') {
        for (const key of Object.keys(error)) {
            const item = error[key];
            if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) fields[key] = item;
        }
    }
    return fields;
}

// An operation on a path from the module, or from an object the page holds a handle to.
function dispatch(page, op, target, path, args) {
    if (op === 'release') {
        release(page, args[0]);
        return null;
    }
    if (op === 'env') {
        setEnv(args[0], true);
        return null;
    }
    const base = target === 0 ? root : wrapWithVectorCoercion(objectOf(page, target));
    const parent = path.slice(0, -1).reduce((object, key) => object[key], base);
    const key = path[path.length - 1];
    if (op === 'get') return path.length === 0 ? base : parent[key];
    if (op === 'set') {
        parent[key] = args[0];
        return true;
    }
    const member = parent[key];
    if (typeof member !== 'function') throw new Error(`crossbind: ${path.join('.')} ${UNBOUND_MESSAGE}`);
    if (op === 'new') return new member(...args);
    return member.apply(parent, args);
}

function answer(page, message, attachments) {
    const [op, target, path, args] = message;
    try {
        return JSON.stringify([0, encodeResult(page, op, dispatch(page, op, target, path, decode(page, args, attachments)))]);
    } catch (error) {
        return JSON.stringify([1, encodeError(error)]);
    }
}

// The page that listens to the events of this name, and for a held one asked for them, that is first in front among
// these pages.
function frontOf(ids, name, isHeld) {
    for (const id of ids) {
        const page = pages.get(id);
        if (page && (isHeld ? isAsking(page, name) : page.isListening && page.listensTo.has(name))) return page;
    }
    return null;
}

// Pushes a held event for the page that listens to those of its name and asked for them, or holds it for an ask.
function pushHeld(page, name, value) {
    if (!page) {
        hold(name, value);
        return;
    }
    const entry = ['event', name, value];
    page.heldPushes.add(entry);
    push(page, entry);
}

const isAsking = (page, name) => page.isListening && page.listensTo.has(name) && page.askedFor.has(name);

// A page went, by a reload or with its window: what it held, the module lets go of, and what was pushed for it
// reaches no page, but a held event it may not have got, which another page that asked for those of its name gets.
function pageWent(id) {
    const page = pages.get(id);
    if (!page) return;
    pages.delete(id);
    for (const entry of page.pushes) {
        if (page.heldPushes.has(entry)) pushHeld([...pages.values()].find((other) => isAsking(other, entry[1])), entry[1], entry[2]);
    }
    if (page.poll !== null) __host_reply(page.poll, STOP);
    release(page, [...page.handles]);
}

function viewOf(kind, buffer, offset, length) {
    const View = globalThis[kind] ?? Uint8Array;
    const bytes = new Uint8Array(buffer, offset, length);
    if (View === Uint8Array) return bytes;
    const copy = bytes.slice();
    return new View(copy.buffer, 0, length / (View.BYTES_PER_ELEMENT ?? 1));
}

function parseQuery(query) {
    const params = {};
    for (const part of query.split('&')) {
        const at = part.indexOf('=');
        params[decodeURIComponent(at < 0 ? part : part.slice(0, at))] = at < 0 ? '' : decodeURIComponent(part.slice(at + 1));
    }
    return params;
}

export function installHost(embindModule, env) {
    module = embindModule;
    // A plain array passed for a vector parameter becomes one of the module's vector classes.
    setCoercionModule(module);
    root = wrapWithVectorCoercion(module);
    collectEnums();
    for (const value of Object.values(module)) {
        if (value !== null && typeof value === 'object' && isEmbindObject(value)) moduleObjects.add(value);
    }
    setEnv(env, false);

    // A message of a page's, with the byte arrays its frame carried.
    const receive = (call, message, attachments, page) => {
        // One of the app's own functions, which the host answers once its function has, after the messages it sent
        // before, which go with the pushes.
        if (message[0] === 'app' && message[2][0] === 'events.held') {
            const name = message[3][0]?.name;
            if (typeof name !== 'string') {
                __host_reply(call, JSON.stringify([1, encodeError(new TypeError('crossbind: events.held takes the name of an event.'))]));
                return;
            }
            page.askedFor.add(name);
            const values = held.get(name) ?? [];
            held.delete(name);
            __host_reply(call, JSON.stringify([0, values]));
        } else if (message[0] === 'app') {
            const [options, wantsMessages] = message[3];
            __app_call(call, message[2][0], decodeOptions(options, attachments), message[1], wantsMessages === 1);
        } else if (message[0] === 'cancel') {
            __app_cancel(call, message[1], message[3][0] === 1);
            __host_reply(call, '[0,null]');
        } else if (message[0] === 'listen') {
            // The page listens to the events of this name from now on, or no more.
            const [name] = message[2];
            if (message[3][0] === 1) page.listensTo.add(name);
            else page.listensTo.delete(name);
            __host_reply(call, '[0,null]');
        } else if (message[0] === 'events') {
            // The page's request for pushes waits for them. A second one, as from a second copy of the page's script,
            // takes the first one's place.
            if (page.poll !== null) __host_reply(page.poll, STOP);
            page.poll = call;
            page.isListening = true;
            flush(page);
        } else {
            __host_reply(call, answer(page, message, attachments));
        }
    };

    globalThis.__crossbind_receive = (call, text, page) => receive(call, JSON.parse(text), [], pageOf(page));

    // The result of a call of one of the app's functions, with how many messages it sent before it.
    globalThis.__crossbind_answered = (call, value, sent, page) => {
        __host_reply(call, JSON.stringify([0, encodeResult(pageOf(page), 'call', value), sent]));
    };
    // A message of such a call, which the page takes with its pushes, whatever else waits there.
    globalThis.__crossbind_message = (page, id, value) => {
        const to = pageOf(page);
        push(to, ['msg', id, encode(value, to)]);
    };

    // The module called a function a page passed: the page runs it later, and the module gets no answer.
    globalThis.__crossbind_called = (page, id, ...args) => {
        const to = pageOf(page);
        push(to, ['cb', id, encode(args, to)]);
    };
    // The module let go of one, which so many messages passed it: the page keeps it for any still on their way.
    globalThis.__crossbind_dropped = (page, id, passed) => push(pageOf(page), ['drop', id, passed]);
    // An event of the app's native code: for null every page that listens to its name, for a page's id that page, and
    // for the pages in front, front first, the first of them that listens. One the code holds goes to the first in front
    // that asked for those of its name as well, and waits for an ask without one.
    globalThis.__crossbind_event = (name, json, isHeld = false, to = null) => {
        let value;
        try {
            value = JSON.parse(json);
        } catch (error) {
            // The JS thread prints it, after crossbind's name.
            throw new Error(`the event ${name} carries no JSON text: ${error.message}`, { cause: error });
        }
        if (isHeld) {
            pushHeld(frontOf(to ?? [], name, true), name, value);
            return;
        }
        let reached;
        if (to === null) reached = [...pages.values()];
        else if (Array.isArray(to)) reached = [frontOf(to, name, false)];
        else reached = [pages.get(to)];
        for (const page of reached) {
            if (page?.isListening && page.listensTo.has(name)) push(page, ['event', name, value]);
        }
    };

    // A page went, as a new one replaced it or its window closed, and its garbage collector will never release what it
    // held.
    globalThis.__crossbind_gone = (page) => pageWent(page);

    // A message in the query, its attachments one after another in the body, which the reply of call answers.
    globalThis.__crossbind_frame = (call, query, buffer, page) => {
        const message = JSON.parse(parseQuery(query).m);
        const attachments = [];
        let offset = 0;
        for (const [kind, length] of message[4]) {
            attachments.push(viewOf(kind, buffer, offset, length));
            offset += length;
        }
        receive(call, message.slice(0, 4), attachments, pageOf(page));
    };

    globalThis.__crossbind_result = (query, body, page) => {
        const results = pageOf(page).bigResults;
        const id = Number(parseQuery(query).id);
        const value = results.get(id);
        if (!value) throw new Error(`crossbind: no result ${id} waits for this page`);
        results.delete(id);
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    };
}
