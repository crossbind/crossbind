import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const script = path.resolve(import.meta.dirname, '../src/assets/configure/install.sh');

// Copies the way coreutils install does, creating each file 0600 and setting its mode last. FAKE_INSTALL picks
// whether that last step is refused (quoted as the C or a UTF-8 locale quotes), or the call fails for another reason.
const FAKE_INSTALL = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_INSTALL_CALLS, args.join(' ') + '\\n');
if (process.env.FAKE_INSTALL === 'missing') {
    console.error("install: cannot stat 'missing.a': No such file or directory");
    process.exit(1);
}
let mode = 0o755;
const files = [];
for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '-m') mode = parseInt(args[++i], 8);
    else if (args[i].startsWith('-m')) mode = parseInt(args[i].slice(2), 8);
    else if (args[i] !== '-c') files.push(args[i]);
}
const dest = files.pop();
let refused = false;
for (const file of files) {
    const target = fs.statSync(dest, { throwIfNoEntry: false })?.isDirectory() ? path.join(dest, path.basename(file)) : dest;
    fs.copyFileSync(file, target);
    fs.chmodSync(target, 0o600);
    if (process.env.FAKE_INSTALL === 'ok') {
        fs.chmodSync(target, mode);
    } else {
        const [open, close] = process.env.FAKE_INSTALL === 'refuse-utf8' ? ['\\u2018', '\\u2019'] : ["'", "'"];
        console.error('install: setting permissions for ' + open + target + close + ': Operation not permitted');
        refused = true;
    }
}
process.exit(refused ? 1 : 0);
`;

describe.skipIf(process.platform === 'win32')('install.sh', () => {
    let work;

    const runInstall = (behaviour, args) => {
        const bin = path.join(work, 'bin');
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, 'install'), FAKE_INSTALL, { mode: 0o755 });
        const result = spawnSync('sh', [script, ...args], {
            cwd: work,
            encoding: 'utf8',
            env: {
                ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_INSTALL: behaviour, FAKE_INSTALL_CALLS: path.join(work, 'calls'),
            },
        });
        const calls = fs.readFileSync(path.join(work, 'calls'), 'utf8').trim().split('\n');
        return { ...result, calls };
    };
    const modeOf = (file) => (fs.statSync(path.join(work, file)).mode & 0o777).toString(8);

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-install-'));
        fs.writeFileSync(path.join(work, 'libz.a'), 'archive');
        fs.writeFileSync(path.join(work, 'libz.pc'), 'pkg-config');
        fs.mkdirSync(path.join(work, 'lib'));
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    test('hands install its arguments unchanged and passes its success through', () => {
        const { status, calls } = runInstall('ok', ['-c', '-m', '644', 'libz.a', 'lib']);

        expect(status).toBe(0);
        expect(calls).toEqual(['-c -m 644 libz.a lib']);
        expect(modeOf('lib/libz.a')).toBe('644');
    });

    test('ends refused chmods with chmods by path, calling install once and saying nothing', () => {
        const { status, stderr, calls } = runInstall('refuse', ['-c', '-m', '644', 'libz.a', 'libz.pc', 'lib']);

        expect(status).toBe(0);
        expect(stderr).toBe('');
        expect(calls).toHaveLength(1);
        expect([modeOf('lib/libz.a'), modeOf('lib/libz.pc')]).toEqual(['644', '644']);
    });

    test('reads a refusal quoted the way a UTF-8 locale quotes it', () => {
        const { status } = runInstall('refuse-utf8', ['-m', '644', 'libz.a', 'lib']);

        expect(status).toBe(0);
        expect(modeOf('lib/libz.a')).toBe('644');
    });

    test('takes install\'s default mode when the call names none', () => {
        runInstall('refuse', ['libz.a', 'lib']);

        expect(modeOf('lib/libz.a')).toBe('755');
    });

    test('reads a mode attached to -m', () => {
        runInstall('refuse', ['-m0640', 'libz.a', 'lib']);

        expect(modeOf('lib/libz.a')).toBe('640');
    });

    test('leaves any other failure to install\'s own message and status', () => {
        const { status, stderr } = runInstall('missing', ['-m', '644', 'missing.a', 'lib']);

        expect(status).toBe(1);
        expect(stderr.trim()).toBe("install: cannot stat 'missing.a': No such file or directory");
    });
});
