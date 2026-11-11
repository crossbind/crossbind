import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PACKAGES } from '../compiler/packages.js';

const WARM = fileURLToPath(new URL('../compiler/warm.js', import.meta.url));

test('readies the template to build every package once: all declared, each imported as a compile would', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playground-warm-'));
    try {
        fs.mkdirSync(path.join(dir, 'src'));
        execFileSync(process.execPath, [WARM, dir]);
        const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

        const declared = read('crossbind.config.js').split('\n').map((line) => line.trim());
        PACKAGES.forEach((pkg) => assert.ok(declared.some((line) => (pkg.source === 'port' ? line.includes(pkg.package) : line.startsWith(`${pkg.name}: '`))), pkg.id));
        PACKAGES.filter(({ use }) => use.import)
            .forEach(({ use }) => assert.ok(read('src/main.js').includes(`import { ${use.names.join(', ')} } from '${use.import}';`), use.import));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
