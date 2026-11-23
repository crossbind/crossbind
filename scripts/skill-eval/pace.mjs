// The runs share the account's five-hour and weekly usage windows with every other session of it, and a full window
// refuses requests. So a long evaluation runs in chunks, and between two chunks reads from the last runs' traces how
// full the windows are: it waits out a five-hour window that passed its ceiling, and stops at a weekly one.

import fs from 'node:fs';
import path from 'node:path';

import { summarize } from './report.mjs';

const MINUTE = 60_000;

const readJsonLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

// A window's newest reading wins; within one window, its fullest.
function newer(kept, utilization, resetsAt) {
    if (!kept || resetsAt > kept.resetsAt) return { utilization, resetsAt };
    if (resetsAt < kept.resetsAt) return kept;
    return { utilization: Math.max(kept.utilization, utilization), resetsAt };
}

export function windowsSeen(results) {
    const traces = path.join(results, 'traces');
    if (!fs.existsSync(traces)) return null;
    let fiveHour = null;
    let week = null;
    for (const file of fs.readdirSync(traces)) {
        for (const line of fs.readFileSync(path.join(traces, file), 'utf8').split('\n')) {
            if (!line.includes('"rate_limit_event"')) continue;
            const windows = JSON.parse(line).rate_limit_info?.unifiedWindows;
            if (windows?.five_hour) fiveHour = newer(fiveHour, windows.five_hour.utilization, windows.five_hour.resetsAt);
            if (windows?.seven_day) week = newer(week, windows.seven_day.utilization, windows.seven_day.resetsAt);
        }
    }
    if (!fiveHour && !week) return null;
    return {
        fiveHour: fiveHour?.utilization ?? null,
        fiveHourResetsAt: fiveHour?.resetsAt ?? null,
        week: week?.utilization ?? null,
        weekResetsAt: week?.resetsAt ?? null,
    };
}

export function nextStep(seen, { fiveHourMax, weekMax }, now = Date.now()) {
    if (!seen) return { action: 'run' };
    if (seen.week !== null && seen.week >= weekMax && seen.weekResetsAt * 1000 > now) {
        return { action: 'stop', reason: `the weekly window is at ${Math.round(seen.week * 100)}%, past the ${Math.round(weekMax * 100)}% ceiling, until ${new Date(seen.weekResetsAt * 1000).toISOString()}` };
    }
    if (seen.fiveHour !== null && seen.fiveHour >= fiveHourMax && seen.fiveHourResetsAt * 1000 > now) {
        return { action: 'wait', until: seen.fiveHourResetsAt * 1000 + MINUTE };
    }
    return { action: 'run' };
}

function hash(text) {
    let value = 2166136261;
    for (const character of text) value = Math.imul(value ^ character.codePointAt(0), 16777619);
    return value >>> 0;
}

// A fixed order that mixes the groups, so that a run cut short still has some of each.
export function runOrder(cases) {
    return [...cases].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id));
}

// What an earlier run in the same folder left, so that a run started again goes on from there: the chunks that reached
// their summary, the cases they ran without an error, and how many chunk folders there are.
export function finishedChunks(chunks) {
    const names = fs.existsSync(chunks) ? fs.readdirSync(chunks).filter((name) => name.startsWith('chunk-')).sort() : [];
    const results = names.map((name) => path.join(chunks, name, 'results')).filter((folder) => fs.existsSync(path.join(folder, 'summary.json')));
    const ran = new Set(results.flatMap((folder) => readJsonLines(path.join(folder, 'rows.jsonl')).map((row) => row.id)));
    return { count: names.length, results, ran };
}

const key = (row) => `${row.id}.${row.arm}.${row.run}`;

// Folds the results of the chunks, in the order they ran, into one: a later row of a case takes the place of an error
// of it, so that a run retried after a failure counts once.
export function combineResults(chunks, results) {
    const latest = new Map();
    const traces = new Map();
    let costUsd = 0;
    let seconds = 0;
    let settings = {};
    for (const chunk of chunks) {
        const summary = JSON.parse(fs.readFileSync(path.join(chunk, 'summary.json'), 'utf8'));
        costUsd += summary.costUsd ?? 0;
        seconds += summary.seconds ?? 0;
        settings = { model: summary.model, effort: summary.effort, judgeModel: summary.judgeModel };
        for (const row of [...readJsonLines(path.join(chunk, 'errors.jsonl')), ...readJsonLines(path.join(chunk, 'rows.jsonl'))]) {
            if (row.error && latest.has(key(row)) && !latest.get(key(row)).error) continue;
            latest.set(key(row), row);
            const trace = path.join(chunk, 'traces', `${key(row)}.jsonl`);
            if (fs.existsSync(trace)) traces.set(key(row), trace);
        }
    }

    const all = [...latest.values()].sort((a, b) => key(a).localeCompare(key(b)));
    const rows = all.filter((row) => !row.error);
    const errors = all.filter((row) => row.error);
    const summary = { ...settings, costUsd, seconds, arms: summarize(all) };
    fs.mkdirSync(path.join(results, 'traces'), { recursive: true });
    for (const [name, trace] of traces) fs.copyFileSync(trace, path.join(results, 'traces', `${name}.jsonl`));
    const lines = (list) => list.map((row) => `${JSON.stringify(row)}\n`).join('');
    fs.writeFileSync(path.join(results, 'rows.jsonl'), lines(rows));
    fs.writeFileSync(path.join(results, 'errors.jsonl'), lines(errors));
    fs.writeFileSync(path.join(results, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return { rows, errors, summary };
}
