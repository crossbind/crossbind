import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectCrossbindTarball, smokeTestCrossbindTarball } from '../package-artifact.mjs';

test('the exact tarball is installed and smoked without release credentials', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-package-artifact-test-'));
    const tarball = path.join(root, 'crossbind-9.9.9-beta.41.tgz');
    const smoke = path.join(root, 'smoke');
    fs.writeFileSync(tarball, 'fixture tarball bytes');
    const calls = [];
    const previousToken = process.env.NODE_AUTH_TOKEN;
    process.env.NODE_AUTH_TOKEN = 'must-not-reach-smoke-test';
    try {
        const result = smokeTestCrossbindTarball({
            tarball,
            expectedVersion: '9.9.9-beta.41',
            temporaryRoot: smoke,
            run(command, args, options) {
                calls.push({ command, args, options });
                if (command === 'npm') {
                    const installed = path.join(smoke, 'node_modules', 'crossbind');
                    fs.mkdirSync(installed, { recursive: true });
                    fs.writeFileSync(path.join(installed, 'package.json'), `${JSON.stringify({ name: 'crossbind', version: '9.9.9-beta.41' })}\n`);
                    return '';
                }
                return args.includes('--version') ? '9.9.9-beta.41\n' : '';
            },
        });
        assert.equal(result.integrity, inspectCrossbindTarball(tarball).integrity);
        assert.equal(calls[0].command, 'npm');
        assert.deepEqual(calls[0].args.slice(0, 4), ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
        assert.equal(calls[0].args.at(-1), tarball);
        assert.equal(calls[0].options.env.NODE_AUTH_TOKEN, undefined);
        assert.equal(calls.filter((call) => call.command === process.execPath).length, 2);
    } finally {
        if (previousToken === undefined) delete process.env.NODE_AUTH_TOKEN;
        else process.env.NODE_AUTH_TOKEN = previousToken;
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('a missing tarball fails before npm is invoked', () => {
    assert.throws(() => inspectCrossbindTarball('/definitely/missing/crossbind.tgz'), /does not exist/);
});
