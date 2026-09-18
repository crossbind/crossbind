import { rejecting } from './expect.mjs';

// Pointer handles: every helper and every pointer form of the binding rules (native/confpointers.h).
export function pointerChecks({ add }, p, { worker }) {
    const rejects = rejecting(add);
    const i32 = (handle, index) => p.readNumberAt(handle, index, 'int32');
    // Worker legs hand handles out as proxies (the adapter resolves them back to the object), so
    // identity is a direct-runtime contract; a handle that reads is proof enough there.
    if (worker) add('ptr:handleClass', async () => i32(await p.confPtrPrimes(), 0), 2);
    else add('ptr:handleClass', async () => (await p.confPtrPrimes()) instanceof p.NativePointer, true);
    add('ptr:numbersIn', async () => {
        const b = await p.allocBuffer(12);
        await p.writeNumberAt(b, 0, 'int32', 1);
        await p.writeNumberAt(b, 1, 'int32', 2);
        await p.writeNumberAt(b, 2, 'int32', 3);
        return p.confPtrSum(b, 3);
    }, 6);
    add('ptr:numbersOut', async () => {
        const b = await p.allocBuffer(12);
        await p.confPtrFill(b, 3, 5);
        return [await i32(b, 0), await i32(b, 2)];
    }, [5, 7]);
    add('ptr:doubles', async () => {
        const b = await p.allocBuffer(16);
        await p.writeNumberAt(b, 0, 'float64', 1.5);
        await p.writeNumberAt(b, 1, 'float64', 2.5);
        return p.confPtrMean(b, 2);
    }, 2);
    add('ptr:bytes', async () => {
        const b = await p.allocBuffer(3);
        await p.writeBytes(b, 'AB');
        return [await p.confPtrByteAt(b, 1), await p.readBytes(b, 2)];
    }, [66, 'AB']);
    add('ptr:readOnlyView', async () => i32(await p.confPtrPrimes(), 2), 5);
    rejects('ptr:readOnlyRejected', async () => p.confPtrFill(await p.confPtrPrimes(), 1, 0), /read-only/);
    add('ptr:nullPointers', async () => [await p.confPtrSum(null, 0), await p.confPtrPointSum(null)], [0, -1]);
    // Worker legs write fields over the object's own port and calls over the module's: a read-back
    // orders the writes before the call (the cpp section's fieldWrite does the same).
    add('ptr:structInstance', async () => {
        const point = await new p.ConfPtrPoint();
        point.x = 2;
        point.y = 3;
        await point.y;
        return p.confPtrPointSum(point);
    }, 23);
    add('ptr:structHandle', async () => {
        const point = await p.confPtrMakePoint(4, 5);
        const sum = await p.confPtrPointSum(point);
        await p.confPtrFreePoint(point);
        return sum;
    }, 45);
    add('ptr:opaqueHandle', async () => {
        const handle = await p.confPtrOpen(9);
        const value = await p.confPtrRead(handle);
        await p.confPtrClose(handle);
        return value;
    }, 9);
    rejects('ptr:opaqueTypeMismatch', async () => p.confPtrRead(await p.cstring('x')), /pointer type mismatch/);
    add('ptr:swapOutParams', async () => {
        const a = await p.allocBuffer(4);
        const b = await p.allocBuffer(4);
        await p.writeNumberAt(a, 0, 'int32', 1);
        await p.writeNumberAt(b, 0, 'int32', 2);
        return [await p.confPtrSwap(a, b), await i32(a, 0), await i32(b, 0)];
    }, [21, 2, 1]);
    add('ptr:voidHandle', async () => {
        const raw = await p.confPtrRaw(7);
        const tag = await p.confPtrTag(raw);
        await p.confPtrFreeRaw(raw);
        return tag;
    }, 7);
    add('ptr:pointerSlots', async () => {
        const slots = await p.allocPointer(1);
        const cell = await p.allocBuffer(4);
        await p.writeNumberAt(cell, 0, 'int32', 21);
        await p.writePointerAt(slots, 0, cell);
        const doubled = await p.confPtrDouble(slots);
        return [doubled, await i32(cell, 0), await i32(await p.readPointerAt(slots, 0), 0)];
    }, [42, 42, 42]);
    add('ptr:outReference', async () => {
        const out = await p.allocBuffer(4);
        return [await p.confPtrOutRef(out, 5), await i32(out, 0)];
    }, [5, 15]);
    add('ptr:stringReference', async () => {
        const text = await p.allocString('a');
        await p.confPtrAppend(text);
        return p.readString(text);
    }, 'a!');
    rejects('ptr:readOutOfBounds', async () => i32(await p.allocBuffer(4), 1), /out of bounds/);
    rejects('ptr:negativeSize', () => p.allocBuffer(-1), /non-negative/);
    rejects('ptr:readCStringNull', () => p.readCString(null), /null pointer/);
}
