import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';
import { keepPointerOwners } from '../src/utils/embindPointerOwners.js';

// The method registration and the property getter as emscripten 6.0.13 writes them into a release glue, which keys
// embind's registrations by the minified names of the wasm imports, cut down to what the rewrite reads.
const RELEASE = [
    'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){return cppInvokerFunc}',
    'var wasmImports={a:(rawClassType,methodName,argCount,rawArgTypesAddr,invokerSignature,rawInvoker,context,isPureVirtual,isAsync)=>{',
    'if(isPureVirtual)classType.registeredClass.pureVirtualFunctions.push(methodName);',
    'var memberFunction=craftInvokerFunction(humanName,argTypes,classType,rawInvoker,context,isAsync);proto[methodName]=memberFunction},',
    'b:(classType,fieldName,getterReturnType,getterSignature,getter,getterContext)=>{var desc={get(){',
    'var ptr=validateThis(this,classType,humanName+" getter");return getterReturnType.fromWireType(getter(getterContext,ptr))},enumerable:true}}};',
].join('');

// The same code in the debug glue.
const DEBUG = [
    'function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, /** boolean= */ isAsync) {',
    '    return cppInvokerFunc;',
    '  }',
    'var __embind_register_class_function = (rawClassType, methodName, argCount, rawArgTypesAddr, invokerSignature, rawInvoker, context, isPureVirtual, isAsync) => {',
    '      if (isPureVirtual) {',
    '        classType.registeredClass.pureVirtualFunctions.push(methodName);',
    '      }',
    '        var memberFunction = craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context, isAsync);',
    '  };',
    'var __embind_register_class_property = (classType, fieldName, getterReturnType, getterSignature, getter, getterContext) => {',
    '        var desc = {',
    '          get() {',
    "            var ptr = validateThis(this, classType, humanName + ' getter');",
    "            return getterReturnType['fromWireType'](getter(getterContext, ptr));",
    '          },',
    '          enumerable: true',
    '        };',
    '  };',
].join('\n');

describe('the wasm glue rewrite', () => {
    test('hands a class method and a property getter of a release glue the object they were called on', () => {
        const { text, missed } = keepPointerOwners(RELEASE);

        expect(missed).toBe(false);
        expect(text).toContain('var memberFunction=crossbindKeepsOwner(craftInvokerFunction(humanName,argTypes,classType,rawInvoker,context,isAsync),argTypes[0]);');
        expect(text).toContain('return crossbindKeepOwner(getterReturnType.fromWireType(getter(getterContext,ptr)),this)');
        expect(text.match(/function crossbindKeepOwner\(/g)).toHaveLength(1);
    });

    test('does the same in a debug glue', () => {
        const { text, missed } = keepPointerOwners(DEBUG);

        expect(missed).toBe(false);
        expect(text).toContain('var memberFunction = crossbindKeepsOwner(craftInvokerFunction(humanName, argTypes, classType, rawInvoker, context, isAsync),argTypes[0]);');
        expect(text).toContain("return crossbindKeepOwner(getterReturnType['fromWireType'](getter(getterContext, ptr)),this);");
    });

    test('takes the method registration of emscripten 6.0.9, which passes no isAsync', () => {
        const { text, missed } = keepPointerOwners(RELEASE.replace(',context,isAsync);', ',context);'));

        expect(missed).toBe(false);
        expect(text).toContain('crossbindKeepsOwner(craftInvokerFunction(humanName,argTypes,classType,rawInvoker,context),argTypes[0]);');
    });

    test('leaves a glue that binds no class method or property as it is', () => {
        const glue = 'function craftInvokerFunction(){}var func=craftInvokerFunction(humanName,invokerArgsArray,null,rawInvoker,fn,isAsync);';

        expect(keepPointerOwners(glue)).toEqual({ text: glue, missed: false });
    });

    test('reports a method registration or a getter it does not recognise, and leaves the glue as it is', () => {
        const method = RELEASE.replace('var memberFunction=', 'var method=');
        const getter = RELEASE.replace('getterReturnType.fromWireType(', 'getterReturnType.read(');

        expect(keepPointerOwners(method)).toEqual({ text: method, missed: true });
        expect(keepPointerOwners(getter)).toEqual({ text: getter, missed: true });
    });
});

const runtime = fileURLToPath(new URL('../../embind-jsi/js/embind.js', import.meta.url));
const source = fs.readFileSync(runtime, 'utf8').replace(/^export default .*$/m, '');

// embind-jsi's runtime, whose handles, clones and destructors both implementations act on, in a context whose
// FinalizationRegistry collects a handle when a test says so.
function load() {
    const watched = [];
    const context = vm.createContext({ console });
    context.globalThis = context;
    context.FinalizationRegistry = class {
        constructor(cleanup) {
            this.cleanup = cleanup;
        }

        register(target, held) {
            watched.push({ target, collect: () => this.cleanup(held) });
        }

        unregister(target) {
            watched.splice(watched.findIndex((entry) => entry.target === target), 1);
        }
    };
    vm.runInContext(source, context);
    const destroyed = [];
    const { makeClassHandle, ClassHandle } = vm.runInContext('({ makeClassHandle, ClassHandle })', context);
    const prototype = Object.create(ClassHandle.prototype);
    const classOf = (name) => ({ name, rawDestructor: (ptr) => destroyed.push(`${name} ${ptr}`) });
    return {
        context,
        destroyed,
        classOf,
        raw: (cls, ptr) => makeClassHandle(prototype, { ptrType: { registeredClass: cls }, ptr }),
        shared: (cls, ptr) => makeClassHandle(prototype, {
            ptrType: { registeredClass: cls },
            ptr,
            smartPtrType: { rawDestructor: () => destroyed.push(`${cls.name} ${ptr}`) },
            smartPtr: ptr + 1,
        }),
        collect: (handle) => watched.find((entry) => entry.target === handle).collect(),
    };
}

const wasmHelpers = (context) => vm.runInContext(`${keepPointerOwners(RELEASE).text};({ keepOwner: crossbindKeepOwner, keepsOwner: crossbindKeepsOwner })`, context);

describe.each([
    ['the wasm glue', wasmHelpers],
    ['embind-jsi', (context) => vm.runInContext('({ keepOwner, keepsOwner })', context)],
])('a pointer a member hands out, in %s', (_, pick) => {
    test('keeps the object it points into until nothing reaches the pointer either', () => {
        const runtimeApi = load();
        const { keepOwner } = pick(runtimeApi.context);
        const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
        const leaf = keepOwner(runtimeApi.raw(runtimeApi.classOf('Leaf'), 32), tree);

        runtimeApi.collect(tree);
        expect(runtimeApi.destroyed).toEqual([]);

        runtimeApi.collect(leaf.$$.count.owner);
        expect(runtimeApi.destroyed).toEqual(['Tree 16']);
    });

    test('keeps it when its handle is deleted by hand, as the worker and an app host do', () => {
        const runtimeApi = load();
        const { keepOwner } = pick(runtimeApi.context);
        const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
        const leaf = keepOwner(runtimeApi.raw(runtimeApi.classOf('Leaf'), 32), tree);

        tree.delete();
        expect(runtimeApi.destroyed).toEqual([]);

        leaf.$$.count.owner.delete();
        expect(runtimeApi.destroyed).toEqual(['Tree 16']);
    });

    test('keeps the object a NativePointer points into, and shares it with the clones of the pointer', () => {
        const runtimeApi = load();
        const { keepOwner } = pick(runtimeApi.context);
        const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
        const pointer = keepOwner(runtimeApi.shared(runtimeApi.classOf('NativePointer'), 48), tree);
        const clone = pointer.clone();

        expect(clone.$$.count.owner).toBe(pointer.$$.count.owner);
        expect(tree.$$.count.value).toBe(2);
    });

    test("leaves a copy, a smart pointer and the object's own handle alone, as they hold what they point at", () => {
        const runtimeApi = load();
        const { keepOwner } = pick(runtimeApi.context);
        const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
        const copy = runtimeApi.raw(runtimeApi.classOf('Leaf'), 32);
        copy.$$.count.owned = true;
        const shared = runtimeApi.shared(runtimeApi.classOf('Leaf'), 64);
        [copy, shared].forEach((value) => keepOwner(value, tree));
        // A raw pointer whose member hands back a handle to that same object, sharing its count.
        const node = runtimeApi.raw(runtimeApi.classOf('Node'), 80);
        const itself = keepOwner(node.clone(), node);

        expect([copy, shared, itself].map((value) => value.$$.count.owner)).toEqual([undefined, undefined, undefined]);
        expect([tree.$$.count.value, node.$$.count.value]).toEqual([1, 2]);
    });

    test('wraps only a member whose return type can hand out a pointer', () => {
        const runtimeApi = load();
        const { keepsOwner } = pick(runtimeApi.context);
        const member = () => {};
        const leaf = runtimeApi.classOf('Leaf');

        expect(keepsOwner(member, { name: 'int' })).toBe(member);
        expect(keepsOwner(member, { name: 'Leaf', registeredClass: leaf, isReference: true })).toBe(member);
        expect(keepsOwner(member, { name: 'Leaf', registeredClass: leaf, isSmartPointer: true })).toBe(member);
        expect(keepsOwner(member, { name: 'Leaf*', registeredClass: leaf })).not.toBe(member);
        expect(keepsOwner(member, { name: 'NativePointer', registeredClass: runtimeApi.classOf('NativePointer'), isSmartPointer: true })).not.toBe(member);
        expect(keepsOwner(member, { name: 'emscripten::val' })).not.toBe(member);
    });

    test('a wrapped member gets its object and arguments, and hands the pointer it returns that object', () => {
        const runtimeApi = load();
        const { keepsOwner } = pick(runtimeApi.context);
        const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
        const calls = [];
        const child = keepsOwner(function (index) {
            calls.push([this, index]);
            return runtimeApi.raw(runtimeApi.classOf('Leaf'), 32);
        }, { name: 'Leaf*', registeredClass: runtimeApi.classOf('Leaf') });

        const leaf = child.call(tree, 2);

        expect(calls).toEqual([[tree, 2]]);
        expect(leaf.$$.count.owner.$$.count).toBe(tree.$$.count);
    });
});

test('a wrapped _JSPI member of the wasm glue hands its object to the pointer its promise settles with', async () => {
    const runtimeApi = load();
    const { keepsOwner } = wasmHelpers(runtimeApi.context);
    const tree = runtimeApi.shared(runtimeApi.classOf('Tree'), 16);
    const leafClass = runtimeApi.classOf('Leaf');
    // The glue's own Promise: a _JSPI invoker returns one of its realm.
    const settled = vm.runInContext('(make) => async function () { return make(); }', runtimeApi.context)(() => runtimeApi.raw(leafClass, 32));
    const child = keepsOwner(settled, { name: 'Leaf*', registeredClass: leafClass });

    const leaf = await child.call(tree);

    expect(leaf.$$.count.owner.$$.count).toBe(tree.$$.count);
});
