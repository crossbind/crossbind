import {
    describe, test, expect, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outputTarget, writeOutputFile, removeOutputFile } from '../src/utils/remoteOutputs.js';

const LIVE = '/tmp/crossbind/live';

describe('files a remote runner hands back', () => {
    let host;
    let outside;
    let mounts;

    beforeEach(() => {
        host = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-outputs-'));
        outside = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-outside-'));
        mounts = [
            { host, container: LIVE, inputRoots: ['app'], outputRoots: ['app/.crossbind'] },
            { host: path.join(host, 'cargo'), container: '/var/cache/crossbind/cargo', inputRoots: [], outputRoots: ['registry/src/*/*'] },
        ];
    });

    afterEach(() => {
        fs.rmSync(host, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    test('land below an output root the step declared', () => {
        const target = outputTarget(mounts, [[], []], `${LIVE}/app/.crossbind/build/x.o`);

        expect(target.file).toBe(path.join(host, 'app/.crossbind/build/x.o'));
    });

    test('never anywhere else in the project, such as a git hook or the package manifest', () => {
        expect(() => outputTarget(mounts, [[], []], `${LIVE}/.git/hooks/pre-commit`)).toThrow(/not an output of this step/);
        expect(() => outputTarget(mounts, [[], []], `${LIVE}/app/package.json`)).toThrow(/not an output of this step/);
    });

    test('never into a store unit this machine already holds', () => {
        const unit = 'registry/src/index/semver-1.0.26';

        expect(() => outputTarget(mounts, [[], [unit]], `/var/cache/crossbind/cargo/${unit}/build.rs`)).toThrow(/not an output of this step/);
        expect(outputTarget(mounts, [[], []], `/var/cache/crossbind/cargo/${unit}/build.rs`).rel).toBe(`${unit}/build.rs`);
    });

    test.skipIf(process.platform === 'win32')('are neither written nor deleted through a link that leads out of the project', () => {
        fs.mkdirSync(path.join(host, 'app'), { recursive: true });
        fs.writeFileSync(path.join(outside, 'x.o'), 'keep');
        fs.symlinkSync(outside, path.join(host, 'app/.crossbind'));
        const target = outputTarget(mounts, [[], []], `${LIVE}/app/.crossbind/x.o`);

        expect(() => writeOutputFile(target, Buffer.from('new'), 0o644)).toThrow(/leads out of/);
        expect(() => removeOutputFile(target)).toThrow(/leads out of/);
        expect(fs.readFileSync(path.join(outside, 'x.o'), 'utf8')).toBe('keep');
    });

    test.skipIf(process.platform === 'win32')('replace a link at their own path instead of writing through it, without special mode bits', () => {
        fs.writeFileSync(path.join(outside, 'victim'), 'keep');
        fs.mkdirSync(path.join(host, 'app/.crossbind'), { recursive: true });
        fs.symlinkSync(path.join(outside, 'victim'), path.join(host, 'app/.crossbind/x.o'));
        const target = outputTarget(mounts, [[], []], `${LIVE}/app/.crossbind/x.o`);

        writeOutputFile(target, Buffer.from('new'), 0o4755);

        expect(fs.readFileSync(path.join(outside, 'victim'), 'utf8')).toBe('keep');
        expect(fs.lstatSync(target.file).isSymbolicLink()).toBe(false);
        expect(fs.readFileSync(target.file, 'utf8')).toBe('new');
        expect(fs.statSync(target.file).mode & 0o7777).toBe(0o755);
    });

    test('are removed when the step deleted them', () => {
        fs.mkdirSync(path.join(host, 'app/.crossbind'), { recursive: true });
        fs.writeFileSync(path.join(host, 'app/.crossbind/old.o'), 'x');

        removeOutputFile(outputTarget(mounts, [[], []], `${LIVE}/app/.crossbind/old.o`));

        expect(fs.existsSync(path.join(host, 'app/.crossbind/old.o'))).toBe(false);
    });
});
