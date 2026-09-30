import { describe, test, expect } from 'vitest';
import { separateCallArguments } from '../src/utils/embindCallArguments.js';

// craftInvokerFunction as emscripten 6.0.9 writes it into a release glue linked with -sDYNAMIC_EXECUTION=0.
const RELEASE = 'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc,isAsync){var argCount=argTypes.length;'
    + 'if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and receiver (this) types!");}'
    + 'var isClassMethodFunc=argTypes[1]!==null&&classType!==null;var needsDestructorStack=usesDestructorStack(argTypes);'
    + 'var returns=!argTypes[0].isVoid;var expectedArgCount=argCount-2;'
    + 'var argsWired=new Array(expectedArgCount);var invokerFuncArgs=[];var destructors=[];'
    + 'var invokerFn=function(...args){destructors.length=0;var thisWired;invokerFuncArgs.length=isClassMethodFunc?2:1;'
    + 'invokerFuncArgs[0]=cppTargetFunc;if(isClassMethodFunc){thisWired=argTypes[1].toWireType(destructors,this);invokerFuncArgs[1]=thisWired;}'
    + 'for(var i=0;i<expectedArgCount;++i){argsWired[i]=argTypes[i+2].toWireType(destructors,args[i]);invokerFuncArgs.push(argsWired[i]);}'
    + 'var rv=cppInvokerFunc(...invokerFuncArgs);function onDone(rv){if(needsDestructorStack){runDestructors(destructors);}'
    + 'else {for(var i=isClassMethodFunc?1:2;i<argTypes.length;i++){var param=i===1?thisWired:argsWired[i-2];'
    + 'if(argTypes[i].destructorFunction!==null){argTypes[i].destructorFunction(param);}}}if(returns){return argTypes[0].fromWireType(rv)}}'
    + 'if(isAsync){return rv.then(onDone)}return onDone(rv)};return createNamedFunction(humanName,invokerFn)}';

// The same function in the debug glue the dev servers load, which checks the argument count first
// (comments and blank lines dropped).
const DEBUG = [
    'function craftInvokerFunction(humanName, argTypes, classType, cppInvokerFunc, cppTargetFunc, /** boolean= */ isAsync) {',
    '      var argCount = argTypes.length;',
    '      if (argCount < 2) {',
    "        throwBindingError('argTypes array size mismatch! Must at least get return value and receiver (this) types!');",
    '      }',
    '      var isClassMethodFunc = (argTypes[1] !== null && classType !== null);',
    '      var needsDestructorStack = usesDestructorStack(argTypes);',
    '      var returns = !argTypes[0].isVoid;',
    '      var expectedArgCount = argCount - 2;',
    '      var minArgs = getRequiredArgCount(argTypes);',
    '      var argsWired = new Array(expectedArgCount);',
    '      var invokerFuncArgs = [];',
    '      var destructors = [];',
    '      var invokerFn = function(...args) {',
    '        checkArgCount(args.length, minArgs, expectedArgCount, humanName, throwBindingError);',
    '        destructors.length = 0;',
    '        var thisWired;',
    '        invokerFuncArgs.length = isClassMethodFunc ? 2 : 1;',
    '        invokerFuncArgs[0] = cppTargetFunc;',
    '        if (isClassMethodFunc) {',
    '          thisWired = argTypes[1].toWireType(destructors, this);',
    '          invokerFuncArgs[1] = thisWired;',
    '        }',
    '        for (var i = 0; i < expectedArgCount; ++i) {',
    '          argsWired[i] = argTypes[i + 2].toWireType(destructors, args[i]);',
    '          invokerFuncArgs.push(argsWired[i]);',
    '        }',
    '        var rv = cppInvokerFunc(...invokerFuncArgs);',
    '        function onDone(rv) {',
    '          if (needsDestructorStack) {',
    '            runDestructors(destructors);',
    '          } else {',
    '            for (var i = isClassMethodFunc ? 1 : 2; i < argTypes.length; i++) {',
    '              var param = i === 1 ? thisWired : argsWired[i - 2];',
    '              if (argTypes[i].destructorFunction !== null) {',
    '                argTypes[i].destructorFunction(param);',
    '              }',
    '            }',
    '          }',
    '          if (returns) {',
    '            return argTypes[0].fromWireType(rv);',
    '          }',
    '        }',
    '        if (isAsync) {',
    '          return rv.then(onDone);',
    '        }',
    '        return onDone(rv);',
    '      };',
    '      return createNamedFunction(humanName, invokerFn);',
    '    }',
].join('\n\t\t\t');

const GLUES = [['release', RELEASE], ['debug', DEBUG]];
const RETURNS_STRING = { isVoid: false, fromWireType: (value) => value };

// Pointers stand in for wasm memory: every argument gets a fresh one, and each free is recorded.
function makeHeap() {
    const values = new Map();
    const freed = [];
    let next = 1;
    return {
        malloc: (value) => {
            values.set(next, value);
            return next++;
        },
        free: (ptr) => freed.push(ptr),
        read: (ptr) => values.get(ptr),
        freed,
    };
}

// A std::string parameter the way embind wires one. Without a destructorFunction, embind frees it
// through the call's destructor list instead.
function stringParameter(heap, { destructorFunction = true } = {}) {
    return {
        toWireType(destructors, value) {
            const ptr = heap.malloc(value);
            destructors.push(heap.free, ptr);
            return ptr;
        },
        destructorFunction: destructorFunction ? heap.free : undefined,
    };
}

// Crafts an invoker from glue code, with embind's own helpers as the glue defines them.
function craft(glue, argTypes, cppInvokerFunc, isAsync) {
    const load = new Function(
        'throwBindingError', 'usesDestructorStack', 'runDestructors', 'createNamedFunction', 'getRequiredArgCount', 'checkArgCount',
        `${glue}; return craftInvokerFunction;`,
    );
    const craftInvokerFunction = load(
        (message) => {
            throw new Error(message);
        },
        (types) => types.slice(1).some((type) => type !== null && type.destructorFunction === undefined),
        (destructors) => {
            while (destructors.length) {
                const ptr = destructors.pop();
                destructors.pop()(ptr);
            }
        },
        (name, fn) => fn,
        () => 0,
        () => {},
    );
    return craftInvokerFunction('f', argTypes, null, cppInvokerFunc, 0, isAsync);
}

describe('separateCallArguments', () => {
    test.each(GLUES)('in a %s glue, two pending calls of one async function free their own arguments', async (_, glue) => {
        const heap = makeHeap();
        const text = stringParameter(heap);
        const f = craft(separateCallArguments(glue).text, [RETURNS_STRING, null, text, text],
            (fn, a, b) => Promise.resolve(`${heap.read(a)}+${heap.read(b)}`), true);

        const results = await Promise.all([f('a', 'b'), f('c', 'd')]);

        expect(results).toEqual(['a+b', 'c+d']);
        expect([...heap.freed].sort()).toEqual([1, 2, 3, 4]);
    });

    test.each(GLUES)('in a %s glue, a call made while another call of the same function runs frees its own arguments', (_, glue) => {
        const heap = makeHeap();
        const text = stringParameter(heap);
        let inner;
        const f = craft(separateCallArguments(glue).text, [RETURNS_STRING, null, text, text], (fn, a, b) => {
            if (heap.read(a) === 'outer') inner = f('x', 'y');
            return `${heap.read(a)}+${heap.read(b)}`;
        }, false);

        const outer = f('outer', 'b');

        expect([outer, inner]).toEqual(['outer+b', 'x+y']);
        expect([...heap.freed].sort()).toEqual([1, 2, 3, 4]);
    });

    test.each(GLUES)('in a %s glue, arguments freed through the destructor list stay with their call', async (_, glue) => {
        const heap = makeHeap();
        const text = stringParameter(heap, { destructorFunction: false });
        const f = craft(separateCallArguments(glue).text, [RETURNS_STRING, null, text, text],
            (fn, a, b) => Promise.resolve(`${heap.read(a)}+${heap.read(b)}`), true);

        await Promise.all([f('a', 'b'), f('c', 'd')]);

        expect([...heap.freed].sort()).toEqual([1, 2, 3, 4]);
    });

    test('rewrites a glue once', () => {
        const once = separateCallArguments(RELEASE);

        const twice = separateCallArguments(once.text);

        expect(twice.text).toBe(once.text);
        expect([once.missed, twice.missed]).toEqual([false, false]);
    });

    test('reports an invoker whose code no longer matches', () => {
        const changed = RELEASE.replace('var destructors=[];', 'let destructors=[];');

        expect(separateCallArguments(changed).missed).toBe(true);
        expect(separateCallArguments('var unrelated=1;').missed).toBe(false);
    });
});
