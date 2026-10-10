import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../worker/accounts.js';
import { createMeter } from '../worker/metering.js';
import { memoryStorage } from '../scripts/memory-storage.mjs';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

const START = Date.parse('2026-10-08T12:00:00Z');
const SECOND = 1000;
const DAY = 24 * 3600 * SECOND;
const limits = { userSeconds: 3600, globalSeconds: 360000, globalDailySeconds: 36000 };

function setup(overrides = {}) {
    let now = START;
    const accounts = createAccounts(sqliteD1(), () => now);
    const storage = memoryStorage();
    const meter = createMeter({
        storage, accounts, image: 'web', now: () => now, limits: { ...limits, ...overrides },
    });
    return {
        accounts, storage, meter, advance: (ms) => { now += ms; },
    };
}

test('lets a user start a runner while their month, everyone\'s month and everyone\'s day have time left', async () => {
    const { accounts, meter, advance } = setup({ userSeconds: 100, globalSeconds: 250, globalDailySeconds: 150 });

    assert.deepEqual(await meter.mayStart('583231'), { ok: true });
    await accounts.addBuildSeconds('583231', START, 'android', 100);
    assert.deepEqual(await meter.mayStart('583231'), { ok: false, reason: 'quota' });
    await accounts.addBuildSeconds('1', START, 'web', 50);
    assert.deepEqual(await meter.mayStart('2'), { ok: false, reason: 'today' });
    advance(DAY);
    assert.deepEqual(await meter.mayStart('2'), { ok: true });
    await accounts.addBuildSeconds('1', START + DAY, 'web', 100);
    assert.deepEqual(await meter.mayStart('2'), { ok: false, reason: 'global' });
});

test('counts a runner from its start to its stop, a minute at a time, against its user and image', async () => {
    const { accounts, storage, meter, advance } = setup();

    await meter.begin('583231');
    advance(60 * SECOND);
    assert.deepEqual(await meter.flush(), { exhausted: false });
    advance(30 * SECOND);
    await meter.flush();
    advance(10 * SECOND);
    await meter.end();

    assert.deepEqual(await accounts.buildSeconds('583231', '2026-10'), { web: 100 });
    assert.equal(storage.data.has('segment'), false);
    assert.deepEqual(await meter.flush(), { exhausted: false });
    assert.deepEqual(await accounts.buildSeconds('583231', '2026-10'), { web: 100 });
});

test('says when the user\'s month, everyone\'s month or everyone\'s day runs out while the runner is up', async () => {
    const mine = setup({ userSeconds: 120 });
    const everyone = setup({ globalSeconds: 90 });
    const today = setup({ globalDailySeconds: 90 });

    await mine.meter.begin('583231');
    mine.advance(60 * SECOND);
    const early = await mine.meter.flush();
    mine.advance(70 * SECOND);
    await everyone.meter.begin('583231');
    everyone.advance(100 * SECOND);
    await today.meter.begin('583231');
    today.advance(100 * SECOND);

    assert.deepEqual(
        [early, await mine.meter.flush(), await everyone.meter.flush(), await today.meter.flush()],
        [{ exhausted: false }, { exhausted: true }, { exhausted: true }, { exhausted: true }],
    );
});

test('counts time into the month and the day it passes in', async () => {
    const { accounts, meter, advance } = setup();
    const toNovember = Date.parse('2026-11-01T00:00:00Z') - START;

    await meter.begin('583231');
    advance(toNovember - 30 * SECOND);
    await meter.flush();
    advance(60 * SECOND);
    await meter.end();

    assert.deepEqual(await accounts.buildBudget('583231', START + toNovember), { mine: 60, everyone: 60, today: 60 });
});
