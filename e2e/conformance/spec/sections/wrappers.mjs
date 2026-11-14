import { rejecting } from './expect.mjs';

// Collects what nothing reaches, then lets the finalizers that follow run, a worker's release among them.
async function collectGarbage() {
    for (let i = 0; i < 4; i += 1) {
        globalThis.gc();
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

// Smart pointer wrappers, unique_ptr references, fluent and uncopyable returns (native/confwrappers.h).
export function wrapperChecks({ add, skip }, w, { worker }) {
    const rejects = rejecting(add);
    add('wrap:returnedAsObject', async () => (await w.confWrapMake(4)).doubled(), 8);
    add('wrap:constReferenceReturned', async () => (await w.confWrapCached()).doubled(), 14);
    add('wrap:paramTakesObject', async () => [await w.confWrapDoubled(await w.confWrapMake(5)), await w.confWrapDoubled(await new w.ConfWrapLeaf(6))], [10, 12]);
    rejects('wrap:paramNullRejected', () => w.confWrapDoubled(null), /non-null/);
    add('wrap:checkedReturned', async () => (await w.confWrapMakeChecked(3)).doubled(), 6);
    rejects('wrap:checkedParamUnbound', async () => w.confWrapCheckedDoubled(await w.confWrapMakeChecked(1)), /unbound|cannot/i);
    // CONTRACT, not a gap: the worker boundary converts vectors to plain arrays.
    const size = async (v) => (worker ? v.length : v.size());
    const at = async (v, i) => (worker ? v[i] : v.get(i));
    add('wrap:vectorReturned', async () => {
        const leaves = await w.confWrapMany(3);
        return [await size(leaves), await (await at(leaves, 2)).doubled()];
    }, [3, 6]);
    add('wrap:vectorConstReference', async () => {
        const leaves = await w.confWrapCachedMany();
        return [await size(leaves), await (await at(leaves, 1)).doubled()];
    }, [2, 4]);
    add('wrap:uniquePtrReference', async () => (await (await new w.ConfWrapTree()).child()).doubled(), 10);
    // The tree is unreachable once its child() returns; collected before the leaf is read, it takes the leaf along
    // unless the leaf's handle keeps it. Only a runtime started with --expose-gc collects on demand.
    if (typeof globalThis.gc === 'function') {
        add('wrap:uniquePtrReferenceOutlivesItsOwner', async () => {
            const leafOfTemporaryTree = async () => (await new w.ConfWrapTree()).child();
            const leaf = await leafOfTemporaryTree();
            await collectGarbage();
            return leaf.doubled();
        }, 10);
    } else {
        skip('wrap:uniquePtrReferenceOutlivesItsOwner', 'no gc() in this runtime');
    }
    add('wrap:fluentReturnsSameObject', async () => {
        const builder = await new w.ConfWrapBuilder();
        await (await builder.add(2)).add(3);
        return builder.sum();
    }, 5);
    add('wrap:uncopyableReferenceAsPointer', async () => (await w.ConfWrapAxis.up()).id(), 7);
    add('wrap:tagStructExported', () => typeof w.ConfCheckedTag, 'function');
}
