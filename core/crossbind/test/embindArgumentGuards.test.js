import { describe, test, expect } from 'vitest';
import { guardBigIntArguments, guardEmbindArguments } from '../src/utils/embindArgumentGuards.js';

// The two registrations as emscripten 6.0.9 writes them into a release glue file.
const INTEGER = 'var __embind_register_integer=(primitiveType,name,size,minRange,maxRange)=>{name=AsciiToString(name);const isUnsignedType=minRange===0;let fromWireType=value=>value;if(isUnsignedType){var bitshift=32-8*size;fromWireType=value=>value<<bitshift>>>bitshift;maxRange=fromWireType(maxRange);}registerType(primitiveType,{name,fromWireType,toWireType:(destructors,value)=>value,readValueFromPointer:integerReadValueFromPointer(name,size,minRange!==0),destructorFunction:null});};';
const ENUM = 'var __embind_register_enum=(rawType,name,size,isSigned,rawValueType)=>{name=AsciiToString(name);const valueType=getEnumValueType(rawValueType);switch(valueType){case "object":{function ctor(){}ctor.values={};registerType(rawType,{name,constructor:ctor,valueType,fromWireType:function(c){return this.constructor.values[c]},toWireType:(destructors,c)=>c.value,readValueFromPointer:enumReadValueFromPointer(name,size,isSigned),destructorFunction:null});exposePublicSymbol(name,ctor);break}}};';

// Runs the (rewritten) registration code and returns the toWireType it registers.
function wireOf(code, register) {
    const registered = {};
    const load = new Function(
        'registerType', 'AsciiToString', 'integerReadValueFromPointer', 'enumReadValueFromPointer', 'getEnumValueType', 'exposePublicSymbol',
        `${code}; return typeof __embind_register_integer !== 'undefined' ? __embind_register_integer : __embind_register_enum;`,
    );
    const registerFn = load((raw, type) => { registered[raw] = type; }, (name) => name, () => null, () => null, () => 'object', () => {});
    register(registerFn);
    const [type] = Object.values(registered);
    return (value) => type.toWireType([], value);
}

describe('guardEmbindArguments', () => {
    test('an integer parameter takes numbers and booleans, and an enum member as its value', () => {
        const toWire = wireOf(guardEmbindArguments(INTEGER).text, (register) => register('i32', 'int', 4, -2147483648, 2147483647));
        expect([toWire(7), toWire(true), toWire({ value: 2 })]).toEqual([7, true, 2]);
    });

    test('an integer parameter refuses what used to become 0', () => {
        const toWire = wireOf(guardEmbindArguments(INTEGER).text, (register) => register('i32', 'int', 4, -2147483648, 2147483647));
        expect(() => toWire('|')).toThrow(TypeError);
        expect(() => toWire({})).toThrow(/int takes a number/);
        expect(() => toWire(undefined)).toThrow(TypeError);
    });

    test('a char parameter takes a one-character string as its code', () => {
        const toWire = wireOf(guardEmbindArguments(INTEGER).text, (register) => register('c', 'char', 1, -128, 127));
        expect(toWire('|')).toBe(124);
        expect(() => toWire('ab')).toThrow(TypeError);
    });

    test('an enum parameter takes a member or its number, and nothing else', () => {
        const toWire = wireOf(guardEmbindArguments(ENUM).text, (register) => register('e', 'Style', 4, true, 0));
        expect([toWire({ value: 2 }), toWire(3)]).toEqual([2, 3]);
        expect(() => toWire('flat')).toThrow(/Style takes a member/);
    });

    test('reports a registration whose code no longer matches', () => {
        const changed = INTEGER.replace('toWireType:(destructors,value)=>value', 'toWireType:(d,v)=>v');
        expect(guardEmbindArguments(`${changed}${ENUM}`).missed).toEqual(['_embind_register_integer']);
        expect(guardEmbindArguments('var unrelated=1;').missed).toEqual([]);
    });
});

// The bigint conversion as emscripten writes it minified into a release glue, and spread over lines with single quotes
// into the debug glue the dev servers load.
const BIGINT_RELEASE = 'toWireType:(destructors,value)=>{if(typeof value=="number"){value=BigInt(value)}else if(typeof value!="bigint"){throw new TypeError("x")}return value}';
const BIGINT_DEBUG = "toWireType: (destructors, value) => {\n  if (typeof value == 'number') {\n    value = BigInt(value);\n  }\n  else if (typeof value != 'bigint') {\n    throw new TypeError('x');\n  }\n  return value;\n}";

describe('guardBigIntArguments', () => {
    test.each([['release', BIGINT_RELEASE], ['debug', BIGINT_DEBUG]])('a 64-bit parameter of a %s glue refuses an unsafe Number', (_, glue) => {
        const { text } = guardBigIntArguments(`var __embind_register_bigint=1;${glue}`);
        const toWireType = new Function(`return (${text.slice(text.indexOf('toWireType:') + 'toWireType:'.length)})`)();

        expect(toWireType([], 3)).toBe(3n);
        expect(() => toWireType([], 2 ** 53 + 2)).toThrow(/safe integer/);
    });

    test('reports a bigint registration whose conversion no longer matches', () => {
        expect(guardBigIntArguments('var __embind_register_bigint=1;').missed).toBe(true);
        expect(guardBigIntArguments('var unrelated=1;').missed).toBe(false);
    });
});
