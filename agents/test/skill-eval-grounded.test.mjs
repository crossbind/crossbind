import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildVocabulary, bundledDocuments, ungrounded } from '../../scripts/skill-eval/grounded.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const vocabulary = buildVocabulary(ROOT);
const found = (answer) => ungrounded(answer, vocabulary).map(({ kind, text }) => `${kind}: ${text}`);

test('the vocabulary holds what the documents and the workspace have', () => {
    for (const command of ['build', 'app', 'add', 'login', 'licenses', 'runner']) assert.ok(vocabulary.commands.has(command), command);
    for (const pair of ['app build', 'app dev', 'app upload', 'app release', 'app key', 'config set', 'runner start']) assert.ok(vocabulary.subcommands.has(pair), pair);
    for (const name of ['@crossbind/port-gdal', '@crossbind/core-app-host', '@crossbind/extension-vite']) assert.ok(vocabulary.packages.has(name), name);
    for (const name of ['app', 'dialog', 'events', 'updater']) assert.ok(vocabulary.imports.get('crossbind/app').has(name), name);
    assert.ok(vocabulary.imports.get('crossbind/licenses').has('licenses'));
    assert.ok(vocabulary.templates.has('desktop app') && vocabulary.templates.has('library prebuilt') && vocabulary.templates.has('extension'));
});

test('an answer that keeps to them is grounded', () => {
    const answer = [
        'crossbind builds the page for you. Install `@crossbind/port-gdal@beta` and run `pnpm crossbind app build -p ios`.',
        '```bash',
        'npm create crossbind@beta -- my-app Desktop App',
        'npx crossbind add @crossbind/extension-clipboard',
        'crossbind config set RUNNER REMOTE   # then crossbind login',
        '```',
        "```js\nimport { app, events as hostEvents } from 'crossbind/app';\nimport { licenses } from 'crossbind/licenses';\n```",
    ].join('\n');
    assert.deepEqual(found(answer), []);
});

test('an invented command, package, import or template is named', () => {
    assert.deepEqual(found('Run `crossbind deploy`.'), ['command: crossbind deploy']);
    assert.deepEqual(found('```\npnpm crossbind app publish --draft\n```'), ['command: crossbind app publish']);
    assert.deepEqual(found('Run `crossbind key updater`.'), ['command: crossbind key']);
    assert.deepEqual(found('Install @crossbind/port-tesseract first.'), ['package: @crossbind/port-tesseract']);
    assert.deepEqual(found("```js\nimport { app, fs } from 'crossbind/app';\n```"), ['import: fs from crossbind/app']);
    assert.deepEqual(found('`npm create crossbind@beta -- my-app Desktop Widget`'), ['template: Desktop Widget']);
});

test('a template ends where its shell command or a closing parenthesis does, and a placeholder directory may hold spaces', () => {
    assert.deepEqual(found('```bash\nnpm create crossbind@beta -- nonogram Desktop App && cd nonogram\n```'), []);
    assert.deepEqual(found('```bash\n# in a test app (npm create crossbind@beta -- demo "Desktop App")\n```'), []);
    assert.deepEqual(found('`npm create crossbind@beta -- <scratch dir> Library Prebuilt`'), []);
    assert.deepEqual(found('`npm create crossbind@beta -- x Desktop Ap; cd x`'), ['template: Desktop Ap']);
});

test('prose, placeholders and file names are left alone', () => {
    const answer = 'crossbind deploys nothing by itself. Pick a `@crossbind/port-<name>` or `@crossbind/port-gdal-<platform>`, '
        + 'edit `crossbind.config.js`, run `crossbind <command>` or `expo export -p web`, '
        + 'and start from `npm create crossbind@beta -- <dir> <template>`.';
    assert.deepEqual(found(answer), []);
});

test('each kind of slip is reported once', () => {
    assert.deepEqual(found('`crossbind deploy`, then `crossbind deploy` again, with @crossbind/port-ocr and @crossbind/port-ocr.'), [
        'command: crossbind deploy',
        'package: @crossbind/port-ocr',
    ]);
});

test('the documents the skill carries pass their own check', () => {
    for (const file of bundledDocuments(ROOT)) {
        assert.deepEqual(found(fs.readFileSync(path.join(ROOT, file), 'utf8')), [], file);
    }
});
