// Durable Object storage deletes at most this many keys per call.
const DELETE_BATCH = 128;

// Daily compile counts per caller and for everyone, kept by one Durable Object: it handles one call at a time
// and its storage reads hold other calls back, so a check and its increment cannot interleave.
export function createQuota(storage, now = () => Date.now()) {
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const keysFor = (key) => {
        const day = today();
        return { mine: `${day}|${key}`, everyone: `${day}|*` };
    };
    const counts = async (key) => {
        const { mine, everyone } = keysFor(key);
        const found = await storage.get([mine, everyone]);
        return { mine, everyone, used: found.get(mine) ?? 0, total: found.get(everyone) ?? 0 };
    };

    return {
        async reserve({ key, limit, globalLimit }) {
            const { mine, everyone, used, total } = await counts(key);
            if (used >= limit) return { ok: false, reason: 'quota', remaining: 0 };
            if (total >= globalLimit) return { ok: false, reason: 'global', remaining: limit - used };
            await storage.put({ [mine]: used + 1, [everyone]: total + 1 });
            return { ok: true, remaining: limit - used - 1 };
        },

        async refund({ key }) {
            const { mine, everyone, used, total } = await counts(key);
            await storage.put({ [mine]: Math.max(0, used - 1), [everyone]: Math.max(0, total - 1) });
        },

        async remaining({ key, limit }) {
            const { used } = await counts(key);
            return Math.max(0, limit - used);
        },

        async prune() {
            const earlier = [...(await storage.list({ end: `${today()}|` })).keys()];
            for (let start = 0; start < earlier.length; start += DELETE_BATCH) {
                await storage.delete(earlier.slice(start, start + DELETE_BATCH));
            }
        },
    };
}
