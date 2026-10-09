import { rejecting } from './expect.mjs';

// What SWIG skips and crossbind binds for the names a leg imports from native/confextras.h: variadic functions take
// their extra arguments by JavaScript type, function-like macros the parameter types of the function they call, a macro
// naming a function binds that function, and mutable globals arrive as handles to their storage. A leg that binds the
// header whole, imports nothing by name, so it gets SWIG's own bindings and none of these.
export function extrasChecks({ add }, x, { byName }) {
    const rejects = rejecting(add);
    add('extras:calledFunctions', async () => [
        await x.confMacroAdd_(1, 2, 100), Number(await x.confMacroLength_('ab')), await x.confMacroHalf_(5), await x.confRenamedTarget(4),
        String(await x.confMacroWide_(5)),
    ], [103, 2, 2.5, 12, '5']);
    add('extras:globalReaders', async () => [await x.confCounterValue(), await x.confGreetingValue()], [7, 'hello']);
    add('extras:struct', async () => (await new x.ConfVaBuffer()) !== null, true);
    if (!byName) {
        // Awaited on purpose: a worker proxy hands out a stub for any name, only a GET shows absence.
        add('extras:unboundWhenWhole', () => Promise.all(['confVaSum', 'confMacroAdd', 'confRenamed', 'confCounter', 'vaDouble']
            .map(async (name) => typeof (await x[name]))), ['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
        return;
    }
    add('extras:variadicNumbers', () => x.confVaSum('ilLd', 1, -2, 3n, 2.5), 4.5);
    add('extras:variadicIntegralDouble', async () => x.confVaSum('dd', await x.vaDouble(72), 0.5), 72.5);
    add('extras:variadicUnsigned', () => x.confVaSum('u', 4000000000), 4000000000);
    add('extras:variadicStringAndNull', () => x.confVaSum('sn', 'four', null), 1004);
    add('extras:variadicPointer', async () => {
        const slot = await x.allocBuffer(4);
        await x.writeNumberAt(slot, 0, 'int32', 5);
        return x.confVaSum('p', slot);
    }, 5);
    add('extras:variadicNone', () => x.confVaSum(''), 0);
    add('extras:variadicNoexcept', () => x.confVaNoexcept(3, 1, 2, 3), 6);
    // A BigInt passes its 64 bits, read as a long long; one beyond them is refused rather than wrapped.
    add('extras:variadicBigIntBits', async () => [await x.confVaSum('L', -5n), await x.confVaSum('L', 2n ** 64n - 1n)], [-5, -1]);
    rejects('extras:variadicBigIntOutOfRange', () => x.confVaSum('L', 2n ** 64n), /out of range/);
    add('extras:variadicStructAndFormat', async () => x.confVaFormat(await new x.ConfVaBuffer(), '%s-%d-%.1f', 'x', 7, 2.5), 'x-7-2.5');
    rejects('extras:variadicObjectRejected', () => x.confVaSum('i', {}), /variadic argument takes/);
    add('extras:macroCall', () => x.confMacroAdd(1, 2), 103);
    // size_t is 64 bits on React Native, where it crosses as a BigInt.
    add('extras:macroString', async () => Number(await x.confMacroLength('crossbind')), 9);
    add('extras:macroDouble', () => x.confMacroHalf(5), 2.5);
    add('extras:renamingMacro', () => x.confRenamed(4), 12);
    add('extras:macroWide', async () => String(await x.confMacroWide(2n ** 62n)), '4611686018427387904');
    rejects('extras:macroWideBigIntOutOfRange', () => x.confMacroWide(2n ** 63n), /out of range/);
    rejects('extras:macroWideNumberOutOfRange', () => x.confMacroWide(2 ** 63), /out of range/);
    add('extras:globalNumber', async () => {
        const counter = await x.confCounter;
        const before = await x.readNumberAt(counter, 0, 'int32');
        await x.writeNumberAt(counter, 0, 'int32', 9);
        const after = await x.confCounterValue();
        await x.writeNumberAt(counter, 0, 'int32', before);
        return [before, after];
    }, [7, 9]);
    // The replacement string lives in a JS-owned buffer, so the global gets its own pointer back before that goes.
    add('extras:globalPointer', async () => {
        const greeting = await x.confGreeting;
        const original = await x.readPointerAt(greeting, 0);
        const replacement = await x.cstring('hi');
        await x.writePointerAt(greeting, 0, replacement);
        const after = await x.confGreetingValue();
        await x.writePointerAt(greeting, 0, original);
        return [await x.readCString(original), after];
    }, ['hello', 'hi']);
}
