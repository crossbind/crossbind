/* global WorkerGlobalScope */
import * as Comlink from 'comlink';
import { mergeDeep } from '../core.js';
import {
    callWithVectorCoercion, wrapWithVectorCoercion, setCoercionModule, unwrapCoercionProxy,
} from './vector-coercion.js';
import { patchModuleForExceptionDecode } from './exception-decode.js';
import urlPath from './path-url.js';

const isWorkerScope = typeof WorkerGlobalScope !== 'undefined'
    && typeof self !== 'undefined'
    && self instanceof WorkerGlobalScope;

// === Embind <-> Comlink Bridge ===
// Worker-side registry: id -> original embind object
// Main-thread registry: handle -> id
const embindRegistry = new Map();
const embindProxyIds = new WeakMap();
let nextEmbindId = 1;

// The objects the worker hands out are reached through the module's channel, so writes to them keep their order
// with the calls after them; messages on different channels keep none.
const HANDLES = '__crossbindHandles';
let remoteModule = null;

function registerEmbindObject(obj) {
    const id = nextEmbindId++;
    embindRegistry.set(id, obj);
    return id;
}

// Comlink answers every member with a remote one: JSON.stringify and String() called toJSON and Symbol.toPrimitive
// on the worker's object, which has neither, and a member below the module is thenable. A handle answers them as a
// direct-mode object does.
const LOCAL_MEMBERS = {
    then: undefined,
    toJSON: () => ({}),
    [Symbol.toPrimitive]: (hint) => (hint === 'number' ? NaN : '[object Object]'),
};

function handleFor(id) {
    const handle = new Proxy(remoteModule[HANDLES][id], {
        get: (target, prop) => (Object.hasOwn(LOCAL_MEMBERS, prop) ? LOCAL_MEMBERS[prop] : target[prop]),
    });
    embindProxyIds.set(handle, id);
    return handle;
}

// Reorder transfer handlers for correct priority
const _proxyHandler = Comlink.transferHandlers.get('proxy');
const _throwHandler = Comlink.transferHandlers.get('throw');
Comlink.transferHandlers.clear();

// 1. embindProxy: when a proxied embind object is sent back as an argument,
//    resolve it to the original object on the worker instead of creating a proxy-of-proxy
Comlink.transferHandlers.set('embindProxy', {
    canHandle(obj) {
        return embindProxyIds.has(obj);
    },
    serialize(obj) {
        return [embindProxyIds.get(obj), []];
    },
    deserialize(id) {
        return embindRegistry.get(id);
    },
});

// 2. proxy (modified): also registers embind objects created via CONSTRUCT
Comlink.transferHandlers.set('proxy', {
    canHandle: _proxyHandler.canHandle,
    serialize(obj) {
        if (typeof obj.delete === 'function' && typeof obj.isDeleted === 'function') {
            // CONSTRUCT results (Comlink marks them with proxy()) are handed out as
            // method-returned objects are (embindObject handler), and the registry keeps
            // the RAW object so arguments resolve back to real embind identities.
            return [{ __embindId: registerEmbindObject(unwrapCoercionProxy(obj)) }, []];
        }
        return _proxyHandler.serialize(obj);
    },
    deserialize(data) {
        if (data != null && typeof data === 'object' && '__embindId' in data) {
            return handleFor(data.__embindId);
        }
        return _proxyHandler.deserialize(data);
    },
});

// 3. throw (extended): comlink's own handler ships only message/name/stack, which drops the
// properties a binding attaches to an error - `code` above all (Rust's error code, the napi
// contract). Own enumerable primitives ride along; deserialize assigns them back onto the Error.
Comlink.transferHandlers.set('throw', {
    canHandle: _throwHandler.canHandle,
    serialize(payload) {
        const [serialized, transferables] = _throwHandler.serialize(payload);
        const error = payload && payload.value;
        if (serialized && serialized.isError && error instanceof Error) {
            for (const key of Object.keys(error)) {
                const value = error[key];
                const kind = typeof value;
                if (value === null || kind === 'string' || kind === 'number' || kind === 'boolean') {
                    serialized.value[key] = value;
                }
            }
        }
        return [serialized, transferables];
    },
    deserialize: _throwHandler.deserialize,
});

// 4. embindVector: convert embind vectors to arrays across worker boundary
Comlink.transferHandlers.set('embindVector', {
    canHandle(obj) {
        return obj != null
            && typeof obj === 'object'
            && typeof obj.size === 'function'
            && typeof obj.get === 'function'
            && typeof obj.delete === 'function';
    },
    serialize(obj) {
        const len = obj.size();
        const elements = new Array(len);
        for (let i = 0; i < len; i++) {
            const elem = obj.get(i);
            elements[i] = elem !== null && typeof elem === 'object'
                ? { __comlinkProxy: true, __embindId: registerEmbindObject(elem) }
                : elem;
        }
        return [elements, []];
    },
    deserialize(elements) {
        return elements.map((elem) => (elem && typeof elem === 'object' && elem.__comlinkProxy
            ? handleFor(elem.__embindId)
            : elem));
    },
});

// 4b. embindEnum: embind enum VALUES are class instances (not structured-cloneable) with
// singleton identity per enumerator. Worker side registers each instance under an id; the
// main thread gets a frozen, identity-stable token per id, and a token passed back as an
// argument resolves to the original instance - so `===` survives both directions.
const enumValueSet = new WeakSet();
const enumInstanceIds = new WeakMap();
const enumInstancesById = new Map();
const enumTokensById = new Map();
let nextEnumId = 1;

// Worker side, at module-ready: collect enum value instances. embind hangs enumerators off
// the enum TYPE, which is a FUNCTION (plus a `values` meta map), so both function and
// object holders are walked; a value qualifies when it is an instance (non-Object
// constructor) carrying a numeric .value and no lifecycle methods - which excludes HEAP
// views, FS, class statics and config bags.
export function registerModuleEnums(m) {
    for (const key of Object.keys(m)) {
        const holder = m[key];
        if (holder == null || (typeof holder !== 'object' && typeof holder !== 'function')
            || ArrayBuffer.isView(holder)) continue;
        for (const v of Object.values(holder)) {
            if (v != null && typeof v === 'object'
                && typeof v.value === 'number'
                && typeof v.delete !== 'function'
                && v.constructor && v.constructor !== Object) {
                enumValueSet.add(v);
            }
        }
    }
}

Comlink.transferHandlers.set('embindEnum', {
    canHandle(obj) {
        if (obj == null || typeof obj !== 'object') return false;
        return enumValueSet.has(unwrapCoercionProxy(obj)) || '__embindEnumRef' in obj;
    },
    serialize(obj) {
        const raw = unwrapCoercionProxy(obj);
        if (enumValueSet.has(raw)) {
            let id = enumInstanceIds.get(raw);
            if (!id) {
                id = nextEnumId;
                nextEnumId += 1;
                enumInstanceIds.set(raw, id);
                enumInstancesById.set(id, raw);
            }
            return [{ __embindEnumRef: id, value: raw.value }, []];
        }
        return [{ __embindEnumRef: raw.__embindEnumRef, value: raw.value }, []];
    },
    deserialize(data) {
        const real = enumInstancesById.get(data.__embindEnumRef);
        if (real) return real;
        let token = enumTokensById.get(data.__embindEnumRef);
        if (!token) {
            token = Object.freeze({ __embindEnumRef: data.__embindEnumRef, value: data.value });
            enumTokensById.set(data.__embindEnumRef, token);
        }
        return token;
    },
});

// 5. embindObject: proxy other embind objects (Dataset, etc.)
Comlink.transferHandlers.set('embindObject', {
    canHandle(obj) {
        return obj != null
            && typeof obj === 'object'
            && typeof obj.delete === 'function'
            && typeof obj.isDeleted === 'function';
    },
    serialize(obj) {
        // An object a property returns comes wrapped by its owner's coercion proxy. Registering the raw object,
        // as the proxy handler does, keeps objects read from it one wrapper deep, which an argument's unwrapping
        // undoes.
        return [{ __embindId: registerEmbindObject(unwrapCoercionProxy(obj)) }, []];
    },
    deserialize(data) {
        return handleFor(data.__embindId);
    },
});

// 6. embindProxyArray: a plain JS array that contains proxied embind objects
//    can't be structured-cloned across the
//    worker boundary, because the element proxies are functions. Resolve each
//    registered proxy element back to its worker-side original, the same way the
//    embindProxy handler does for a single argument.
Comlink.transferHandlers.set('embindProxyArray', {
    canHandle(obj) {
        return Array.isArray(obj) && obj.some((e) => embindProxyIds.has(e));
    },
    serialize(arr) {
        return [
            arr.map((e) => (embindProxyIds.has(e) ? { __embindRef: embindProxyIds.get(e) } : e)),
            [],
        ];
    },
    deserialize(arr) {
        return arr.map((e) => (e != null && typeof e === 'object' && '__embindRef' in e
            ? embindRegistry.get(e.__embindRef)
            : e));
    },
});

let _worker = null;

// Configurable, so the coercion wrapper wraps the objects read through it as it does every other member.
export function moduleRoot(m) {
    Object.defineProperty(m, HANDLES, {
        value: new Proxy({}, { get: (_, id) => embindRegistry.get(Number(id)) }),
        configurable: true,
    });
    return wrapWithVectorCoercion(m);
}

export function adoptModule(remote) {
    remoteModule = remote;
    return remote;
}

function resolveScriptUrl(config) {
    const fileName = config.paths.js || config.paths.worker;
    let prefix = urlPath.getDefaultPathPrefix();
    if (config.path) {
        prefix = config.path;
        if (prefix.slice(-1) !== '/') prefix += '/';
    }
    return urlPath.finalizePath(prefix + fileName);
}

function exposeWorker(systemConfig, createModule) {
    const workerApi = {
        async init(userConfig = {}) {
            const config = mergeDeep(systemConfig, userConfig);
            const m = await createModule(config);
            setCoercionModule(m);
            // Decode on the worker side: a real Error (with the C++ message) survives the
            // comlink throw handler, a raw WebAssembly.Exception does not.
            patchModuleForExceptionDecode(m);
            registerModuleEnums(m);
            return Comlink.proxy(moduleRoot(m));
        },
    };
    Comlink.expose(workerApi);
}

async function initWithWorker(config, userConfig) {
    const scriptUrl = config.workerUrl || resolveScriptUrl(config);
    _worker = new Worker(scriptUrl);
    const workerApi = Comlink.wrap(_worker);

    const {
        logHandler, errorHandler, onRuntimeInitialized, getWasmFunction, useWorker, workerUrl,
        ...serializableConfig
    } = userConfig;
    // The worker resolves a relative URL against its own script, so it gets the path resolved against the page.
    const workerConfig = config.path ? { ...serializableConfig, path: urlPath.finalizePath(config.path) } : serializableConfig;
    const module = adoptModule(await workerApi.init(workerConfig));

    return new Proxy(module, {
        get(target, prop) {
            if (prop === 'toArray') {
                return function toArray(vector) {
                    if (Array.isArray(vector)) return vector;
                    return target.toArray(vector);
                };
            }
            if (prop === 'toVector') {
                return function toVector(classOrName, array = []) {
                    if (typeof classOrName === 'string') {
                        return target._createVector(classOrName, array);
                    }
                    return target.toVector(classOrName, array);
                };
            }
            return target[prop];
        },
    });
}

function terminate() {
    if (_worker) {
        _worker.terminate();
        _worker = null;
    }
}

export default {
    isWorkerScope,
    exposeWorker,
    initWithWorker,
    terminate,
};

export {
    isWorkerScope, exposeWorker, initWithWorker, terminate,
    // exported for unit tests
    callWithVectorCoercion, wrapWithVectorCoercion, setCoercionModule,
};
