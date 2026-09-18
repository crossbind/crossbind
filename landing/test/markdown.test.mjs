import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fenceLanguage, renderBlocks, shiftHeadings } from '../src/llms/markdown.js';

const absolute = (href) => (href.startsWith('/') ? `https://example.test${href}` : href);

test('maps code block file names to fence languages', () => {
    assert.equal(fenceLanguage('shell'), 'sh');
    assert.equal(fenceLanguage('src/main.js'), 'js');
    assert.equal(fenceLanguage('crossbind.config.mjs'), 'js');
    assert.equal(fenceLanguage('src/native/Matrix.h'), 'cpp');
    assert.equal(fenceLanguage('src/lib.rs'), 'rust');
    assert.equal(fenceLanguage('AGENTS.md'), 'md');
    assert.equal(fenceLanguage('prompt'), 'text');
    assert.equal(fenceLanguage(undefined), 'text');
});

test('renders headings, paragraphs and lists with rewritten links', () => {
    const markdown = renderBlocks([
        { type: 'h2', text: 'Setup' },
        { type: 'p', text: 'See [Runtimes](/guide/runtimes/) and `init`.' },
        { type: 'ul', items: ['one', '[two](/guide/two/)'] },
        { type: 'ol', items: ['first', 'second'] },
        { type: 'h3', text: 'Deeper' },
    ], absolute);

    assert.equal(markdown, [
        '## Setup',
        '',
        'See [Runtimes](https://example.test/guide/runtimes/) and `init`.',
        '',
        '- one',
        '- [two](https://example.test/guide/two/)',
        '',
        '1. first',
        '2. second',
        '',
        '### Deeper',
    ].join('\n'));
});

test('fences code with its language and labels named files', () => {
    assert.equal(renderBlocks([{ type: 'code', file: 'shell', code: 'npm run build' }]), '```sh\nnpm run build\n```');
    assert.equal(
        renderBlocks([{ type: 'code', file: 'src/main.js', code: 'await initNative();' }]),
        '`src/main.js`:\n\n```js\nawait initNative();\n```',
    );
    assert.equal(renderBlocks([{ type: 'code', file: 'prompt', code: 'Add crossbind.' }]), 'Prompt:\n\n```text\nAdd crossbind.\n```');
});

test('uses a longer fence when the code contains backtick runs', () => {
    const markdown = renderBlocks([{ type: 'code', file: 'AGENTS.md', code: 'text\n```js\nx\n```' }]);
    assert.equal(markdown, '`AGENTS.md`:\n\n````md\ntext\n```js\nx\n```\n````');
});

test('renders callouts as quoted paragraphs with a default title per tone', () => {
    assert.equal(renderBlocks([{ type: 'callout', tone: 'warn', text: 'Careful.' }]), '> **Watch out:** Careful.');
    assert.equal(renderBlocks([{ type: 'callout', tone: 'note', title: 'First build', text: 'Slow once.' }]), '> **First build:** Slow once.');
    assert.equal(renderBlocks([{ type: 'callout', text: 'Plain.' }]), '> **Note:** Plain.');
});

test('renders pipe tables and escapes pipes inside cells', () => {
    const markdown = renderBlocks([{
        type: 'table',
        head: ['Option', 'Type'],
        rows: [['`a`', "'st' | 'mt'"], ['b', 'multi\nline']],
    }]);

    assert.equal(markdown, ['| Option | Type |', '| --- | --- |', "| `a` | 'st' \\| 'mt' |", '| b | multi line |'].join('\n'));
});

test('escapes backslashes in table cells so an escaped pipe cannot split the row', () => {
    const markdown = renderBlocks([{
        type: 'table',
        head: ['Input', 'Path'],
        rows: [[String.raw`a\|b`, String.raw`C:\tmp`]],
    }]);

    assert.equal(markdown.split('\n').at(-1), String.raw`| a\\\|b | C:\\tmp |`);
});

test('demotes a page under a prefixed section title without touching code fences', () => {
    const page = [
        '# Quick start',
        '',
        '> Prerequisites.',
        '',
        '## Prerequisites',
        '',
        '```sh',
        '# not a heading',
        'docker --version',
        '```',
        '',
        '### iOS',
        '',
        '#pragma once is prose here',
    ].join('\n');

    assert.equal(shiftHeadings(page, 'Guide: Quick start'), [
        '## Guide: Quick start',
        '',
        '> Prerequisites.',
        '',
        '### Prerequisites',
        '',
        '```sh',
        '# not a heading',
        'docker --version',
        '```',
        '',
        '#### iOS',
        '',
        '#pragma once is prose here',
    ].join('\n'));
});

test('renders cards and release rows, and skips unknown blocks', () => {
    const markdown = renderBlocks([
        { type: 'cards', items: [{ title: 'Quick start', desc: 'First call.', href: '/guide/quick-start/' }] },
        { type: 'mystery' },
        {
            type: 'release',
            release: {
                channel: 'beta',
                prerelease: true,
                publishedAt: '2026-09-09T10:00:00.000Z',
                npmUrl: 'https://npm.test/p',
                githubReleaseUrl: 'https://gh.test/r',
            },
        },
    ], absolute);

    assert.equal(markdown, [
        '- [Quick start](https://example.test/guide/quick-start/): First call.',
        '',
        'Beta · prerelease · published 9 September 2026 · [npm](https://npm.test/p) · [GitHub Release](https://gh.test/r)',
    ].join('\n'));
});
