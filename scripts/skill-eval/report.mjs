// Turns what `claude plugin eval` left of a run, its result file and traces, into one row per run and a summary.
// A run that failed is an error, kept apart: it counts neither for nor against the skill.

import fs from 'node:fs';
import path from 'node:path';

import { buildVocabulary, ungrounded } from './grounded.mjs';
import { readTrace } from './trace.mjs';

const FACT_GRADER = /^fact-(\d+)$/;

function failure(run, trace) {
    if (run.error) return run.error;
    if (!trace) return 'no trace';
    return trace.ended === 'success' ? null : trace.ended;
}

export function scoreRun(entry, arm, index, run, trace, vocabulary) {
    const row = { id: entry.id, group: entry.tags[0], split: entry.split, trigger: entry.trigger, arm, run: index + 1 };
    const cost = { costUsd: run.costUsd ?? 0, judgeCostUsd: run.judgeCostUsd ?? 0, seconds: run.durationSeconds ?? 0 };
    const error = failure(run, trace);
    if (error) return { ...row, error, ...cost };

    const facts = run.graders
        .filter((grader) => FACT_GRADER.test(grader.name))
        .map((grader) => ({ claim: entry.facts[Number(FACT_GRADER.exec(grader.name)[1]) - 1].claim, passed: grader.passed }));
    const loaded = trace.skillCall !== null;
    const slips = ungrounded(trace.answer, vocabulary);
    const answerCorrect = facts.every((fact) => fact.passed) && slips.length === 0 && trace.unsafe.length === 0;
    // The arm without the skill cannot load it, so there the answer alone is judged.
    const triggerHolds = arm !== 'with' || entry.trigger === 'either' || (entry.trigger === 'must') === loaded;

    return {
        ...row,
        error: null,
        loaded,
        skillCall: trace.skillCall,
        route: entry.route?.length ? entry.route.some((reference) => trace.referencesRead.includes(reference)) : null,
        inspector: trace.ranInspector,
        facts,
        slips,
        unsafe: trace.unsafe,
        denied: trace.denied.length,
        answerCorrect,
        correct: answerCorrect && triggerHolds,
        turns: trace.turns,
        toolCalls: trace.toolCalls,
        tokens: trace.tokens,
        ...cost,
    };
}

const rate = (rows, isHit) => ({ hit: rows.filter(isHit).length, of: rows.length });
const mean = (rows, pick) => (rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + pick(row), 0) / rows.length);

function summarizeArm(rows) {
    const done = rows.filter((row) => !row.error);
    return {
        runs: done.length,
        errors: rows.length - done.length,
        // Of the runs the skill should load for, those it loaded in; of those it should stay out of, those it did.
        recall: rate(done.filter((row) => row.trigger === 'must'), (row) => row.loaded),
        specificity: rate(done.filter((row) => row.trigger === 'must-not'), (row) => !row.loaded),
        facts: rate(done.flatMap((row) => row.facts), (fact) => fact.passed),
        grounded: rate(done, (row) => row.slips.length === 0),
        unsafe: done.filter((row) => row.unsafe.length > 0).length,
        correct: rate(done, (row) => row.correct),
        correctBySplit: Object.fromEntries(['train', 'test'].map((split) => [split, rate(done.filter((row) => row.split === split), (row) => row.correct)])),
        mean: {
            costUsd: mean(done, (row) => row.costUsd),
            seconds: mean(done, (row) => row.seconds),
            turns: mean(done, (row) => row.turns),
            outputTokens: mean(done, (row) => row.tokens.output),
            thinkingTokens: mean(done, (row) => row.tokens.thinking),
        },
    };
}

export function summarize(rows) {
    return Object.fromEntries([...Map.groupBy(rows, (row) => row.arm)].map(([arm, list]) => [arm, summarizeArm(list)]));
}

const jsonLines = (rows) => rows.map((row) => `${JSON.stringify(row)}\n`).join('');

// Reads `results/aggregate-result.json`, copies each run's trace beside it, as the eval command keeps traces in the
// system's temp folder, and writes rows.jsonl, errors.jsonl and summary.json there.
export function writeReport({ root, cases, results }) {
    const aggregate = JSON.parse(fs.readFileSync(path.join(results, 'aggregate-result.json'), 'utf8'));
    const runFile = path.join(results, 'run.json');
    const { effort } = fs.existsSync(runFile) ? JSON.parse(fs.readFileSync(runFile, 'utf8')) : { effort: 'default' };
    const model = aggregate.suite.modelOverride;
    const vocabulary = buildVocabulary(root);
    const byId = new Map(cases.map((entry) => [entry.id, entry]));
    const traces = path.join(results, 'traces');
    fs.mkdirSync(traces, { recursive: true });

    const rows = aggregate.cases.flatMap((item) => {
        const entry = byId.get(item.name);
        if (!entry) throw new Error(`The results hold a case the table has not: ${item.name}`);
        return Object.entries(item.arms).flatMap(([arm, runs]) => runs.map((run, index) => {
            const kept = path.join(traces, `${entry.id}.${arm}.${index + 1}.jsonl`);
            if (run.tracePath && fs.existsSync(run.tracePath)) fs.copyFileSync(run.tracePath, kept);
            const trace = fs.existsSync(kept) ? readTrace(fs.readFileSync(kept, 'utf8')) : null;
            return { model, effort, ...scoreRun(entry, arm, index, run, trace, vocabulary) };
        }));
    });

    const summary = { model, effort, judgeModel: aggregate.suite.judgeModel, costUsd: aggregate.costUsd, seconds: aggregate.durationSeconds, arms: summarize(rows) };
    fs.writeFileSync(path.join(results, 'rows.jsonl'), jsonLines(rows.filter((row) => !row.error)));
    fs.writeFileSync(path.join(results, 'errors.jsonl'), jsonLines(rows.filter((row) => row.error)));
    fs.writeFileSync(path.join(results, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    return { rows, summary };
}
