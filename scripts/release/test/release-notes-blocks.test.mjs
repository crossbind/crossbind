import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseReleaseNotes } from '../release-lib.mjs';
import { releaseNotesBlocks } from '../release-notes-blocks.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NOTES_DIRECTORY = path.join(REPOSITORY_ROOT, 'releases', 'crossbind');

test('the template subset converts to the site block model', () => {
    const blocks = releaseNotesBlocks(
        [
            '## Highlights',
            '',
            '- Moves the CLI to Node.js 24.',
            '- Introduces an exact-artifact npm release train with `--provenance`',
            '  and version-specific GitHub Releases.',
            '',
            '## Breaking changes',
            '',
            'None.',
            '',
            '### Details',
            '',
            'First line of a paragraph',
            'second line of the same paragraph.',
            '',
            '1. Upgrade Node.',
            '2. Reinstall.',
        ].join('\n'),
    );
    assert.deepEqual(blocks, [
        { type: 'h2', id: 'highlights', text: 'Highlights' },
        {
            type: 'ul',
            items: [
                'Moves the CLI to Node.js 24.',
                'Introduces an exact-artifact npm release train with `--provenance` and version-specific GitHub Releases.',
            ],
        },
        { type: 'h2', id: 'breaking-changes', text: 'Breaking changes' },
        { type: 'p', text: 'None.' },
        { type: 'h3', text: 'Details' },
        { type: 'p', text: 'First line of a paragraph second line of the same paragraph.' },
        { type: 'ol', items: ['Upgrade Node.', 'Reinstall.'] },
    ]);
});

test('a lazy list continuation without indentation still belongs to its item', () => {
    const blocks = releaseNotesBlocks('## Fixes\n\n- One item that\ncontinues here.\n- Second.\n');
    assert.deepEqual(blocks[1], { type: 'ul', items: ['One item that continues here.', 'Second.'] });
});

test('repeated headings get distinct anchor ids', () => {
    const blocks = releaseNotesBlocks('## Fixes\n\nA.\n\n## Fixes\n\nB.\n');
    assert.deepEqual(
        blocks.filter((block) => block.type === 'h2').map((block) => block.id),
        ['fixes', 'fixes-2'],
    );
});

for (const [label, markdown] of [
    ['a level-one heading', '# Title\n\nBody.\n'],
    ['a level-four heading', '#### Deep\n\nBody.\n'],
    ['an inline HTML tag', '## Fixes\n\nUse <code>x</code>.\n'],
    ['an image', '## Fixes\n\n![alt](https://example.com/x.png)\n'],
    ['an asterisk bullet', '## Fixes\n\n* item\n'],
    ['a reference-style link', '## Fixes\n\nSee [docs][1].\n\n[1]: https://example.com\n'],
    ['an indented line outside a list', '## Fixes\n\nA paragraph\n    that is suddenly indented.\n'],
    ['a table without a delimiter row', '## Fixes\n\n| a | b |\n| 1 | 2 |\n'],
    ['a table row with the wrong width', '## Fixes\n\n| a | b |\n| - | - |\n| 1 |\n'],
]) {
    test(`${label} is rejected with its line number`, () => {
        assert.throws(() => releaseNotesBlocks(markdown, 'notes.md'), /notes\.md:\d+: unsupported Markdown/);
    });
}

test('fenced code, pipe tables, quotes and rules map onto the blocks the site renders', () => {
    const blocks = releaseNotesBlocks(
        [
            '## Migration notes',
            '',
            'Run:',
            '',
            '```sh',
            'npm install crossbind@beta',
            '',
            '  # keeps indentation',
            '```',
            '',
            '| Package | Tag |',
            '| ------- | :-: |',
            '| `crossbind` | `beta` |',
            '| `create-crossbind` | `beta` \\| `next` |',
            '',
            '> Prereleases carry no compatibility',
            '> guarantee yet.',
            '',
            '---',
            '',
            '~~~',
            'plain fence',
            '~~~',
        ].join('\n'),
    );
    assert.deepEqual(blocks, [
        { type: 'h2', id: 'migration-notes', text: 'Migration notes' },
        { type: 'p', text: 'Run:' },
        { type: 'code', file: 'sh', code: 'npm install crossbind@beta\n\n  # keeps indentation' },
        {
            type: 'table',
            head: ['Package', 'Tag'],
            rows: [
                ['`crossbind`', '`beta`'],
                ['`create-crossbind`', '`beta` | `next`'],
            ],
        },
        { type: 'callout', tone: 'note', title: 'Note', text: 'Prereleases carry no compatibility guarantee yet.' },
        { type: 'code', file: 'text', code: 'plain fence' },
    ]);
});

test('an unclosed fence is rejected', () => {
    assert.throws(() => releaseNotesBlocks('## Fixes\n\n```\nnever closed\n', 'notes.md'), /notes\.md: a fenced code block is never closed/);
});

test('an empty body is rejected', () => {
    assert.throws(() => releaseNotesBlocks('\n\n', 'notes.md'), /notes\.md: the release-note body is empty/);
});

test('every canonical release note in the repository converts, including the template', () => {
    const files = fs.readdirSync(NOTES_DIRECTORY).filter((name) => name.endsWith('.md'));
    assert.ok(files.includes('TEMPLATE.md'));
    for (const name of files) {
        const notes = parseReleaseNotes(fs.readFileSync(path.join(NOTES_DIRECTORY, name), 'utf8'), name);
        const blocks = releaseNotesBlocks(notes.body, name);
        assert.ok(
            blocks.some((block) => block.type === 'h2'),
            `${name}: expected at least one h2`,
        );
    }
});
