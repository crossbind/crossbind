import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseArguments, scaffoldPort } from '../../scripts/scaffold-port.mjs';

test('parses port options independently of argument order', () => {
    assert.deepEqual(parseArguments(['--force', 'demo', '--lib', 'demo_core', '--license', 'Apache-2.0']), {
        name: 'demo',
        lib: 'demo_core',
        license: 'Apache-2.0',
        force: true,
    });
    assert.deepEqual(parseArguments(['demo', '--force']), {
        name: 'demo',
        lib: 'demo',
        license: 'MIT',
        force: true,
    });
});

test('rejects malformed port options', () => {
    assert.throws(() => parseArguments(['demo', '--license']), /--license requires a value/);
    assert.throws(() => parseArguments(['--unknown', 'demo']), /unknown option/);
    assert.throws(() => parseArguments(['demo', 'extra']), /unexpected argument/);
});

test('scaffolds a neutral port family without carrying zlib metadata', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-scaffold-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    const destination = scaffoldPort({ name: 'demo-lib', lib: 'demo', license: 'Apache-2.0', root });
    const base = JSON.parse(fs.readFileSync(path.join(destination, 'base', 'package.json'), 'utf8'));
    const wasm = JSON.parse(fs.readFileSync(path.join(destination, 'wasm', 'package.json'), 'utf8'));
    const build = fs.readFileSync(path.join(destination, 'base', 'build.mjs'), 'utf8');
    const license = fs.readFileSync(path.join(destination, 'wasm', 'LICENSE'), 'utf8');

    assert.equal(base.name, '@crossbind/port-demo-lib');
    assert.equal(base.nativeVersion, 'TODO');
    assert.equal(base.license, 'Apache-2.0');
    assert.equal(base.crossbind.upstream.license.declared, 'Apache-2.0');
    assert.equal(wasm.dependencies['@crossbind/port-demo-lib'], 'workspace:^');
    assert.equal(wasm.dependencies['@crossbind/port-zlib'], undefined);
    assert.match(build, /sha256: 'TODO'/);
    assert.match(license, /replace this file with the complete upstream demo-lib license/);
});

test('rejects invalid or existing port names', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-scaffold-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));

    assert.throws(() => scaffoldPort({ name: '../escape', root }), /port name/);
    scaffoldPort({ name: 'demo', root });
    assert.throws(() => scaffoldPort({ name: 'demo', root }), /already exists/);
});
