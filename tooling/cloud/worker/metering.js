// What a user's cloud runner costs: the time its container is up, from start to stop, added to D1 every minute so
// the allowances hold while a build runs, not only after it. Time up is what Cloudflare bills, and time in steps
// alone could be gamed: a one-second step every few minutes would keep a container up for free.

// storage: the Durable Object's, holding the running segment. limits: seconds for the user's month, everyone's month
// and everyone's day; the last keeps a few accounts from spending the month in a day.
export function createMeter({
    storage, accounts, image, limits, now = () => Date.now(),
}) {
    const spentOn = (budget) => {
        if (budget.everyone >= limits.globalSeconds) return 'global';
        if (budget.today >= limits.globalDailySeconds) return 'today';
        if (budget.mine >= limits.userSeconds) return 'quota';
        return null;
    };

    async function flush() {
        const segment = await storage.get('segment');
        if (!segment) return { exhausted: false };
        const at = now();
        await accounts.addBuildSeconds(segment.userId, at, image, Math.max(0, at - segment.since) / 1000);
        await storage.put({ segment: { ...segment, since: at } });
        return { exhausted: spentOn(await accounts.buildBudget(segment.userId, at)) !== null };
    }

    return {
        async mayStart(userId) {
            const reason = spentOn(await accounts.buildBudget(userId, now()));
            return reason ? { ok: false, reason } : { ok: true };
        },

        async begin(userId) {
            await storage.put({ segment: { userId, since: now() } });
        },

        flush,

        async end() {
            const outcome = await flush();
            await storage.delete(['segment']);
            return outcome;
        },
    };
}
