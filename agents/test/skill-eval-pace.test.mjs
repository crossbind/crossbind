import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { combineResults, finishedChunks, nextStep, runOrder, windowsSeen } from '../../scripts/skill-eval/pace.mjs';

const HOUR = 3600;
const reading = (fiveHour, fiveHourResetsAt, week, weekResetsAt = 9 * 24 * HOUR) => JSON.stringify({
    type: 'rate_limit_event',
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt: fiveHourResetsAt }, seven_day: { utilization: week, resetsAt: weekResetsAt } } },
});

function folder(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-skill-eval-pace-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), content);
    }
    return root;
}

test('the windows are read at their fullest within the newest window', (t) => {
    const results = folder(t, {
        'traces/a.with.1.jsonl': [reading(0.81, 5 * HOUR, 0.30), '{"type":"assistant"}', reading(0.85, 5 * HOUR, 0.31)].join('\n'),
        // A run that went on past the reset reads the next window, which counts from its own start.
        'traces/b.with.1.jsonl': reading(0.04, 10 * HOUR, 0.32),
    });
    assert.deepEqual(windowsSeen(results), { fiveHour: 0.04, fiveHourResetsAt: 10 * HOUR, week: 0.32, weekResetsAt: 9 * 24 * HOUR });
    assert.equal(windowsSeen(folder(t, {})), null);
});

test('a reading that carries the weekly window alone still counts', (t) => {
    // A larger plan's events leave the five-hour window out.
    const weekOnly = JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.8, resetsAt: 9 * 24 * HOUR } } } });
    const seen = windowsSeen(folder(t, { 'traces/a.with.1.jsonl': weekOnly }));
    assert.deepEqual(seen, { fiveHour: null, fiveHourResetsAt: null, week: 0.8, weekResetsAt: 9 * 24 * HOUR });
    assert.equal(nextStep(seen, { fiveHourMax: 0.65, weekMax: 0.75 }, HOUR * 1000).action, 'stop');
});

test('a full window waits for its reset, and a full week stops', () => {
    const limits = { fiveHourMax: 0.65, weekMax: 0.75 };
    const now = HOUR * 1000;
    assert.deepEqual(nextStep(null, limits, now), { action: 'run' });
    assert.deepEqual(nextStep({ fiveHour: 0.5, fiveHourResetsAt: 2 * HOUR, week: 0.5, weekResetsAt: 50 * HOUR }, limits, now), { action: 'run' });
    assert.deepEqual(nextStep({ fiveHour: 0.7, fiveHourResetsAt: 2 * HOUR, week: 0.5, weekResetsAt: 50 * HOUR }, limits, now), { action: 'wait', until: 2 * HOUR * 1000 + 60_000 });
    assert.equal(nextStep({ fiveHour: 0.7, fiveHourResetsAt: 2 * HOUR, week: 0.8, weekResetsAt: 50 * HOUR }, limits, now).action, 'stop');
    // A reading whose window has reset since says nothing of the window now.
    assert.deepEqual(nextStep({ fiveHour: 0.9, fiveHourResetsAt: HOUR / 2, week: 0.5, weekResetsAt: 50 * HOUR }, limits, now), { action: 'run' });
});

test('the order mixes the groups and does not depend on the order given', () => {
    const cases = ['p001', 'p002', 'p003', 'a001', 'a002', 'a003'].map((id) => ({ id }));
    const order = runOrder(cases).map(({ id }) => id);
    assert.deepEqual(runOrder([...cases].reverse()).map(({ id }) => id), order);
    assert.notDeepEqual(order, cases.map(({ id }) => id));
});

test('a run started again in the same folder skips the cases a finished chunk ran', (t) => {
    const chunks = folder(t, {
        'chunk-001/results/summary.json': '{}',
        'chunk-001/results/rows.jsonl': `${JSON.stringify({ id: 'p001' })}\n`,
        'chunk-001/results/errors.jsonl': `${JSON.stringify({ id: 'p002', error: 'API error' })}\n`,
        // A chunk stopped before its end has no summary, so its cases run again.
        'chunk-002/results/run.json': '{}',
    });
    const earlier = finishedChunks(chunks);
    assert.equal(earlier.count, 2);
    assert.deepEqual(earlier.results, [path.join(chunks, 'chunk-001', 'results')]);
    assert.deepEqual([...earlier.ran], ['p001']);
    assert.deepEqual(finishedChunks(path.join(chunks, 'none')), { count: 0, results: [], ran: new Set() });
});

test('a later run of a case takes the place of its error', (t) => {
    const row = (id, extra) => JSON.stringify({ id, arm: 'with', run: 1, group: 'debug', split: 'train', trigger: 'must', costUsd: 0.5, judgeCostUsd: 0, seconds: 60, ...extra });
    const done = { error: null, loaded: true, facts: [], slips: [], unsafe: [], correct: true, turns: 5, toolCalls: 4, tokens: { output: 10, thinking: 5 } };
    const first = folder(t, {
        'rows.jsonl': `${row('p001', done)}\n`,
        'errors.jsonl': `${row('p002', { error: 'API error' })}\n${row('p003', { error: 'timed out after 1800s' })}\n`,
        'summary.json': '{"model":"claude-sonnet-5-5","effort":"default","judgeModel":"claude-haiku-5-5","costUsd":1,"seconds":60}',
        'traces/p001.with.1.jsonl': '{}\n',
    });
    const retry = folder(t, {
        'rows.jsonl': `${row('p002', done)}\n`,
        'errors.jsonl': '',
        'summary.json': '{"model":"claude-sonnet-5-5","effort":"default","judgeModel":"claude-haiku-5-5","costUsd":0.5,"seconds":30}',
        'traces/p002.with.1.jsonl': '{}\n',
    });
    const combined = folder(t, {});
    const { rows, errors, summary } = combineResults([first, retry], combined);
    assert.deepEqual(rows.map(({ id }) => id), ['p001', 'p002']);
    assert.deepEqual(errors.map(({ id }) => id), ['p003']);
    assert.deepEqual([summary.costUsd, summary.seconds, summary.arms.with.runs, summary.arms.with.errors], [1.5, 90, 2, 1]);
    assert.deepEqual(fs.readdirSync(path.join(combined, 'traces')).sort(), ['p001.with.1.jsonl', 'p002.with.1.jsonl']);
});
