import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    draftOf, editDraft, parseDrafts, projectOf, replacesEdits,
} from '../src/playground/drafts.js';
import {
    addFile, addPackage, removeFile, setFile,
} from '../src/playground/project.js';

const SAMPLES = [
    { id: 'hello', project: { files: { 'main.js': 'js', 'native/native.h': 'h', 'native/native.cpp': 'cpp' }, packages: [] } },
    { id: 'hero', project: { files: { 'main.js': 'hjs', 'native/greet.h': 'g' }, packages: ['port:sqlite3', 'crate:uuid'] } },
];
const [HELLO, HERO] = SAMPLES;

test('a draft holds only what differs from its sample: edited and added files, deleted ones, a changed package list', () => {
    const project = addPackage(removeFile(addFile(setFile(HELLO.project, 'main.js', 'edited'), 'more.rs'), 'native/native.cpp'), 'port:zlib');
    assert.deepEqual(draftOf(project, HELLO), {
        files: { 'main.js': 'edited', 'native/more.rs': '' },
        removed: ['native/native.cpp'],
        packages: ['port:zlib'],
    });
    assert.deepEqual(projectOf(HELLO, draftOf(project, HELLO)), project);
});

test('packages in another order are the same list', () => {
    assert.equal(draftOf({ ...HERO.project, packages: ['crate:uuid', 'port:sqlite3'] }, HERO), null);
});

test('drafts of unknown samples, names the compiler refuses, values that are not text and unknown packages are dropped', () => {
    const stored = {
        sample: 'gone',
        drafts: {
            gone: { files: { 'main.js': 'x' } },
            hello: {
                files: { 'main.js': 1, 'notes.txt': 'x', '../x.h': 'x', 'native/native.h': 'changed' },
                removed: ['main.js', 'native/missing.h'],
                packages: ['port:gdal', 'crate:uuid', 7],
            },
        },
    };
    assert.deepEqual(parseDrafts(stored, SAMPLES), {
        sample: undefined,
        drafts: { hello: { files: { 'native/native.h': 'changed' }, packages: ['crate:uuid'] } },
    });
});

test('anything stored that is not a set of drafts gives none, the first playground\'s three files among them', () => {
    for (const stored of [null, 42, 'text', [], { drafts: 'x' }, { 'native.h': 'h', 'native.cpp': 'cpp', 'main.js': 'js' }]) {
        assert.deepEqual(parseDrafts(stored, SAMPLES), { sample: undefined, drafts: {} });
    }
});

test('undoing the last change removes the draft', () => {
    const edited = editDraft({}, HELLO, (project) => setFile(project, 'main.js', 'edited'));
    assert.deepEqual(edited, { hello: { files: { 'main.js': 'edited' } } });
    assert.deepEqual(editDraft(edited, HELLO, (project) => setFile(project, 'main.js', 'js')), {});
});

test('a change applies to the draft as stored, so another tab\'s edit to the same sample stays', () => {
    const stored = { hello: { files: { 'native/native.h': 'from the other tab' } } };
    assert.deepEqual(editDraft(stored, HELLO, (project) => setFile(project, 'main.js', 'mine')), {
        hello: { files: { 'native/native.h': 'from the other tab', 'main.js': 'mine' } },
    });
});

test('handing a draft over replaces no edits when the drafts hold none of that sample or the same project', () => {
    const draft = { files: { 'main.js': 'edited', 'native/more.h': 'm' } };
    const sameInAnotherOrder = { files: { 'native/more.h': 'm', 'main.js': 'edited' } };
    assert.equal(replacesEdits({}, HELLO, draft), false);
    assert.equal(replacesEdits({ hero: { files: { 'main.js': 'other' } } }, HELLO, draft), false);
    assert.equal(replacesEdits({ hello: sameInAnotherOrder }, HELLO, draft), false);
});

test('handing a draft over replaces edits of that sample that differ', () => {
    const draft = { files: { 'main.js': 'edited' } };
    assert.equal(replacesEdits({ hello: { files: { 'main.js': 'mine' } } }, HELLO, draft), true);
    assert.equal(replacesEdits({ hello: { removed: ['native/native.cpp'] } }, HELLO, draft), true);
    assert.equal(replacesEdits({ hello: { files: { 'main.js': 'edited' }, packages: ['port:zlib'] } }, HELLO, draft), true);
    assert.equal(replacesEdits({ hello: { files: { 'main.js': 'edited' }, removed: ['native/native.cpp'] } }, HELLO, draft), true);
    assert.equal(replacesEdits({ hero: { packages: ['port:sqlite3'] } }, HERO, { files: { 'main.js': 'hjs2' } }), true);
});

test('an edit leaves the other samples\' drafts alone', () => {
    const drafts = { hero: { files: { 'main.js': 'kept' } } };
    assert.deepEqual(editDraft(drafts, HELLO, (project) => setFile(project, 'native/native.h', 'changed')), {
        hero: { files: { 'main.js': 'kept' } },
        hello: { files: { 'native/native.h': 'changed' } },
    });
});
