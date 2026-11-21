// Durable Object storage deletes at most this many keys per call.
const DELETE_BATCH = 128;
// The minute's count of sign-ins started by everyone, one key that each new minute starts over; no day's key, so the
// daily prune leaves it.
const STARTS_KEY = 'starts';

// Daily counts per caller and for everyone, kept by one Durable Object: compiles', whose everyone is `*`, and snapshot
// uploads', which name one of their own (worker/snapshots.js). It handles one call at a time and its storage reads hold
// other calls back, so a check and its increment cannot interleave.
export function createQuota(storage, now = () => Date.now()) {
    const today = () => new Date(now()).toISOString().slice(0, 10);
    const keysFor = (key, everyoneKey) => {
        const day = today();
        return { mine: `${day}|${key}`, everyone: `${day}|${everyoneKey}` };
    };
    const counts = async (key, everyoneKey = '*') => {
        const { mine, everyone } = keysFor(key, everyoneKey);
        const found = await storage.get([mine, everyone]);
        return { mine, everyone, used: found.get(mine) ?? 0, total: found.get(everyone) ?? 0 };
    };

    return {
        async reserve({
            key, limit, globalLimit, everyoneKey,
        }) {
            const { mine, everyone, used, total } = await counts(key, everyoneKey);
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

        // Whether one more device sign-in may start this minute, for everyone together: counted here exactly, as a rate
        // limit counted at each Cloudflare location cannot.
        async startSignIn({ limit }) {
            const minute = new Date(now()).toISOString().slice(0, 16);
            const last = await storage.get(STARTS_KEY);
            const count = last?.minute === minute ? last.count : 0;
            if (count >= limit) return false;
            await storage.put({ [STARTS_KEY]: { minute, count: count + 1 } });
            return true;
        },

        async prune() {
            const earlier = [...(await storage.list({ end: `${today()}|` })).keys()];
            for (let start = 0; start < earlier.length; start += DELETE_BATCH) {
                await storage.delete(earlier.slice(start, start + DELETE_BATCH));
            }
        },
    };
}
