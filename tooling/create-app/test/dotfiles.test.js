import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packDotfiles, unpackDotfiles } from '../src/dotfiles.js';

function tempDirWith(t, files) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'create-crossbind-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
}

test('packing copies the ignore files and keeps the originals, whose rules npm applies while packing', async (t) => {
    const dir = tempDirWith(t, { '.gitignore': 'node_modules\n', '.npmignore': '.crossbind\n', 'package.json': '{}' });

    await packDotfiles(dir);

    assert.deepEqual(fs.readdirSync(dir).sort(), ['.gitignore', '.npmignore', '_gitignore', '_npmignore', 'package.json']);
    assert.equal(fs.readFileSync(path.join(dir, '_gitignore'), 'utf8'), 'node_modules\n');
});

test('unpacking restores them with their content and skips the ones a template lacks', async (t) => {
    const dir = tempDirWith(t, { _gitignore: 'node_modules\n', 'package.json': '{}' });

    await unpackDotfiles(dir);

    assert.deepEqual(fs.readdirSync(dir).sort(), ['.gitignore', 'package.json']);
    assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\n');
});
