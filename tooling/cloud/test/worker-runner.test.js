import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { sqliteD1 } from '../scripts/sqlite-d1.mjs';

// worker/runner.js on the real @cloudflare/containers Container class (test/support/register.mjs stands in for
// cloudflare:workers), with a fake Durable Object context and container, the node:sqlite D1 and a clock moved by hand.
// The library waits on timers of up to minutes; here they fire at once.
let now = Date.parse('2026-10-08T12:00:00Z');
Date.now = () => now;
const advance = (ms) => { now += ms; };
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, Math.min(ms ?? 0, 2), ...args);
globalThis.IdentityTransformStream = TransformStream;
const sleep = (ms) => new Promise((resolve) => { realSetTimeout(resolve, ms); });
console.log = () => {};

const { CloudRunnerWeb } = await import('../worker/runner.js');
const { createAccounts } = await import('../worker/accounts.js');

const MINUTE = 61 * 1000;
const SIGTERM = 15;

// A runner process as Docker runs it: PID 1, which ignores SIGTERM, unless told otherwise.
function fakeContainer({ honorsSigterm = false } = {}) {
    let running = false;
    let exit;
    const container = {
        signals: [],
        starts: 0,
        destroys: 0,
        get running() { return running; },
        start(config) {
            running = true;
            container.starts += 1;
            container.config = config;
            container.exited = new Promise((resolve) => { exit = resolve; });
        },
        monitor() { return container.exited; },
        getTcpPort() {
            return {
                async fetch() {
                    await sleep(2);
                    const response = new Response('{"ok":true}');
                    Object.defineProperty(response, 'webSocket', { value: null });
                    return response;
                },
            };
        },
        signal(number) {
            container.signals.push(number);
            if (honorsSigterm && number === SIGTERM) container.exit();
        },
        async destroy() {
            container.destroys += 1;
            container.exit();
        },
        exit() {
            if (!running) return;
            running = false;
            exit(0);
        },
        interceptOutboundHttp: async () => {},
        interceptOutboundHttps: async () => {},
        interceptAllOutboundHttp: async () => {},
    };
    return container;
}

function setup({ honorsSigterm, env: overrides = {} } = {}) {
    const container = fakeContainer({ honorsSigterm });
    const sql = new DatabaseSync(':memory:');
    const kv = new Map();
    const storage = new Map();
    const pending = [];
    const ctx = {
        id: { equals(other) { return other === this; }, toString: () => 'runner-of-42' },
        container,
        exports: { ContainerProxy: () => ({}) },
        blockConcurrencyWhile(fn) {
            const promise = fn();
            pending.push(promise);
            return promise;
        },
        storage: {
            sql: { exec: (query, ...values) => sql.prepare(query).all(...values.map((value) => value ?? null)) },
            kv: { get: (key) => kv.get(key), put: (key, value) => { kv.set(key, value); } },
            async get(key) { return storage.get(key); },
            async put(entries) { Object.entries(entries).forEach(([key, value]) => storage.set(key, value)); },
            async delete(keys) { [].concat(keys).forEach((key) => storage.delete(key)); },
            async setAlarm() {},
            async getAlarm() { return null; },
            async deleteAlarm() {},
            async sync() {},
        },
    };
    const d1 = sqliteD1();
    const outage = { calls: 0, always: false };
    const failing = () => {
        if (outage.always) return true;
        if (outage.calls === 0) return false;
        outage.calls -= 1;
        return true;
    };
    const db = {
        prepare: (query) => { if (failing()) throw new Error('D1_ERROR: Network connection lost'); return d1.prepare(query); },
        batch: (statements) => { if (failing()) throw new Error('D1_ERROR: Network connection lost'); return d1.batch(statements); },
    };
    const env = {
        DB: db, RUNNER_SECRET: 's'.repeat(40), RUNNER_WEB: { idFromName: () => ctx.id }, CLOUD_BUILDS_ENABLED: 'true', ...overrides,
    };
    const runner = new CloudRunnerWeb(ctx, env);
    const accounts = createAccounts(d1, () => now);
    // A runner's user signed in before its first build, as every user with a token did.
    d1.prepare("INSERT INTO users (id, login, created_at, last_login_at) VALUES (42, 'octocat', '', '')").run();
    const ticks = () => ctx.storage.sql.exec("SELECT payload FROM container_schedules WHERE callback = 'meterTick'").map((row) => JSON.parse(row.payload).runId);
    return {
        runner, container, env, d1, accounts, outage, storage, ticks, settled: () => Promise.all(pending),
    };
}

// Reads the answer to its end, as a client does: until then the request counts as in flight and keeps the runner up.
// The library notes the end a turn later, so the clock waits for it.
async function ask(h, { path = '/v1/health', method = 'GET' } = {}) {
    const response = await h.runner.fetch(new Request(`http://runner${path}`, { method, headers: { 'x-crossbind-user': '42' } }));
    await response.text();
    await sleep(5);
    return response.status;
}

async function tick(h) {
    await h.runner.alarm();
    await sleep(5);
}

// A minute in which a build keeps its runner busy: a request halfway through, then the minute's tick.
async function busyMinute(h, request) {
    advance(MINUTE / 2);
    await ask(h, request);
    advance(MINUTE / 2);
    await tick(h);
}

const used = async (h) => (await h.accounts.buildBudget('42', now)).mine;

test('starts one container for requests that arrive together, and counts its minutes once', async () => {
    const h = setup();
    await h.settled();

    assert.deepEqual(await Promise.all([ask(h), ask(h), ask(h)]), [200, 200, 200]);
    const run = h.storage.get('run');
    advance(MINUTE);
    await tick(h);

    assert.equal(h.container.starts, 1);
    assert.ok(h.ticks().every((id) => id === run.id));
    assert.equal(await used(h), 61);
});

test('keeps metering through a D1 error and destroys the runner once the month is spent', async () => {
    const h = setup();
    await h.settled();
    await ask(h);
    h.outage.calls = 1;
    await busyMinute(h);

    assert.ok(h.ticks().length >= 1);
    for (let minute = 0; minute < 70 && h.container.running; minute += 1) {
        await busyMinute(h, { path: '/v1/exec', method: 'POST' });
    }
    await tick(h);

    assert.equal(h.container.running, false);
    assert.deepEqual([h.container.destroys, h.container.signals], [1, []]);
    assert.ok(await used(h) >= 3600 && await used(h) <= 3780);
});

test('destroys a runner that ignores SIGTERM once its user\'s month is spent, and starts none after', async () => {
    const h = setup();
    await h.settled();
    await h.accounts.addBuildSeconds('42', now, 'web', 3590);

    assert.equal(await ask(h), 200);
    advance(MINUTE);
    await tick(h);

    assert.equal(h.container.running, false);
    assert.equal(await ask(h), 429);
    assert.equal(h.container.starts, 1);
});

test('refuses a step and destroys the runner when the month runs out between steps', async () => {
    const h = setup();
    await h.settled();
    await ask(h);
    await h.accounts.addBuildSeconds('42', now, 'android', 3600);

    assert.equal(await ask(h, { path: '/v1/exec', method: 'POST' }), 429);
    assert.equal(h.container.running, false);
});

test('never counts the time between a stop it could not record and the next start', async () => {
    const h = setup({ honorsSigterm: true });
    await h.settled();
    await ask(h);
    advance(90 * 1000);
    h.container.exit();
    await sleep(10);
    h.outage.calls = 5;
    await tick(h);
    h.outage.calls = 0;
    advance(3600 * 1000);

    assert.equal(await ask(h), 200);
    advance(MINUTE);
    await tick(h);

    assert.ok(await used(h) <= 160);
});

test('destroys an idle runner a minute after its last request and counts it until then', async () => {
    const h = setup();
    await h.settled();
    await ask(h);
    advance(MINUTE);
    await tick(h);
    await tick(h);

    assert.equal(h.container.running, false);
    assert.ok(await used(h) >= 60 && await used(h) <= 140);
});

test('destroys a running runner within a minute of a pause or a block', async () => {
    const paused = setup();
    const blocked = setup();
    await Promise.all([paused.settled(), blocked.settled()]);
    await blocked.accounts.signIn({ id: '42', login: 'octocat' });
    await ask(paused);
    await ask(blocked);

    paused.env.CLOUD_BUILDS_ENABLED = 'false';
    await blocked.d1.prepare('UPDATE users SET blocked = 1').run();
    advance(MINUTE);
    await tick(paused);
    await tick(blocked);

    assert.deepEqual([paused.container.running, blocked.container.running], [false, false]);
});

test('starts nothing without a runner secret of 32 characters, or while D1 cannot tell what is left', async () => {
    const unset = setup({ env: { RUNNER_SECRET: undefined } });
    const short = setup({ env: { RUNNER_SECRET: 'short' } });
    const blind = setup();
    await Promise.all([unset.settled(), short.settled(), blind.settled()]);
    blind.outage.always = true;

    assert.deepEqual([await ask(unset), await ask(short), await ask(blind)], [503, 503, 503]);
    assert.equal(unset.container.starts + short.container.starts + blind.container.starts, 0);
});

test('destroys a runner that cannot be metered for three minutes running', async () => {
    const h = setup();
    await h.settled();
    await ask(h);
    h.outage.always = true;
    await busyMinute(h);
    await busyMinute(h);
    const upAfterTwo = h.container.running;
    await busyMinute(h);

    assert.deepEqual([upAfterTwo, h.container.running], [true, false]);
});

test('starts the container with a runner token of its own, never the caller\'s', async () => {
    const h = setup();
    await h.settled();

    await ask(h);

    assert.match(h.container.config.env.CROSSBIND_RUNNER_TOKEN, /^[0-9a-f]{64}$/);
});

test('refuses a request naming another account than the runner serves', async () => {
    const h = setup();
    h.env.RUNNER_WEB = { idFromName: () => ({ toString: () => 'runner-of-someone-else' }) };
    await h.settled();

    assert.equal(await ask(h), 403);
    assert.equal(h.container.starts, 0);
});
