// Rust collections: a Vec, slice, array, tuple, map or set crosses as a plain JS array or
// object (a deep copy through the JSON wire); the declared vector classes stay available for
// element-by-element access.
export function rustCollectionChecks({ add, todo }, s) {
    add('rs:coll:vectorClass', async () => {
        const v = await new s.ConfRsIntVector();
        await v.push_back(4);
        await v.push_back(5);
        const r = [await v.size(), await v.get(1)];
        await v.delete();
        return r;
    }, [2, 5]);
    add('rs:coll:vecParam', () => s.confRsIntsSum([1, 2, 3]), 6);
    add('rs:coll:vecReturn', async () => Array.from(await s.confRsIntsMake(3)), [1, 2, 3]);
    add('rs:coll:vecF64', () => s.confRsF64sMean([1, 2, 3]), 2);
    add('rs:coll:vecBool', () => s.confRsBoolsAll([true, false]), false);
    add('rs:coll:vecString', () => s.confRsStringsJoin(['a', 'b']), 'a+b');
    add('rs:coll:vecStringOut', async () => Array.from(await s.confRsStringsMake(2)), ['s0', 's1']);
    add('rs:coll:vecStruct', () => s.confRsPointsLen([{ x: 1, y: 1 }, { x: 2, y: 2 }]), 2);
    add('rs:coll:slice', () => s.confRsSliceSum([4, 5]), 9);
    add('rs:coll:array', () => s.confRsArraySum([1, 2, 3]), 6);
    add('rs:coll:tuple', () => s.confRsTupleMake(1, 'x'), [1, 'x']);
    add('rs:coll:mapParam', () => s.confRsMapCount({ a: 1, b: 2 }), 3);
    add('rs:coll:mapReturn', () => s.confRsMapMake(), { a: 1, b: 2 });
    add('rs:coll:nested', () => s.confRsNestedSum([[1], [2, 3]]), 6);
    add('rs:coll:optionVec', async () => Array.from(await s.confRsIntsOpt(true)), [1, 2]);
    add('rs:coll:optionVecNone', async () => (await s.confRsIntsOpt(false)) ?? null, null);
    // A set crosses as an array: JSON has no Set. napi-rs hands back a real one, which is the
    // open `rs:napi:hashSetOut` todo.
    add('rs:coll:setOut', async () => [...(await s.confRsSetMake(3))].sort(), [0, 1, 2]);
    add('rs:coll:setIn', () => s.confRsSetLen([1, 2, 2]), 2);
    add('rs:coll:sortedSet', async () => Array.from(await s.confRsBsetSorted([3, 1, 2])), [1, 2, 3]);
}
