import { describe, test, expect } from 'vitest';
import { queueJspiCalls } from '../src/utils/embindJspiQueue.js';

// embind__requireFunction as emscripten 6.0.9 writes it into a release glue linked with -sJSPI.
const RELEASE = 'var embind__requireFunction=(signature,rawFunction,isAsync=false)=>{signature=AsciiToString(signature);'
    + 'function makeDynCaller(){var rtn=getWasmTableEntry(rawFunction);if(isAsync){rtn=WebAssembly.promising(rtn);}return rtn}'
    + 'var fp=makeDynCaller();if(typeof fp!="function"){throwBindingError(`unknown function pointer with signature ${signature}: ${rawFunction}`);}return fp};';

// The same function in the debug glue.
const DEBUG = [
    '  var embind__requireFunction = (signature, rawFunction, isAsync = false) => {',
    '      signature = AsciiToString(signature);',
    '      function makeDynCaller() {',
    '        var rtn = getWasmTableEntry(rawFunction);',
    '        if (isAsync) {',
    '          rtn = WebAssembly.promising(rtn);',
    '        }',
    '        return rtn;',
    '      }',
    '      var fp = makeDynCaller();',
    "      if (typeof fp != 'function') {",
    '        throwBindingError(`unknown function pointer with signature ${signature}: ${rawFunction}`);',
    '      }',
    '      return fp;',
    '    };',
].join('\n');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// The rewritten glue's requireFunction over a wasm function whose calls stay suspended until released.
function suspendingBinding(glue) {
    const started = [];
    const pending = [];
    const fakeWebAssembly = {
        promising: () => (seed) => {
            started.push(seed);
            return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        },
    };
    const requireFunction = new Function('WebAssembly', 'getWasmTableEntry', 'AsciiToString', 'throwBindingError',
        `${queueJspiCalls(glue).text}\nreturn embind__requireFunction;`)(fakeWebAssembly, () => () => {}, (s) => s, (m) => { throw new Error(m); });
    return { call: requireFunction('iii', 1, true), started, pending };
}

describe('queueJspiCalls', () => {
    test.each([['release', RELEASE], ['debug', DEBUG]])('queues the async bindings of a %s glue', (_, glue) => {
        const { text, missed } = queueJspiCalls(glue);

        expect(text).toContain('rtn=crossbindJspiQueue(WebAssembly.promising(rtn))');
        expect(missed).toBe(false);
    });

    test('leaves a glue linked without JSPI as it is', () => {
        const glue = RELEASE.replace('if(isAsync){rtn=WebAssembly.promising(rtn);}', '');

        expect(queueJspiCalls(glue)).toEqual({ text: glue, missed: false });
    });

    test('reports a promising export it does not recognise', () => {
        const glue = RELEASE.replace('rtn=WebAssembly.promising(rtn);', 'rtn=WebAssembly.promising(rtn,1);');

        expect(queueJspiCalls(glue).missed).toBe(true);
    });

    // Three calls that resume first in, first out overwrote the second and third call's C stack frames.
    test('starts a call when the one before it has settled', async () => {
        const { call, started, pending } = suspendingBinding(RELEASE);

        const results = [1, 2, 3].map((seed) => call(seed));
        expect(started).toEqual([1]);

        pending[0].resolve('one');
        await flush();
        expect(started).toEqual([1, 2]);

        pending[1].reject(new Error('two'));
        await flush();
        expect(started).toEqual([1, 2, 3]);

        pending[2].resolve('three');
        expect(await Promise.allSettled(results)).toEqual([
            { status: 'fulfilled', value: 'one' }, { status: 'rejected', reason: new Error('two') }, { status: 'fulfilled', value: 'three' },
        ]);
    });

    test('starts a call at once when none is pending', async () => {
        const { call, started, pending } = suspendingBinding(DEBUG);

        call(1);
        pending[0].resolve();
        await flush();
        call(2);

        expect(started).toEqual([1, 2]);
    });
});
