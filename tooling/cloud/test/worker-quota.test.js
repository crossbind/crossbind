import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQuota } from '../worker/quota.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';

let clock = Date.parse('2026-10-07T10:00:00Z');
const now = () => clock;
const anonymous = { key: 'ip:203.0.113.7', limit: 2, globalLimit: 3 };

test('counts each caller up to its daily limit, then refuses', async () => {
    const quota = createQuota(memoryStorage(), now);

    assert.deepEqual(await quota.reserve(anonymous), { ok: true, remaining: 1 });
    assert.deepEqual(await quota.reserve(anonymous), { ok: true, remaining: 0 });
    assert.deepEqual(await quota.reserve(anonymous), { ok: false, reason: 'quota', remaining: 0 });
});

test('stops everyone once the day\'s total reaches the global limit', async () => {
    const quota = createQuota(memoryStorage(), now);

    await quota.reserve(anonymous);
    await quota.reserve(anonymous);
    await quota.reserve({ ...anonymous, key: 'github:1' });

    assert.deepEqual(await quota.reserve({ ...anonymous, key: 'google:2' }), { ok: false, reason: 'global', remaining: 2 });
});

test('starts every caller afresh the next day', async () => {
    const quota = createQuota(memoryStorage(), now);
    await quota.reserve(anonymous);
    await quota.reserve(anonymous);

    clock += 24 * 3600 * 1000;

    assert.deepEqual(await quota.reserve(anonymous), { ok: true, remaining: 1 });
    clock -= 24 * 3600 * 1000;
});

test('gives back a compile the compiler turned away, and tells what is left without spending any', async () => {
    const quota = createQuota(memoryStorage(), now);
    await quota.reserve(anonymous);

    await quota.refund(anonymous);

    assert.equal(await quota.remaining(anonymous), 2);
    assert.equal(await quota.remaining(anonymous), 2);
});

test('counts the sign-ins everyone starts in a minute exactly, starts over each minute, and keeps the count through the daily prune', async () => {
    const storage = memoryStorage();
    const quota = createQuota(storage, now);
    const minuteStart = clock;

    const counted = [];
    for (let count = 0; count < 4; count += 1) counted.push(await quota.startSignIn({ limit: 3 }));
    clock += 59 * 1000;
    const sameMinute = await quota.startSignIn({ limit: 3 });
    clock += 1000;
    const nextMinute = await quota.startSignIn({ limit: 3 });
    await quota.prune();

    assert.deepEqual(counted, [true, true, true, false]);
    assert.equal(sameMinute, false);
    assert.equal(nextMinute, true);
    assert.deepEqual(storage.data.get('starts'), { minute: '2026-10-07T10:01', count: 1 });
    clock = minuteStart;
});

test('removes the counts of earlier days only', async () => {
    const storage = memoryStorage();
    const quota = createQuota(storage, now);
    await quota.reserve(anonymous);
    clock += 24 * 3600 * 1000;
    await quota.reserve(anonymous);

    await quota.prune();

    assert.deepEqual([...storage.data.keys()].sort(), ['2026-10-08|*', '2026-10-08|ip:203.0.113.7']);
    clock -= 24 * 3600 * 1000;
});
