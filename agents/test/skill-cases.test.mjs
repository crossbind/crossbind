import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { inspectProject } from '../skills/crossbind/scripts/inspect-project.mjs';
import { FIXTURES, writeFixture } from './skill-cases/fixtures.mjs';
import { EXPECTATIONS, GROUPS, SPLITS, TRIGGERS, loadCases } from './skill-cases/load.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL_ROOT = path.join(ROOT, 'agents', 'skills', 'crossbind');
const CASES = loadCases();

const PROMPT_COUNT = 111;
// p089 compares crossbind with another product by name, so it stays out of the repository.
const KEPT_OUT = ['p089'];
const MAX_FACTS = 5;
// A group this small may land wholly on one side of the split.
const SMALLEST_SPLIT_GROUP = 5;

// A claim may rest on what an installed skill carries alone: the documents its references are made from, the skill
// file and the port catalog.
const references = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'references', 'manifest.json'), 'utf8')).references;
const BUNDLED_SOURCES = new Set([
    ...references.map((reference) => reference.source),
    'agents/skills/crossbind/SKILL.md',
    'agents/skills/crossbind/references/ports.json',
]);

const squash = (text) => text.replace(/\s+/g, ' ').trim();
const documents = new Map();
function documentText(file) {
    if (!documents.has(file)) documents.set(file, squash(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    return documents.get(file);
}

test('ids and prompts are unique, and every numbered prompt has its case', () => {
    const ids = CASES.map((entry) => entry.id);
    assert.equal(new Set(ids).size, ids.length, 'two cases share an id');
    assert.equal(new Set(CASES.map((entry) => entry.prompt)).size, CASES.length, 'two cases share a prompt');
    for (const id of ids) assert.match(id, /^[pa]\d{3}$/, `${id} is neither p### nor a###`);

    const numbered = Array.from({ length: PROMPT_COUNT }, (unused, index) => `p${String(index + 1).padStart(3, '0')}`);
    assert.deepEqual(ids.filter((id) => id.startsWith('p')).sort(), numbered.filter((id) => !KEPT_OUT.includes(id)));
});

test('every case has the fields of its kind', () => {
    for (const entry of CASES) {
        const { id } = entry;
        assert.ok(typeof entry.prompt === 'string' && entry.prompt.trim() === entry.prompt && entry.prompt.length > 0, `${id}: prompt`);
        assert.ok(Array.isArray(entry.tags) && GROUPS.includes(entry.tags[0]), `${id}: the first tag is no group`);
        assert.ok(TRIGGERS.includes(entry.trigger), `${id}: trigger`);
        assert.ok(SPLITS.includes(entry.split), `${id}: split; run agents/test/skill-cases/assign-split.mjs`);
        assert.ok(entry.fixture in FIXTURES, `${id}: unknown fixture ${entry.fixture}`);
        assert.equal(entry.tags[0] === 'negative', entry.trigger === 'must-not', `${id}: negative and must-not go together`);

        const facts = entry.facts ?? [];
        const route = entry.route ?? [];
        if (entry.trigger === 'must-not') {
            assert.deepEqual([facts.length, route.length, entry.expect], [0, 0, undefined], `${id}: a negative takes no facts, route or expect`);
            continue;
        }
        assert.ok(EXPECTATIONS.includes(entry.expect), `${id}: expect`);
        assert.ok(facts.length <= MAX_FACTS, `${id}: more than ${MAX_FACTS} facts`);
        if (entry.trigger === 'must') assert.ok(facts.length > 0 && route.length > 0, `${id}: a must case needs facts and a route`);
    }
});

test('every route is a file of the skill', () => {
    for (const entry of CASES) {
        for (const route of entry.route ?? []) {
            assert.ok(route.startsWith('references/') && fs.existsSync(path.join(SKILL_ROOT, route)), `${entry.id}: no ${route} in the skill`);
        }
    }
});

test('every claim rests on a document the skill carries, which still says it', () => {
    for (const entry of CASES) {
        for (const fact of entry.facts ?? []) {
            const where = `${entry.id}: "${fact.claim}"`;
            assert.ok(typeof fact.claim === 'string' && fact.claim.length > 0, `${entry.id}: a fact without a claim`);
            assert.ok(BUNDLED_SOURCES.has(fact.doc), `${where} rests on ${fact.doc}, which the skill does not carry`);
            assert.ok(typeof fact.literal === 'string' && squash(fact.literal).length >= 4, `${where} has no literal to hold it to`);
            assert.ok(documentText(fact.doc).includes(squash(fact.literal)), `${where}: ${fact.doc} no longer has "${fact.literal}"`);
        }
    }
});

test('every fixture is used, and a template fixture names a template', () => {
    const templates = JSON.parse(fs.readFileSync(path.join(ROOT, 'tooling', 'create-app', 'src', 'manifest.json'), 'utf8'));
    const used = new Set(CASES.map((entry) => entry.fixture));
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        assert.ok(used.has(name), `no case runs in the fixture ${name}`);
        if (fixture.template) {
            assert.ok(templates.some((template) => template.key === fixture.template), `${name}: no template ${fixture.template}`);
            assert.match(fixture.name ?? '', /^[a-z][a-z0-9-]*$/, `${name}: a template fixture takes its project's name`);
        }
        if (fixture.extends) assert.ok(FIXTURES[fixture.extends]?.files, `${name} extends ${fixture.extends}, which has no files`);
    }
});

test('the inspector reads every fixture that has files of its own', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-skill-cases-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [name, fixture] of Object.entries(FIXTURES)) {
        if (fixture.template) continue;
        const directory = path.join(root, name);
        fs.mkdirSync(directory);
        writeFixture(name, directory);
        assert.equal(inspectProject(directory).existingCrossbind.installed, name === 'wasi-crossbind', `${name}: crossbind installed`);
    }
});

test('each group is split between train and test', () => {
    for (const [group, cases] of Map.groupBy(CASES, (entry) => entry.tags[0])) {
        if (cases.length < SMALLEST_SPLIT_GROUP) continue;
        const share = cases.filter((entry) => entry.split === 'test').length / cases.length;
        assert.ok(share >= 0.25 && share <= 0.55, `${group}: ${Math.round(share * 100)}% of its cases are test cases`);
    }
});
