import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, test, expect } from 'vitest';

// React Native converts arguments and fields in embind-jsi's JavaScript runtime. It takes what the wasm glue takes
// after embindArgumentGuards: an enum member as an integer, a number as an enum, a one-letter string as a char.
const runtime = fileURLToPath(new URL('../../embind-jsi/js/embind.js', import.meta.url));

function registerTypes() {
    const context = vm.createContext({ console });
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(runtime, 'utf8').replace(/^export default .*$/m, ''), context);
    context.__embind_register_integer('int', 'int', 4, -2147483648, 2147483647);
    context.__embind_register_integer('char', 'char', 1, -128, 127);
    context.__embind_register_enum('hint', 'Hint', 4, false);
    const types = vm.runInContext('registeredTypes', context);
    return (id, value) => types[id].toWireType([], value);
}

describe('embind-jsi conversions', () => {
    const toWire = registerTypes();
    const member = { value: 2 };

    test('an integer takes a number or an enum member', () => {
        expect(toWire('int', 5)).toBe(5);
        expect(toWire('int', member)).toBe(2);
    });

    test('a char takes a one-letter string as its code', () => {
        expect(toWire('char', 'A')).toBe(65);
        expect(() => toWire('char', 'AB')).toThrow(/Cannot convert "AB" to char/);
    });

    test('an integer rejects what is not a number', () => {
        expect(() => toWire('int', 'x')).toThrow(/Cannot convert "x" to int/);
    });

    test('an enum takes a member or its number and rejects the rest instead of crossing as undefined', () => {
        expect(toWire('hint', 3)).toBe(3);
        expect(toWire('hint', member)).toBe(2);
        expect(() => toWire('hint', 'x')).toThrow(/Hint takes a member of the enum or its number/);
        expect(() => toWire('hint', undefined)).toThrow(/got undefined/);
    });
});
