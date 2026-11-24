import { describe, test, expect } from 'vitest';
import { emptyOptionalAsNull } from '../src/utils/embindOptional.js';

// The val converter, the optional type built on it and its registration, as emscripten 6.0.13 writes them into a
// release glue: the registration sits in the import object under a short key.
const RELEASE = 'var EmValType={name:"emscripten::val",fromWireType:handle=>{var rv=Emval.toValue(handle);'
    + '__emval_decref(handle);return rv},toWireType:(destructors,value)=>Emval.toHandle(value),'
    + 'readValueFromPointer:readPointer,destructorFunction:null};'
    + 'var EmValOptionalType=Object.assign({optional:true},EmValType);'
    + 'var imports={j:rawOptionalType=>{registerType(rawOptionalType,EmValOptionalType);}};';

// The same code in the debug glue (comments dropped).
const DEBUG = [
    'var EmValType = {',
    "      name: 'emscripten::val',",
    '      fromWireType: (handle) => {',
    '        var rv = Emval.toValue(handle);',
    '        __emval_decref(handle);',
    '        return rv;',
    '      },',
    '      toWireType: (destructors, value) => Emval.toHandle(value),',
    '      readValueFromPointer: readPointer,',
    '      destructorFunction: null,',
    '    };',
    '  var EmValOptionalType = Object.assign({optional: true}, EmValType);',
    '  var __embind_register_optional = (rawOptionalType, rawType) => {',
    '      registerType(rawOptionalType, EmValOptionalType);',
    '    };',
].join('\n');

// The same code in a multithreaded build's debug glue, which emscripten prints within its wrapper, an object across lines.
const MULTITHREADED_DEBUG = [
    'var EmValType = {',
    '  name: "emscripten::val",',
    '  fromWireType: handle => {',
    '    var rv = Emval.toValue(handle);',
    '    __emval_decref(handle);',
    '    return rv;',
    '  },',
    '  toWireType: (destructors, value) => Emval.toHandle(value),',
    '  readValueFromPointer: readPointer,',
    '  destructorFunction: null',
    '};',
    'var EmValOptionalType = Object.assign({',
    '  optional: true',
    '}, EmValType);',
    'var __embind_register_optional = (rawOptionalType, rawType) => {',
    '  registerType(rawOptionalType, EmValOptionalType);',
    '};',
].map((line) => `\t\t\t${line}`).join('\n');

// Runs a glue's optional type against a handle table like emscripten's: C++ reads undefined as an empty optional.
function optionalType(glue) {
    const values = [];
    const Emval = {
        toHandle: (value) => values.push(value) - 1,
        toValue: (handle) => values[handle],
    };
    const type = new Function('Emval', '__emval_decref', 'readPointer', 'registerType', `${glue}\nreturn EmValOptionalType;`)(
        Emval, () => {}, () => 0, () => {},
    );
    return {
        type,
        read: (value) => type.fromWireType(Emval.toHandle(value)),
        written: (value) => values[type.toWireType(null, value)],
    };
}

describe.each([['release', RELEASE], ['debug', DEBUG], ['multithreaded debug', MULTITHREADED_DEBUG]])('an empty optional in a %s glue', (kind, glue) => {
    const { text, missed } = emptyOptionalAsNull(glue);

    test('arrives as null, and a value as itself', () => {
        const { read } = optionalType(text);

        expect(missed).toBe(false);
        expect(read(undefined)).toBe(null);
        expect([read(0), read(false), read(''), read(21)]).toEqual([0, false, '', 21]);
    });

    test('is what a null or undefined argument crosses as', () => {
        const { written } = optionalType(text);

        expect([written(null), written(undefined), written(0), written(5)]).toEqual([undefined, undefined, 0, 5]);
    });

    test('keeps the flag with which a last argument may be left out', () => {
        expect(optionalType(text).type.optional).toBe(true);
    });

    test('crossed as undefined before the rewrite', () => {
        expect(optionalType(glue).read(undefined)).toBe(undefined);
    });
});

test('a glue that registers no optional is left alone', () => {
    const glue = 'var EmValType={};';

    expect(emptyOptionalAsNull(glue)).toEqual({ text: glue, missed: false });
});

test('a glue that registers optionals some other way is reported', () => {
    const glue = RELEASE.replace('Object.assign({optional:true},EmValType)', 'makeOptionalType(EmValType)');

    expect(emptyOptionalAsNull(glue)).toEqual({ text: glue, missed: true });
});
