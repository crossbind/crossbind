import assert from 'node:assert/strict';
import test from 'node:test';

import { caseFiles, pluginManifest } from '../../scripts/skill-eval/bundle.mjs';
import { loadCases } from './skill-cases/load.mjs';

const MUST = {
    id: 'p900',
    prompt: '`native/` holds my C++.',
    tags: ['runtime'],
    fixture: 'empty',
    trigger: 'must',
    expect: 'do',
    split: 'train',
    route: ['references/api/app.md', 'references/ports.json'],
    facts: [
        { claim: 'Says one thing', doc: 'docs/api/app.md', literal: 'one' },
        { claim: 'Says another', doc: 'docs/api/app.md', literal: 'another' },
    ],
};
const NEGATIVE = { id: 'a900', prompt: 'Add dark mode.', tags: ['negative'], fixture: 'empty', trigger: 'must-not', split: 'test' };
const EITHER = { id: 'p901', prompt: 'Make a to-do app.', tags: ['boundary'], fixture: 'empty', trigger: 'either', expect: 'do', split: 'train' };

test('a must case asks for the skill, its references and each claim', () => {
    const files = caseFiles(MUST);
    assert.match(files['graders/trigger.md'], /^---\ntype: tool_used\ntool: Skill\ninput_match: '"skill"\\s\*:\\s\*"\(\?:\[\\w-\]\+:\)\?crossbind"'\n---\n$/);
    assert.match(files['graders/route.md'], /tool: Read\ninput_match: '\(\?:references\/api\/app\\\.md\|references\/ports\\\.json\)'\n/);
    assert.match(files['graders/fact-1.md'], /^---\ntype: llm\n---\n\nThe assistant worked in a read-only session, so its final answer is a plan\.\nPASS if the answer does this, or tells the user to do it: Says one thing\.\n/);
    assert.match(files['graders/fact-1.md'], /\nThat nothing was run or changed is no reason to fail\.\n/);
    assert.match(files['graders/fact-2.md'], /tells the user to do it: Says another\.\n/);
    assert.equal(files['graders/fact-3.md'], undefined);
});

test('the prompt reaches the agent word for word, with the read-only tools', () => {
    const prompt = caseFiles(MUST)['prompt.md'];
    assert.ok(prompt.endsWith('---\n\n`native/` holds my C++.\n'));
    assert.match(prompt, /^---\nname: p900\ntags: \[runtime, must, train\]\n/);
    assert.match(prompt, /\nallowed_tools: \[Read, Glob, Grep, Skill, Bash\]\n/);
});

test('a negative fails as soon as the skill loads', () => {
    const files = caseFiles(NEGATIVE);
    assert.match(files['graders/trigger.md'], /\nmin: 0\nmax: 0\n---\n$/);
    assert.deepEqual(Object.keys(files).sort(), ['graders/answered.md', 'graders/trigger.md', 'prompt.md']);
});

test('a case where either answer is right keeps a grader, and none for the skill', () => {
    assert.deepEqual(Object.keys(caseFiles(EITHER)).sort(), ['graders/answered.md', 'prompt.md']);
});

test("a case's script copies its project into the workspace", () => {
    const files = caseFiles(MUST, "/tmp/it's here/site");
    assert.equal(files['case.yaml'], 'schema_version: "1.1"\nname: p900\ncontext:\n  scaffold_script: fixture.sh\n');
    assert.ok(files['fixture.sh'].includes("cp -R '/tmp/it'\\''s here/site'/. .\n"));
    assert.equal(caseFiles(MUST)['case.yaml'], undefined);
});

test('every case of the table makes a prompt and at least one grader', () => {
    for (const entry of loadCases()) {
        const files = caseFiles(entry);
        assert.ok(files['prompt.md'].endsWith(`\n${entry.prompt}\n`), entry.id);
        assert.ok(Object.keys(files).some((file) => file.startsWith('graders/')), entry.id);
        assert.equal(Object.keys(files).filter((file) => file.startsWith('graders/fact-')).length, entry.facts?.length ?? 0, entry.id);
    }
});

test('the manifest names the plugin after the skill', () => {
    assert.deepEqual(Object.keys(pluginManifest('1.2.3')).sort(), ['description', 'name', 'version']);
    assert.equal(pluginManifest('1.2.3').name, 'crossbind');
});
