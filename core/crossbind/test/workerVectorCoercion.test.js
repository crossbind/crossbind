import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as Comlink from 'comlink';
import {
    adoptModule,
    callWithVectorCoercion,
    moduleRoot,
    wrapWithVectorCoercion,
    setCoercionModule,
} from '../src/assets/js-runtime/adapters/worker-comlink.js';

class FakeVector {
    constructor() {
        this.items = [];
        this.deleted = false;
    }

    push_back(item) {
        this.items.push(item);
    }

    size() {
        return this.items.length;
    }

    get(i) {
        return this.items[i];
    }

    delete() {
        this.deleted = true;
    }
}

class VectorString extends FakeVector {}
class VectorDataset extends FakeVector {}

function bindingError(typeName, value) {
    // Mirrors embind: BindingError('Cannot pass "<value>" as a <TypeName>')
    return new Error(`Cannot pass "${value}" as a ${typeName}`);
}

describe('callWithVectorCoercion', () => {
    let created;

    beforeEach(() => {
        created = [];
        setCoercionModule({
            VectorString,
            VectorDataset,
            toVector(VectorClass, array = []) {
                const vector = new VectorClass();
                array.forEach((item) => vector.push_back(item));
                created.push(vector);
                return vector;
            },
        });
    });

    afterEach(() => {
        setCoercionModule(null);
    });

    test('converts a plain-array argument and deletes the temporary', () => {
        const fn = (dest, opts) => {
            if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
            return `ok:${opts.items.join(',')}`;
        };

        const result = callWithVectorCoercion(fn, undefined, ['/out.tif', ['-of', 'COG']]);

        expect(result).toBe('ok:-of,COG');
        expect(created).toHaveLength(1);
        expect(created[0].deleted).toBe(true);
    });

    test('passes real vectors through untouched', () => {
        const vector = new VectorString();
        vector.push_back('a');
        const fn = (opts) => {
            if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
            return opts;
        };

        const result = callWithVectorCoercion(fn, undefined, [vector]);

        expect(result).toBe(vector);
        expect(vector.deleted).toBe(false);
        expect(created).toHaveLength(0);
    });

    test('coerces mixed vector types left to right', () => {
        const fn = (dest, srcs, names, opts) => {
            if (!(srcs instanceof VectorDataset)) throw bindingError('VectorDataset', srcs);
            if (!(names instanceof VectorString)) throw bindingError('VectorString', names);
            if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
            return srcs.items.length + names.items.length + opts.items.length;
        };

        const result = callWithVectorCoercion(fn, undefined, [
            '/out.vrt', [{ dataset: true }], ['a.tif', 'b.tif'], ['-strict'],
        ]);

        expect(result).toBe(4);
        expect(created).toHaveLength(3);
        expect(created[0]).toBeInstanceOf(VectorDataset);
        expect(created[1]).toBeInstanceOf(VectorString);
        expect(created[2]).toBeInstanceOf(VectorString);
        expect(created.every((v) => v.deleted)).toBe(true);
    });

    test('rethrows the original error when the vector class is unknown', () => {
        const original = bindingError('VectorFoo', 'x');
        const fn = () => { throw original; };

        expect(() => callWithVectorCoercion(fn, undefined, [['x']])).toThrow(original);
        expect(created).toHaveLength(0);
    });

    test('rethrows when no plain-array argument remains', () => {
        const original = bindingError('VectorString', 'x');
        const fn = () => { throw original; };

        expect(() => callWithVectorCoercion(fn, undefined, ['just-a-string', 42])).toThrow(original);
    });

    test('does not engage on non-vector binding errors', () => {
        const original = new Error('Cannot pass "x" as a Dataset');
        const fn = () => { throw original; };

        expect(() => callWithVectorCoercion(fn, undefined, [['x']])).toThrow(original);
        expect(created).toHaveLength(0);
    });

    test('terminates when the callee rejects even converted vectors', () => {
        const fn = (arg) => { throw bindingError('VectorString', arg); };

        expect(() => callWithVectorCoercion(fn, undefined, [['x']])).toThrow(/VectorString/);
        expect(created).toHaveLength(1);
        expect(created[0].deleted).toBe(true);
    });

    test('defers temporary deletion until a thenable result settles', async () => {
        const fn = (opts) => {
            if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
            return Promise.resolve(opts.items.length);
        };

        const pending = callWithVectorCoercion(fn, undefined, [['a', 'b']]);

        expect(created[0].deleted).toBe(false);
        await expect(pending).resolves.toBe(2);
        expect(created[0].deleted).toBe(true);
    });
});

describe('wrapWithVectorCoercion', () => {
    beforeEach(() => {
        setCoercionModule({
            VectorString,
            toVector(VectorClass, array = []) {
                const vector = new VectorClass();
                array.forEach((item) => vector.push_back(item));
                return vector;
            },
        });
    });

    afterEach(() => {
        setCoercionModule(null);
    });

    test('coerces through nested member access with the right this', () => {
        const api = {
            label: 'module',
            ns: {
                marker: 'ns',
                method(opts) {
                    if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
                    return `${this.marker}:${opts.items.join(',')}`;
                },
            },
        };

        const wrapped = wrapWithVectorCoercion(api);

        expect(wrapped.label).toBe('module');
        expect(wrapped.ns.method(['-a', '-b'])).toBe('ns:-a,-b');
    });

    test('keeps raw `this` identity through the Comlink invocation route', () => {
        // Comlink resolves the method and its parent through the wrapper, then
        // invokes rawValue.apply(parent, args): `this` must reach the target
        // function UNWRAPPED, or embind's identity checks reject it.
        const ns = {
            method(opts) {
                if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
                return this === ns;
            },
        };
        const wrapped = wrapWithVectorCoercion({ ns });

        const rawValue = wrapped.ns.method;
        const parent = wrapped.ns;

        expect(rawValue.apply(parent, [['-a']])).toBe(true);
        expect(rawValue.call(parent, ['-b'])).toBe(true);
    });

    test('coerces plain arrays at their real positions via .apply', () => {
        const target = {
            method(dest, opts) {
                if (!(opts instanceof VectorString)) throw bindingError('VectorString', opts);
                return `${dest}:${opts.items.join(',')}`;
            },
        };
        const wrapped = wrapWithVectorCoercion(target);

        const result = wrapped.method.apply(wrapped, ['/out.tif', ['-of', 'COG']]);

        expect(result).toBe('/out.tif:-of,COG');
    });

    test('unwraps proxied arguments back to raw objects', () => {
        const dataset = { marker: 'raw' };
        const api = {
            dataset,
            use(arg) {
                return arg === dataset;
            },
        };
        const wrapped = wrapWithVectorCoercion(api);

        expect(wrapped.use(wrapped.dataset)).toBe(true);
    });

    test('leaves constructors usable', () => {
        class Thing {
            constructor(value) {
                this.value = value;
            }
        }
        const wrapped = wrapWithVectorCoercion({ Thing });

        const instance = new wrapped.Thing(7);

        expect(instance).toBeInstanceOf(Thing);
        expect(instance.value).toBe(7);
    });

    test('constructs an embind-style plain-function class (prototype identity)', () => {
        // embind classes are plain functions (writable .prototype), so a `new`
        // falling through the proxy used to build `this` on a WRAPPED prototype
        // and embind's identity check threw "Use 'new' to construct X".
        function PlainCounter(start) {
            if (Object.getPrototypeOf(this) !== PlainCounter.prototype) {
                throw new Error("Use 'new' to construct PlainCounter");
            }
            this.value = start;
        }
        const wrapped = wrapWithVectorCoercion({ PlainCounter });

        const instance = new wrapped.PlainCounter(41);

        expect(instance).toBeInstanceOf(PlainCounter);
        expect(instance.value).toBe(41);
    });
});

describe('Comlink CONSTRUCT end to end (worker construct path)', () => {
    afterEach(() => {
        setCoercionModule(null);
    });

    test('news a class through a real Comlink channel and calls the instance back', async () => {
        // The exact worker flow: the module is exposed wrapped, the main side news
        // a class through the Comlink proxy (CONSTRUCT message), the constructed
        // instance travels back through the modified 'proxy' transfer handler, and
        // instance methods keep working across the wire.
        function PlainCounter(start) {
            if (Object.getPrototypeOf(this) !== PlainCounter.prototype) {
                throw new Error("Use 'new' to construct PlainCounter");
            }
            this.value = start;
            this.deletedFlag = false;
        }
        PlainCounter.prototype.increment = function increment(by) {
            this.value += by;
            return this.value;
        };
        PlainCounter.prototype.joinTags = function joinTags(tags) {
            if (!(tags instanceof VectorString)) throw bindingError('VectorString', tags);
            return tags.items.join(',');
        };
        PlainCounter.prototype.delete = function del() {
            this.deletedFlag = true;
        };
        PlainCounter.prototype.isDeleted = function isDeleted() {
            return this.deletedFlag;
        };

        const m = {
            PlainCounter,
            VectorString,
            toVector(VectorClass, array = []) {
                const vector = new VectorClass();
                array.forEach((item) => vector.push_back(item));
                return vector;
            },
        };
        setCoercionModule(m);

        const { port1, port2 } = new MessageChannel();
        try {
            Comlink.expose(moduleRoot(m), port1);
            const remote = adoptModule(Comlink.wrap(port2));

            const counter = await new remote.PlainCounter(40);
            expect(await counter.increment(2)).toBe(42);
            // Plain-array coercion must also hold on the constructed instance.
            expect(await counter.joinTags(['a', 'b'])).toBe('a,b');
        } finally {
            port1.close();
            port2.close();
        }
    });
});

describe('Comlink returned objects end to end (worker property path)', () => {
    test('an object read from an object a property returned goes back to C++ as itself', async () => {
        // A struct field that points to another struct reads as an instance, and that instance's pointer field
        // as a handle: `(await (await cinfo.marker_list).data)`. Each hop is an embind object the worker returns
        // through the embindObject handler, and the last one must reach the next call unwrapped.
        const handles = [];
        function Embind(fields) {
            Object.assign(this, fields);
            handles.push(this);
        }
        Embind.prototype.delete = function del() {};
        Embind.prototype.isDeleted = function isDeleted() { return false; };
        const data = new Embind({});
        const marker = new Embind({ data });
        function Decoder() {
            this.marker = marker;
        }
        Decoder.prototype = Object.create(Embind.prototype);
        const m = { Decoder, isData: (value) => value === data };
        setCoercionModule(m);

        const { port1, port2 } = new MessageChannel();
        try {
            Comlink.expose(moduleRoot(m), port1);
            const remote = adoptModule(Comlink.wrap(port2));

            const decoder = await new remote.Decoder();
            const first = await decoder.marker;
            const handle = await first.data;

            expect(await remote.isData(handle)).toBe(true);
        } finally {
            port1.close();
            port2.close();
            setCoercionModule(null);
        }
    });
});
