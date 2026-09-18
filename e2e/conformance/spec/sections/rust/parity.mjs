// napi.rs parity: shapes that binder carries (docs/concepts/type-conversions, class, enum,
// error-handling, iterators, function) and ours does not yet. Expected JS shapes follow
// napi.rs where we have no rule of our own: Set for HashSet/BTreeSet, Record for BTreeMap,
// `{ type: 'Variant', ...fields }` for data enums (tuple fields as field0..), arrays for tuple
// structs, the inner value for newtypes, strings for fieldless enums without repr, pub fields
// as properties, getter/setter pairs as accessors, Uint8Array/Float64Array for byte and float
// slices, `code`/`message` on thrown errors, a JS Error for a Rust panic, typed callbacks,
// the iterator protocol, f32/char/usize as output-only values, i64 accepting a plain number.
export function rustParityChecks({ add, todo, skip }, s, { worker, jsi }) {
    add('rs:napi:hashSetOut', async () => [...(await s.confRsSetMake(3))].sort(), [0, 1, 2]);
    add('rs:napi:hashSetIn', () => s.confRsSetLen(new Set([1, 2, 2])), 2);
    add('rs:napi:btreeSet', async () => Array.from(await s.confRsBsetSorted(new Set([3, 1, 2]))), [1, 2, 3]);
    add('rs:napi:btreeMap', () => s.confRsBmapFirst({ b: 2, a: 1 }), 'a');
    todo('rs:napi:optionValueObject', async () => [await s.confRsOptPoint({ x: 1, y: 0.5 }), await s.confRsOptPoint(null)], [1.5, -1]);
    todo('rs:napi:optionEnum', async () => [await s.confRsOptColor(await s.ConfRsColor.Blue), await s.confRsOptColor(null)], [4, -1]);
    add('rs:napi:optionClassRef', async () => { const b = await new s.ConfRsBox(3); const r = [await s.confRsOptBox(b), await s.confRsOptBox(null)]; await b.delete(); return r; }, [3, -1]);
    // A data enum crosses in serde's own representation, not napi-rs's `{ type, field0 }`:
    // serde attributes on the enum are what reshape it.
    add('rs:napi:dataEnumIn', async () => [await s.confRsEitherDescribe({ Num: 4 }), await s.confRsEitherDescribe({ Text: 'a' })], ['num:4', 'text:a']);
    add('rs:napi:dataEnumOut', () => s.confRsEitherMake(true), { Num: 7 });
    add('rs:napi:tupleStruct', async () => { const p = await s.confRsPairMake(1, 'a'); return [p, await s.confRsPairFirst([2, 'b'])]; }, [[1, 'a'], 2]);
    add('rs:napi:newtype', () => s.confRsMetersDouble(1.5), 3);
    add('rs:napi:stringEnum', async () => s.confRsLevelName(await s.ConfRsLevel.High), 'high');
    add('rs:napi:pubFieldsAsProperties', async () => {
        const a = await new s.ConfRsAccount('me', 10);
        a.balance = 20;
        const r = [await a.owner, await a.balance, await a.secretPlus(1), await a.secret];
        await a.delete();
        return r;
    }, ['me', 20, 10, undefined]);
    add('rs:napi:getterSetterPair', async () => { const a = await new s.ConfRsAccount('me', 10); a.limit = 40; const r = [await a.limit, await a.balance]; await a.delete(); return r; }, [40, 20]);
    add('rs:napi:byteSliceIn', () => s.confRsBytesView(new Uint8Array([1, 2, 3])), 3);
    add('rs:napi:floatSliceIn', () => s.confRsFloatsSum(new Float64Array([1.5, 2.5])), 4);
    add('rs:napi:bytesOutTyped', async () => (await s.confRsBytesOwned(2)) instanceof Uint8Array, true);
    add('rs:napi:errorCode', async () => { try { await s.confRsCodedErr(); return 'no-throw'; } catch (e) { return [e instanceof Error, e.message, e.code]; } }, [true, 'coded failure', 'E_CONF']);
    // Held back on the native runtime until an RN run proves the unwinding path; on wasm the
    // panic hook already raises it as a JS Error.
    if (jsi) skip('rs:napi:panicBecomesError', 'native panic path not verified on a device yet');
    else add('rs:napi:panicBecomesError', async () => { try { await s.confRsPanics(true); return 'no-throw'; } catch (e) { return e instanceof Error && /kit panic/.test(e.message); } }, true);
    if (worker) skip('rs:napi:callbacks:*', 'JS functions cannot cross a worker boundary');
    else {
        add('rs:napi:typedCallback', () => s.confRsApplyTyped((n, tag) => `${tag}${n}`, 5), 'x5');
        // A `Send + 'static` closure is held past the call, which a JS function cannot be:
        // it is thread-affine and its handle dies with the call.
        skip('rs:napi:sendCallback', 'a JS function cannot be held as a Send + static closure');
    }
    // The protocol is called explicitly instead of spread: on a worker leg a spread drops the
    // proxy's rejected Symbol.iterator call, which surfaces as an unhandled rejection.
    todo('rs:napi:iterator', async () => {
        const it = await new s.ConfRsCounterIter(3);
        try {
            const iter = await it[Symbol.iterator]();
            const out = [];
            for (;;) {
                const step = await iter.next();
                if (step.done) return out;
                out.push(step.value);
            }
        } finally {
            await it.delete();
        }
    }, [1, 2, 3]);
    add('rs:napi:f32Out', () => s.confRsF32Out(), 0.25);
    add('rs:napi:charOut', () => s.confRsCharOut(), 'z');
    // usize is pointer-wide: a number on wasm (32-bit), a BigInt on the 64-bit native runtime.
    add('rs:napi:usizeOut', async () => { const v = await s.confRsUsizeOut(); return typeof v === 'bigint' ? v === 5n : v === 5; }, true);
    add('rs:napi:i64AcceptsNumber', () => s.confRsI64Number(41), 42n);
    todo('rs:napi:jsonBigNumber', async () => (await s.confRsJsonBig()).big, 9007199254740993n);
}
