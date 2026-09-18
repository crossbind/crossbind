import { rejecting } from './expect.mjs';

// C function pointers (native/confcallbacks.h): JS functions in slots, native pointers as handles.
export function callbackChecks({ add, skip }, c, { worker }) {
    const rejects = rejecting(add);
    add('cb:structInstance', async () => {
        const pair = await new c.ConfCbPair();
        pair.left = 5;
        pair.right = 6;
        await pair.right;
        return c.confCbPairSum(pair);
    }, 56);
    if (worker) add('cb:nativeFunctionPointer', async () => [await c.confCbApply(await c.confCbNative(), 2, 3), await c.confCbAdd(2, 3)], [5, 5]);
    else {
        add('cb:nativeFunctionPointer', async () => {
            const native = await c.confCbNative();
            return [native instanceof c.NativePointer, await c.confCbApply(native, 2, 3), await c.confCbAdd(2, 3)];
        }, [true, 5, 5]);
    }
    add('cb:nullFunction', () => c.confCbApply(null, 1, 2), -1);
    // Awaited on purpose: a worker proxy hands out a stub for any name, only a GET shows absence.
    add('cb:variadicNotBound', async () => typeof (await c.confCbVariadic), 'undefined');
    rejects('cb:numberRejected', () => c.confCbApply(42, 1, 2), /./);
    if (worker) {
        skip('cb:jsFunctions:*', 'JS functions cannot cross a worker boundary');
        return;
    }
    add('cb:jsFunction', () => c.confCbApply((a, b) => a * 10 + b, 3, 4), 34);
    add('cb:stringArgument', async () => {
        let got;
        const doubled = await c.confCbNotify((message, level) => { got = [message, level]; }, 'hi', 2);
        return [got, doubled];
    }, [['hi', 2], 4]);
    add('cb:nullStringArgument', async () => {
        let got = 'unset';
        await c.confCbNotify((message) => { got = message; }, null, 1);
        return got;
    }, null);
    add('cb:doubleRoundTrip', () => c.confCbScaleTwice((v) => v * 2, 1.5), 6);
    // A pointer argument reaches the JS function as a handle: read it through the helpers.
    add('cb:pointerArgument', async () => {
        let handle = false;
        const sum = await c.confCbWithPair((pair) => {
            handle = pair instanceof c.NativePointer;
            return c.readNumberAt(pair, 0, 'int32') * 10 + c.readNumberAt(pair, 1, 'int32');
        }, 3, 4);
        return [sum, handle];
    }, [34, true]);
    add('cb:sameFunctionTwice', async () => {
        const f = (a, b) => a - b;
        return [await c.confCbApply(f, 5, 1), await c.confCbApply(f, 9, 2)];
    }, [4, 7]);
    // A released slot answers with a zero result and a stderr line, never a crash.
    add('cb:retainRelease', async () => {
        const f = (a, b) => a - b;
        await c.confCbRetain(f);
        const before = await c.confCbCallRetained(9, 4);
        const released = await c.releaseCallback(f);
        const after = await c.confCbCallRetained(9, 4);
        return [before, released, after];
    }, [5, true, 0]);
}
