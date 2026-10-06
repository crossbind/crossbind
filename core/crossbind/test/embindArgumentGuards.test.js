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
        'embindRepr', 'assertIntegerRange',
        `${code}; return typeof __embind_register_integer !== 'undefined' ? __embind_register_integer : __embind_register_enum;`,
    );
    const registerFn = load(
        (raw, type) => { registered[raw] = type; }, (name) => name, () => null, () => null, () => 'object', () => {}, String, () => {},
    );
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

// The same two registrations in the debug glue the dev servers load, whose integer conversion throws for any object.
const DEBUG_INTEGER = [
    'var __embind_register_integer = (primitiveType, name, size, minRange, maxRange) => {',
    '  name = AsciiToString(name);',
    '  registerType(primitiveType, {',
    '    name,',
    '    fromWireType: value => value,',
    '    toWireType: (destructors, value) => {',
    '      if (typeof value != "number" && typeof value != "boolean") {',
    '        throw new TypeError(`Cannot convert "${embindRepr(value)}" to ${name}`);',
    '      }',
    '      assertIntegerRange(name, value, minRange, maxRange);',
    '      return value;',
    '    },',
    '    readValueFromPointer: integerReadValueFromPointer(name, size, minRange !== 0),',
    '    destructorFunction: null',
    '  });',
    '};',
    // The float conversion reads the same, and an enum member means nothing to a float.
    'var __embind_register_float = (rawType, name, size) => {',
    '  registerType(rawType, {',
    '    toWireType: (destructors, value) => {',
    '      if (typeof value != "number" && typeof value != "boolean") {',
    '        throw new TypeError(`Cannot convert ${embindRepr(value)} to ${this.name}`);',
    '      }',
    '      return value;',
    '    },',
    '  });',
    '};',
].join('\n');
const DEBUG_ENUM = [
    'var __embind_register_enum = (rawType, name, size, isSigned, rawValueType) => {',
    '  name = AsciiToString(name);',
    '  function ctor() {}',
    '  registerType(rawType, {',
    '    name,',
    '    constructor: ctor,',
    '    toWireType: (destructors, c) => c.value,',
    '    readValueFromPointer: enumReadValueFromPointer(name, size, isSigned),',
    '    destructorFunction: null',
    '  });',
    '  exposePublicSymbol(name, ctor);',
    '};',
].join('\n');

// Measured on e2e/web-rspack's dev server: pkgField:enumMember read 0 and pkgField:enumNumberParam took the default preset.
describe('guardEmbindArguments on a debug glue', () => {
    test('an integer parameter takes an enum member as its value and a char a one-character string', () => {
        const toInt = wireOf(guardEmbindArguments(DEBUG_INTEGER).text, (register) => register('i32', 'int', 4, -2147483648, 2147483647));
        const toChar = wireOf(guardEmbindArguments(DEBUG_INTEGER).text, (register) => register('c', 'char', 1, -128, 127));

        expect([toInt(7), toInt(true), toInt({ value: 2 }), toChar('|')]).toEqual([7, true, 2, 124]);
        expect(() => toInt({})).toThrow(/Cannot convert/);
    });

    test('a float conversion is left as it is', () => {
        const float = (glue) => glue.slice(glue.indexOf('var __embind_register_float'));

        expect(float(guardEmbindArguments(DEBUG_INTEGER).text)).toBe(float(DEBUG_INTEGER));
    });

    test('an enum parameter takes a member or its number, and nothing else', () => {
        const toWire = wireOf(guardEmbindArguments(DEBUG_ENUM).text, (register) => register('e', 'Style', 4, true, 0));

        expect([toWire({ value: 2 }), toWire(3)]).toEqual([2, 3]);
        expect(() => toWire('flat')).toThrow(/Style takes a member/);
    });

    test('reports a debug registration whose code no longer matches', () => {
        const changed = DEBUG_INTEGER.replace('toWireType: (destructors, value) => {', 'toWireType: (d, v) => {');

        expect(guardEmbindArguments(changed).missed).toEqual(['__embind_register_integer']);
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
