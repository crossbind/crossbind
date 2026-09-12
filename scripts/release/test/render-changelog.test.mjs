import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    assertChangelogCurrent,
    compareVersionsDesc,
    loadNotes,
    REGION_END,
    REGION_START,
    renderChangelog,
    renderSection,
    splitChangelog,
} from '../render-changelog.mjs';

const note = (version, extra = '') => `---
package: crossbind
version: ${version}
title: Crossbind ${version}
summary: Summary for ${version}.
---

## Highlights

- Something in ${version}.${extra}
`;

function notesDirectory(versions) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-notes-'));
    fs.writeFileSync(path.join(directory, 'TEMPLATE.md'), note('0.0.0-beta.0'));
    for (const version of versions) fs.writeFileSync(path.join(directory, `${version}.md`), note(version));
    return directory;
}

const LEGACY = `# crossbind

${REGION_START}
${REGION_END}

## 2.0.0-beta.54

Hand-written entry.
`;

test('versions order newest first, stable above its prereleases', () => {
    const sorted = ['2.0.0-beta.9', '2.0.0', '2.0.0-beta.10', '1.9.3', '2.0.0-rc.1'].sort(compareVersionsDesc);
    assert.deepEqual(sorted, ['2.0.0', '2.0.0-rc.1', '2.0.0-beta.10', '2.0.0-beta.9', '1.9.3']);
});

test('notes load newest first; the template and other files in the directory are not notes', () => {
    const directory = notesDirectory(['2.0.0-beta.55', '2.0.0-beta.56']);
    fs.writeFileSync(path.join(directory, 'README.md'), '# not a note\n');
    const notes = loadNotes(directory);
    assert.deepEqual(
        notes.map((entry) => entry.version),
        ['2.0.0-beta.56', '2.0.0-beta.55'],
    );
    assert.equal(notes[0].summary, 'Summary for 2.0.0-beta.56.');
});

test('a note whose frontmatter version disagrees with its file name is refused', () => {
    const directory = notesDirectory([]);
    fs.writeFileSync(path.join(directory, '2.0.0-beta.57.md'), note('2.0.0-beta.56'));
    assert.throws(() => loadNotes(directory), /does not match the file name/);
});

test('a section demotes the note headings under the version heading', () => {
    const rendered = renderSection({ version: '2.0.0-beta.56', summary: 'Sum.', body: '## Highlights\n\n- One.' });
    assert.equal(rendered, '## 2.0.0-beta.56\n\nSum.\n\n### Highlights\n\n- One.\n');
});

test('rendering replaces only the region and keeps the hand-written tail', () => {
    const notes = loadNotes(notesDirectory(['2.0.0-beta.55', '2.0.0-beta.56']));
    const rendered = renderChangelog(LEGACY, notes);
    assert.match(rendered, /^# crossbind\n\n<!-- release-notes:start -->/);
    assert.ok(rendered.indexOf('## 2.0.0-beta.56') < rendered.indexOf('## 2.0.0-beta.55'));
    assert.ok(rendered.indexOf('## 2.0.0-beta.55') < rendered.indexOf('## 2.0.0-beta.54'));
    assert.ok(rendered.endsWith('## 2.0.0-beta.54\n\nHand-written entry.\n'));
    assert.equal(renderChangelog(rendered, notes), rendered, 'rendering is idempotent');
});

test('a file without the markers is refused', () => {
    assert.throws(() => renderChangelog('# crossbind\n', []), /markers/);
});

test('splitting returns every version section as plain Markdown, markers dropped', () => {
    const notes = loadNotes(notesDirectory(['2.0.0-beta.56']));
    const sections = splitChangelog(renderChangelog(LEGACY, notes));
    assert.deepEqual(
        sections.map((section) => section.version),
        ['2.0.0-beta.56', '2.0.0-beta.54'],
    );
    assert.equal(sections[0].body, 'Summary for 2.0.0-beta.56.\n\n### Highlights\n\n- Something in 2.0.0-beta.56.');
    assert.equal(sections[1].body, 'Hand-written entry.');
    assert.ok(!sections.some((section) => section.body.includes('<!--')));
});

test('the check passes on a rendered file and fails once a note changes', () => {
    const directory = notesDirectory(['2.0.0-beta.56']);
    const file = path.join(directory, 'CHANGELOG.md');
    fs.writeFileSync(file, renderChangelog(LEGACY, loadNotes(directory)));
    assert.doesNotThrow(() => assertChangelogCurrent({ file, directory }));
    fs.writeFileSync(path.join(directory, '2.0.0-beta.56.md'), note('2.0.0-beta.56', '\n- A late fix.'));
    assert.throws(() => assertChangelogCurrent({ file, directory }), /out of date .* run `pnpm changelog`/);
});
