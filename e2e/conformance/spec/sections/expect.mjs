// Shared shape for checks that must throw: the check passes when the message matches.
export const rejecting = (add) => (name, run, pattern) => add(name, async () => {
    try {
        await run();
        return 'no-throw';
    } catch (e) {
        return pattern.test(String(e?.message ?? e));
    }
}, true);
