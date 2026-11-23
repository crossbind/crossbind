#!/usr/bin/env node
/**
 * skill-eval — asks the skill's cases (agents/test/skill-cases) of an agent that has the crossbind skill
 * installed, through `claude plugin eval`, and leaves the scored result on disk: a row for each run in
 * results/rows.jsonl, the runs that failed in results/errors.jsonl, the totals in results/summary.json and each run's
 * trace under results/traces/.
 *
 * It writes a plugin bundle outside the repository: the skill as it is, a case folder per case, and each case's
 * project. Without --run that is all it does, and it prints the command a run would start.
 *
 * A run is a model session per case on your own Claude account, and counts against its usage. It takes two
 * grants the eval command asks for by name, which this script passes on and never adds itself:
 *   --trust-plugin   you trust the bundle, which is this repository's skill and cases
 *   --scaffold       the cases' scripts may run as you: each copies a case's project into the run's folder
 *
 * Usage:
 *   node scripts/skill-eval.mjs [options]
 *
 * Options:
 *   --case <id>          Only this case (repeatable)
 *   --tag <group>        Only the cases of this group
 *   --split <split>      Only the train or the test cases
 *   --cases <file>       A further case file, as one kept out of the repository (repeatable)
 *   --runs <n>           Runs of each case (default: 1)
 *   --model <model>      The model under test (default: claude-sonnet-5-5)
 *   --judge-model <m>    The model that judges the claims (default: claude-haiku-5-5)
 *   --effort <level>     The reasoning effort of the agents under test, as low; without it, Claude Code's default,
 *                        whatever effort or thinking settings the shell exports
 *   --without-skill      Run each case without the skill as well, which doubles the runs
 *   --concurrency <n>    Runs at once, 1 to 8 (default: 1)
 *   --max-cost-usd <n>   Stop once the list-price estimate passes this
 *   --chunk-size <n>     Run the cases this many at a time, and between two chunks keep the usage windows below:
 *   --five-hour-max <x>  the share of the five-hour window past which the next chunk waits for its reset (default: 0.65)
 *   --week-max <x>       the share of the weekly window past which the run stops (default: 0.75)
 *   --out <dir>          Where the bundle and the results go (default: a new folder in the system's temp folder); a paced
 *                        run started again on the same folder skips the cases its finished chunks ran
 *   --run                Start the runs; needs --trust-plugin and --scaffold
 *   --report-only        Score again what an earlier run left in --out, and start nothing
 *   -h, --help           Show this help
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { FIXTURES, writeFixture } from '../agents/test/skill-cases/fixtures.mjs';
import { loadCases } from '../agents/test/skill-cases/load.mjs';
import { INSPECTOR_GRANT, SKILL_NAME, caseFiles, pluginManifest } from './skill-eval/bundle.mjs';
import { runEnvironment } from './skill-eval/environment.mjs';
import { combineResults, finishedChunks, nextStep, runOrder, windowsSeen } from './skill-eval/pace.mjs';
import { writeReport } from './skill-eval/report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CREATE_APP = path.join(ROOT, 'tooling', 'create-app');
const TEMPLATES = JSON.parse(fs.readFileSync(path.join(CREATE_APP, 'src', 'manifest.json'), 'utf8'));

function fail(message) {
    process.stderr.write(`skill-eval: ${message}\n`);
    process.exit(2);
}

function readOptions() {
    const { values } = parseArgs({
        options: {
            case: { type: 'string', multiple: true, default: [] },
            tag: { type: 'string' },
            split: { type: 'string' },
            cases: { type: 'string', multiple: true, default: [] },
            runs: { type: 'string', default: '1' },
            model: { type: 'string', default: 'claude-sonnet-5-5' },
            'judge-model': { type: 'string', default: 'claude-haiku-5-5' },
            effort: { type: 'string' },
            'without-skill': { type: 'boolean', default: false },
            concurrency: { type: 'string', default: '1' },
            'max-cost-usd': { type: 'string' },
            'chunk-size': { type: 'string' },
            'five-hour-max': { type: 'string', default: '0.65' },
            'week-max': { type: 'string', default: '0.75' },
            out: { type: 'string' },
            run: { type: 'boolean', default: false },
            'report-only': { type: 'boolean', default: false },
            'trust-plugin': { type: 'boolean', default: false },
            scaffold: { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });
    return values;
}

function selectCases(options) {
    const cases = loadCases(options.cases.map((file) => path.resolve(file))).filter((entry) => (
        (options.case.length === 0 || options.case.includes(entry.id))
        && (!options.tag || entry.tags[0] === options.tag)
        && (!options.split || entry.split === options.split)
    ));
    const missing = options.case.filter((id) => !cases.some((entry) => entry.id === id));
    if (missing.length > 0) fail(`no such case: ${missing.join(', ')}`);
    if (cases.length === 0) fail('no case matches');
    return cases;
}

// Trusting a plugin inside a git repository trusts the whole repository, so the bundle stays out of this one.
function outputDirectory(given) {
    const directory = given ? path.resolve(given) : fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-skill-eval-'));
    if (!path.relative(ROOT, directory).startsWith('..')) fail(`--out must be outside the repository: ${directory}`);
    fs.mkdirSync(directory, { recursive: true });
    return directory;
}

function buildTemplates() {
    const build = spawnSync(process.execPath, [path.join(CREATE_APP, 'scripts', 'build-templates.js')], { encoding: 'utf8' });
    if (build.status !== 0) fail(`the templates did not build:\n${build.stderr || build.stdout}`);
}

// The scaffolder itself makes the project, so it has the name, the README and the versions its user would get.
function scaffold(fixture, parent) {
    const template = TEMPLATES.find((entry) => entry.key === fixture.template);
    const choice = [template.group, template.framework ?? template.label, ...(template.framework ? [template.label] : [])];
    const created = spawnSync(process.execPath, [path.join(CREATE_APP, 'src', 'index.js'), fixture.name, ...choice], { cwd: parent, encoding: 'utf8' });
    if (created.status !== 0) fail(`create-crossbind did not make ${fixture.template} (has pnpm install run?):\n${created.stderr || created.stdout}`);
    return path.join(parent, fixture.name);
}

// A project as its user would have it: a skeleton's files, or a template as create-crossbind hands it out.
function writeProjects(names, directory) {
    fs.rmSync(directory, { recursive: true, force: true });
    const projects = new Map();
    let templatesBuilt = false;
    for (const name of names) {
        const fixture = FIXTURES[name];
        if (!fixture.template && Object.keys(fixture.files).length === 0 && !fixture.extends) continue;
        const target = path.join(directory, name);
        fs.mkdirSync(target, { recursive: true });
        if (fixture.template) {
            if (!templatesBuilt) buildTemplates();
            templatesBuilt = true;
            projects.set(name, scaffold(fixture, target));
        } else {
            writeFixture(name, target);
            projects.set(name, target);
        }
    }
    return projects;
}

function writeBundle(cases, projects, directory) {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'core', 'crossbind', 'package.json'), 'utf8')).version;
    const plugin = path.join(directory, 'plugin');
    fs.rmSync(plugin, { recursive: true, force: true });
    fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), `${JSON.stringify(pluginManifest(version), null, 2)}\n`);
    fs.cpSync(path.join(ROOT, 'agents', 'skills', SKILL_NAME), path.join(plugin, 'skills', SKILL_NAME), { recursive: true });
    for (const entry of cases) {
        for (const [file, content] of Object.entries(caseFiles(entry, projects.get(entry.fixture) ?? null))) {
            const target = path.join(plugin, 'evals', entry.id, file);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, content, file.endsWith('.sh') ? { mode: 0o755 } : undefined);
        }
    }
    return plugin;
}

function evalArguments(options, plugin, results) {
    return [
        'plugin', 'eval', plugin,
        '--ablation', options['without-skill'] ? 'with-without' : 'none',
        '--runs', options.runs,
        '--model', options.model,
        '--judge-model', options['judge-model'],
        '--concurrency', options.concurrency,
        // The score this script reports is its own, so a case below the command's threshold is no failure of the run.
        '--threshold', '0',
        '--no-publish',
        '--keep-temp',
        '--output-dir', results,
        '--report', path.join(results, 'report.html'),
        ...(options['max-cost-usd'] ? ['--max-cost-usd', options['max-cost-usd']] : []),
        ...(options['trust-plugin'] ? ['--trust-plugin'] : []),
        ...(options.scaffold ? ['--scaffold'] : []),
        '--allow-tools', INSPECTOR_GRANT,
    ];
}

function printSummary({ summary }) {
    const share = ({ hit, of }) => (of === 0 ? 'none' : `${hit}/${of}`);
    for (const [arm, numbers] of Object.entries(summary.arms)) {
        process.stdout.write([
            `${arm === 'with' ? 'With the skill' : 'Without the skill'}: ${numbers.runs} runs, ${numbers.errors} failed`,
            `  correct ${share(numbers.correct)} (train ${share(numbers.correctBySplit.train)}, test ${share(numbers.correctBySplit.test)})`,
            `  loaded where it should ${share(numbers.recall)}, stayed out where it should ${share(numbers.specificity)}`,
            `  claims held ${share(numbers.facts)}, grounded ${share(numbers.grounded)}, forbidden attempts ${numbers.unsafe}`,
            `  a run: $${numbers.mean.costUsd.toFixed(2)} at list price, ${Math.round(numbers.mean.seconds)} s, ${Math.round(numbers.mean.turns)} turns, ${Math.round(numbers.mean.outputTokens)} output tokens (${Math.round(numbers.mean.thinkingTokens)} of them thinking)`,
            '',
        ].join('\n'));
    }
}

const options = readOptions();
if (options.help) {
    const source = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    process.stdout.write(`${source.slice(source.indexOf('/**') + 4, source.indexOf(' */')).replaceAll(/^ \* ?/gm, '')}\n`);
    process.exit(0);
}

if (options['report-only']) {
    if (!options.out) fail('--report-only needs --out, the folder an earlier run wrote');
    const extra = options.cases.map((file) => path.resolve(file));
    const cases = loadCases(extra);
    const out = path.resolve(options.out);
    // A paced run keeps a result per chunk: each is scored again, then folded into the run's own.
    const chunks = finishedChunks(path.join(out, 'chunks')).results;
    for (const results of chunks) writeReport({ root: ROOT, cases, results });
    printSummary(chunks.length > 0
        ? combineResults(chunks, path.join(out, 'results'))
        : writeReport({ root: ROOT, cases, results: path.join(out, 'results') }));
    process.exit(0);
}
if (options.run && (!options['trust-plugin'] || !options.scaffold)) fail('--run needs --trust-plugin and --scaffold: see --help for what each grants');

const quoted = (argument) => (/[\s*()]/.test(argument) ? `'${argument}'` : argument);

// Writes one bundle of these cases, runs it and scores it; the results folder it fills, or null where nothing ran.
function runCases(list, cases, directory, projects) {
    const plugin = writeBundle(list, projects, directory);
    const results = path.join(directory, 'results');
    const command = evalArguments(options, plugin, results);
    if (!options.run) {
        process.stdout.write(`Command: claude ${command.map(quoted).join(' ')}\n`);
        return null;
    }
    fs.mkdirSync(results, { recursive: true });
    fs.writeFileSync(path.join(results, 'run.json'), `${JSON.stringify({ effort: options.effort ?? 'default' })}\n`);
    // The eval command takes no effort of its own; Claude Code reads it from the environment its runs inherit.
    const run = spawnSync('claude', command, { stdio: 'inherit', env: runEnvironment(process.env, options.effort) });
    if (run.error) fail(`claude did not start: ${run.error.message}`);
    if (!fs.existsSync(path.join(results, 'aggregate-result.json'))) fail(`the run left no result (exit ${run.status})`);
    writeReport({ root: ROOT, cases, results });
    return results;
}

const time = (milliseconds) => new Date(milliseconds).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' });

async function runPaced(cases, directory, projects) {
    const size = Number(options['chunk-size']);
    const limits = { fiveHourMax: Number(options['five-hour-max']), weekMax: Number(options['week-max']) };
    const chunk = (list) => Array.from({ length: Math.ceil(list.length / size) }, (unused, index) => list.slice(index * size, (index + 1) * size));
    const earlier = finishedChunks(path.join(directory, 'chunks'));
    if (earlier.results.length > 0) process.stdout.write(`Resuming: ${earlier.ran.size} cases ran in ${earlier.results.length} earlier chunks\n`);
    const queue = chunk(runOrder(cases.filter((entry) => !earlier.ran.has(entry.id))));
    const done = [...earlier.results];
    let number = earlier.count;
    let seen = null;
    let retried = false;
    while (queue.length > 0) {
        const step = nextStep(seen, limits);
        if (step.action === 'stop') {
            process.stdout.write(`Stopped before ${queue.flat().length} cases: ${step.reason}. Run again on the same --out with a higher --week-max to go on.\n`);
            break;
        }
        if (step.action === 'wait') {
            process.stdout.write(`Five-hour window at ${Math.round(seen.fiveHour * 100)}%: waiting until ${time(step.until)}.\n`);
            await new Promise((resolve) => { setTimeout(resolve, Math.max(0, step.until - Date.now())); });
        }
        const list = queue.shift();
        number += 1;
        const name = `chunk-${String(number).padStart(3, '0')}`;
        process.stdout.write(`${time(Date.now())} ${name}: ${list.map((entry) => entry.id).join(' ')}\n`);
        const results = runCases(list, cases, path.join(directory, 'chunks', name), projects);
        done.push(results);
        seen = windowsSeen(results) ?? seen;
        const share = (value) => (value === null ? 'unreported' : `${Math.round(value * 100)}%`);
        if (seen) process.stdout.write(`Windows: five-hour ${share(seen.fiveHour)}, weekly ${share(seen.week)}\n`);
        if (queue.length === 0 && !retried) {
            retried = true;
            const failed = new Set(combineResults(done, path.join(directory, 'results')).errors.map((row) => row.id));
            if (failed.size > 0) {
                process.stdout.write(`Retrying ${failed.size} cases that failed: ${[...failed].join(' ')}\n`);
                queue.push(...chunk(cases.filter((entry) => failed.has(entry.id))));
            }
        }
    }
    return combineResults(done, path.join(directory, 'results'));
}

const cases = selectCases(options);
const directory = outputDirectory(options.out);
const projects = writeProjects(new Set(cases.map((entry) => entry.fixture)), path.join(directory, 'projects'));
const arms = options['without-skill'] ? 2 : 1;
process.stdout.write([
    `Cases:   ${cases.length} (${cases.map((entry) => entry.id).join(', ')})`,
    `Runs:    ${cases.length * Number(options.runs) * arms} agent sessions on ${options.model} at ${options.effort ?? 'default'} effort; claims judged by ${options['judge-model']}`,
    ...(options['chunk-size'] ? [`Paced:   ${options['chunk-size']} cases at a time; waits above ${options['five-hour-max']} of the five-hour window, stops above ${options['week-max']} of the weekly one`] : []),
    '',
].join('\n'));

if (options['chunk-size'] && options.run) {
    printSummary(await runPaced(cases, directory, projects));
    process.stdout.write(`Results: ${path.join(directory, 'results')}\n`);
    process.exit(0);
}
const results = runCases(cases, cases, directory, projects);
if (!results) {
    process.stdout.write('Nothing was run. Add --run, with --trust-plugin and --scaffold, to start the runs.\n');
    process.exit(0);
}
printSummary({ summary: JSON.parse(fs.readFileSync(path.join(results, 'summary.json'), 'utf8')) });
process.stdout.write(`Results: ${results}\n`);
