import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'src/manifest.json'), 'utf8'));

const shellWords = (line) => [...line.trim().matchAll(/"([^"]*)"|(\S+)/g)].map(([, quoted, word]) => quoted ?? word);

test('--help lists each template as words a shell passes on as its arguments', () => {
    const result = spawnSync(process.execPath, [path.join(PKG_DIR, 'src/index.js'), '--help'], { encoding: 'utf8' });

    assert.equal(result.status, 0);
    const rows = result.stdout.split('Templates:\n')[1].trim().split('\n');
    assert.deepEqual(
        rows.map(shellWords),
        MANIFEST.map((entry) => [entry.group, entry.framework ?? entry.label, ...(entry.framework ? [entry.label] : [])]),
    );
});
