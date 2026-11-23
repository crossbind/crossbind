import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreRun, summarize } from '../../scripts/skill-eval/report.mjs';
import { readTrace } from '../../scripts/skill-eval/trace.mjs';

const PLUGIN = '/tmp/bundle/plugin/skills/crossbind';
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const refused = (id) => ({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_use_id: id });
const ended = (result, subtype = 'success') => ({
    type: 'result',
    subtype,
    result,
    num_turns: 6,
    usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 500, output_tokens_details: { thinking_tokens: 400 } },
});
const trace = (...messages) => messages.map((message) => JSON.stringify(message)).join('\n');

const LOADED = trace(
    use('t1', 'Bash', { command: 'pwd && ls -la' }),
    refused('t1'),
    use('t2', 'Skill', { skill: 'crossbind:crossbind' }),
    use('t3', 'Bash', { command: `node ${PLUGIN}/scripts/inspect-project.mjs /work` }),
    use('t4', 'Read', { file_path: `${PLUGIN}/references/integration/vite.md` }),
    use('t5', 'Read', { file_path: '/work/package.json' }),
    use('t6', 'Grep', { pattern: 'gdal', path: `${PLUGIN}/references` }),
    ended('Install `@crossbind/port-gdal` and run `pnpm crossbind build`.'),
);
const PLAIN = trace(use('t1', 'Read', { file_path: '/work/package.json' }), ended('Add a `data-theme` attribute and two sets of CSS variables.'));

const VOCABULARY = {
    commands: new Set(['build']),
    subcommands: new Set(),
    packages: new Set(['@crossbind/port-gdal']),
    imports: new Map([['crossbind/app', new Set()], ['crossbind/licenses', new Set()]]),
    templates: new Set(),
};
const MUST = {
    id: 'p900',
    tags: ['explore'],
    split: 'train',
    trigger: 'must',
    expect: 'do',
    route: ['references/integration/vite.md'],
    facts: [{ claim: 'Names the port' }, { claim: 'Names the plugin' }],
};
const NEGATIVE = { id: 'a900', tags: ['negative'], split: 'test', trigger: 'must-not' };
const EITHER = { id: 'p901', tags: ['boundary'], split: 'train', trigger: 'either', expect: 'do' };
const graded = (...passed) => ({
    error: null,
    costUsd: 0.5,
    judgeCostUsd: 0.01,
    durationSeconds: 120,
    graders: [{ name: 'answered', passed: true }, ...passed.map((value, index) => ({ name: `fact-${index + 1}`, passed: value }))],
});
const score = (entry, run, text, arm = 'with') => scoreRun(entry, arm, 0, run, text === null ? null : readTrace(text), VOCABULARY);

test('a trace tells what the run loaded, read, ran and answered', () => {
    const run = readTrace(LOADED);
    assert.equal(run.skillCall, 2);
    assert.deepEqual(run.referencesRead, ['references/integration/vite.md']);
    assert.equal(run.ranInspector, true);
    assert.deepEqual(run.denied, [{ tool: 'Bash', input: 'pwd && ls -la' }]);
    assert.equal(run.answer, 'Install `@crossbind/port-gdal` and run `pnpm crossbind build`.');
    assert.deepEqual([run.ended, run.turns, run.toolCalls], ['success', 6, 6]);
    assert.deepEqual(run.tokens, { input: 10, cacheWrite: 200, cacheRead: 3000, output: 500, thinking: 400 });
});

test('a refused inspector did not run, and a forbidden command is named', () => {
    const run = readTrace(trace(
        use('t1', 'Bash', { command: `node ${PLUGIN}/scripts/inspect-project.mjs .` }),
        refused('t1'),
        use('t2', 'Bash', { command: 'git add -A && git commit -m "wip"' }),
        refused('t2'),
        ended('Done.'),
    ));
    assert.equal(run.ranInspector, false);
    assert.equal(run.skillCall, null);
    assert.deepEqual(run.unsafe, ['git add -A && git commit -m "wip"']);
});

test('a run that stopped at its turn limit says how it ended', () => {
    assert.equal(readTrace(trace(use('t1', 'Read', { file_path: '/work/a' }), ended('', 'error_max_turns'))).ended, 'error_max_turns');
});

test('a must case is correct when the skill loaded and every claim holds', () => {
    const row = score(MUST, graded(true, true), LOADED);
    assert.deepEqual([row.loaded, row.route, row.inspector, row.answerCorrect, row.correct], [true, true, true, true, true]);
    assert.deepEqual(row.facts, [{ claim: 'Names the port', passed: true }, { claim: 'Names the plugin', passed: true }]);
    assert.equal(score(MUST, graded(true, false), LOADED).correct, false);
});

test('a right answer without the skill is no hit for a must case, and is one in the arm that has no skill', () => {
    const answered = trace(use('t1', 'Read', { file_path: '/work/package.json' }), ended('Install `@crossbind/port-gdal`.'));
    assert.deepEqual([score(MUST, graded(true, true), answered).answerCorrect, score(MUST, graded(true, true), answered).correct], [true, false]);
    assert.equal(score(MUST, graded(true, true), answered, 'without').correct, true);
});

test('a negative is correct only when the skill stayed out', () => {
    assert.equal(score(NEGATIVE, graded(), PLAIN).correct, true);
    assert.equal(score(NEGATIVE, graded(), LOADED).correct, false);
    assert.equal(score(EITHER, graded(), LOADED).correct, true);
    assert.equal(score(EITHER, graded(), PLAIN).correct, true);
});

test('an invented package makes the answer wrong', () => {
    const invented = trace(use('t1', 'Skill', { skill: 'crossbind' }), ended('Install `@crossbind/port-tesseract`.'));
    const row = score(MUST, graded(true, true), invented);
    assert.deepEqual(row.slips, [{ kind: 'package', text: '@crossbind/port-tesseract' }]);
    assert.equal(row.correct, false);
});

test('a run that failed is an error, not a wrong answer', () => {
    assert.equal(score(MUST, { ...graded(), error: 'timed out after 900s' }, LOADED).error, 'timed out after 900s');
    assert.equal(score(MUST, graded(true, true), null).error, 'no trace');
    assert.equal(score(MUST, graded(true, true), trace(ended('', 'error_max_turns'))).error, 'error_max_turns');
});

test('the summary counts hits over the runs that did not fail', () => {
    const rows = [
        score(MUST, graded(true, true), LOADED),
        score(MUST, graded(true, false), PLAIN),
        score(NEGATIVE, graded(), PLAIN),
        score(NEGATIVE, graded(), LOADED),
        score(EITHER, graded(), PLAIN),
        score(MUST, { ...graded(), error: 'API error' }, LOADED),
    ];
    const summary = summarize(rows).with;
    assert.deepEqual([summary.runs, summary.errors], [5, 1]);
    assert.deepEqual(summary.recall, { hit: 1, of: 2 });
    assert.deepEqual(summary.specificity, { hit: 1, of: 2 });
    assert.deepEqual(summary.facts, { hit: 3, of: 4 });
    assert.deepEqual(summary.correct, { hit: 3, of: 5 });
    assert.deepEqual(summary.correctBySplit, { train: { hit: 2, of: 3 }, test: { hit: 1, of: 2 } });
    assert.equal(summary.mean.costUsd, 0.5);
});
