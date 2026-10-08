import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import withDirLock, { lockHolderStatus, withDirLockSync } from '../src/utils/dirLock.js';

// No process can own this PID (above every platform's pid_max), so it always reads as dead.
const DEAD_PID = '999999';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

describe('withDirLock', () => {
    let tmpDir;
    let lockPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-lock-'));
        lockPath = path.join(tmpDir, 'deps', 'z.lock');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('runs the function, returns its value and removes the lock file', async () => {
        const result = await withDirLock(lockPath, async () => {
            expect(fs.existsSync(lockPath)).toBe(true);
            return 42;
        });

        expect(result).toBe(42);
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    test('serializes two concurrent holders of the same lock', async () => {
        const order = [];
        const first = withDirLock(lockPath, async () => {
            order.push('first-start');
            await sleep(120);
            order.push('first-end');
        }, { pollMs: 10 });
        await sleep(20);
        const second = withDirLock(lockPath, async () => {
            order.push('second-start');
        }, { pollMs: 10 });

        await Promise.all([first, second]);

        expect(order).toEqual(['first-start', 'first-end', 'second-start']);
    });

    test('breaks a stale lock and proceeds', async () => {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, DEAD_PID);
        const past = (Date.now() - 60 * 60 * 1000) / 1000;
        fs.utimesSync(lockPath, past, past);

        const result = await withDirLock(lockPath, async () => 'ran', { staleMs: 1000 });

        expect(result).toBe('ran');
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    test('breaks a lock whose holder is dead even when the mtime is fresh', async () => {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        fs.writeFileSync(lockPath, DEAD_PID); // fresh mtime, but the holder PID does not exist

        const result = await withDirLock(lockPath, async () => 'ran', { staleMs: 60 * 60 * 1000, pollMs: 10 });

        expect(result).toBe('ran');
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    test('releases the lock when the function throws', async () => {
        await expect(withDirLock(lockPath, async () => {
            throw new Error('boom');
        })).rejects.toThrow('boom');

        expect(fs.existsSync(lockPath)).toBe(false);
    });
});

describe('withDirLockSync', () => {
    let tmpDir;
    let lockPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-locksync-'));
        lockPath = path.join(tmpDir, 'compile.lock');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('runs the function under this process\'s lock, returns its value and removes the lock file', () => {
        const result = withDirLockSync(lockPath, () => fs.readFileSync(lockPath, 'utf8').split('\n')[0]);

        expect(result).toBe(String(process.pid));
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    test('waits until the process holding the lock releases it', async () => {
        const released = path.join(tmpDir, 'released');
        const dirLock = pathToFileURL(path.resolve(import.meta.dirname, '../src/utils/dirLock.js')).href;
        const holder = spawn(process.execPath, ['--input-type=module', '-e', `
            import fs from 'node:fs';
            import { withDirLockSync } from ${JSON.stringify(dirLock)};
            withDirLockSync(${JSON.stringify(lockPath)}, () => {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
                fs.writeFileSync(${JSON.stringify(released)}, '');
            });
        `], { stdio: 'ignore' });
        const exited = new Promise((resolve) => { holder.on('exit', resolve); });
        while (!fs.existsSync(lockPath) && holder.exitCode === null) await sleep(10);

        const sawRelease = withDirLockSync(lockPath, () => fs.existsSync(released), { pollMs: 10 });

        expect(await exited).toBe(0);
        expect(sawRelease).toBe(true);
    });

    test('breaks a lock whose holder is dead', () => {
        fs.writeFileSync(lockPath, DEAD_PID);

        expect(withDirLockSync(lockPath, () => 'ran', { pollMs: 10 })).toBe('ran');
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    // Metro's workers all find the lock a killed one left: each that saw the dead holder must not remove the lock another
    // has taken since.
    test('lets one process at a time in when many find a dead holder at once', async () => {
        fs.writeFileSync(lockPath, DEAD_PID);
        const go = path.join(tmpDir, 'go');
        const inside = path.join(tmpDir, 'inside');
        const dirLock = pathToFileURL(path.resolve(import.meta.dirname, '../src/utils/dirLock.js')).href;
        const contenders = Array.from({ length: 12 }, () => spawn(process.execPath, ['--input-type=module', '-e', `
            import fs from 'node:fs';
            import { withDirLockSync } from ${JSON.stringify(dirLock)};
            while (!fs.existsSync(${JSON.stringify(go)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
            withDirLockSync(${JSON.stringify(lockPath)}, () => {
                try {
                    fs.closeSync(fs.openSync(${JSON.stringify(inside)}, 'wx'));
                } catch {
                    process.stdout.write('overlap');
                    return;
                }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
                fs.rmSync(${JSON.stringify(inside)});
            }, { pollMs: 5 });
        `]));
        const outputs = contenders.map((contender) => new Promise((resolve) => {
            let output = '';
            contender.stdout.on('data', (chunk) => { output += chunk; });
            contender.on('exit', () => resolve(output));
        }));
        await sleep(300);
        fs.writeFileSync(go, '');

        expect((await Promise.all(outputs)).join('')).not.toContain('overlap');
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    test('releases the lock when the function throws', () => {
        expect(() => withDirLockSync(lockPath, () => {
            throw new Error('boom');
        })).toThrow('boom');

        expect(fs.existsSync(lockPath)).toBe(false);
    });
});

// A PID outlives its process: Windows and a restarted container hand it to the next one.
describe('a holder known by more than its PID', () => {
    const dirLock = pathToFileURL(path.resolve(import.meta.dirname, '../src/utils/dirLock.js')).href;
    let tmpDir;
    let lockPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-lockheld-'));
        lockPath = path.join(tmpDir, 'bridge.lock');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const backdate = (file) => {
        const past = (Date.now() - 60 * 1000) / 1000;
        fs.utimesSync(file, past, past);
    };

    test('keeps the lock while its holder is blocked past the stale window', async () => {
        const options = { staleMs: 200, pollMs: 10 };
        const inside = path.join(tmpDir, 'inside');
        const holder = spawn(process.execPath, ['--input-type=module', '-e', `
            import fs from 'node:fs';
            import { withDirLockSync } from ${JSON.stringify(dirLock)};
            withDirLockSync(${JSON.stringify(lockPath)}, () => {
                fs.writeFileSync(${JSON.stringify(inside)}, '');
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
                fs.rmSync(${JSON.stringify(inside)});
            }, ${JSON.stringify(options)});
        `], { stdio: 'ignore' });
        const exited = new Promise((resolve) => { holder.on('exit', resolve); });
        while (!fs.existsSync(inside) && holder.exitCode === null) await sleep(10);

        const sawHolderInside = await withDirLock(lockPath, async () => fs.existsSync(inside), options);

        expect(await exited).toBe(0);
        expect(sawHolderInside).toBe(false);
    });

    test('breaks a lock nobody refreshes, though a process runs under its PID', async () => {
        fs.writeFileSync(lockPath, `${process.pid}\nleft-by-a-crash\n`);
        backdate(lockPath);

        expect(await withDirLock(lockPath, async () => 'ran', { staleMs: 200, pollMs: 10 })).toBe('ran');
    });

    test('waits for an older crossbind\'s lock while its holder runs', async () => {
        fs.writeFileSync(lockPath, String(process.pid));
        backdate(lockPath);

        const ran = withDirLock(lockPath, async () => 'ran', { staleMs: 50, pollMs: 10 });
        await sleep(400);

        expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(process.pid));
        fs.rmSync(lockPath);
        expect(await ran).toBe('ran');
    });

    test('leaves the lock to the process that took it over', async () => {
        await withDirLock(lockPath, async () => {
            fs.writeFileSync(lockPath, `${process.pid}\nanother-holder\n`);
        });

        expect(fs.readFileSync(lockPath, 'utf8')).toBe(`${process.pid}\nanother-holder\n`);
    });
});

// Windows refuses to create a file whose deletion another handle still holds open.
describe('a lock file being deleted', () => {
    let tmpDir;
    let lockPath;
    let platform;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-lockdelete-'));
        lockPath = path.join(tmpDir, 'bridge.lock');
        platform = Object.getOwnPropertyDescriptor(process, 'platform');
    });

    afterEach(() => {
        vi.restoreAllMocks();
        Object.defineProperty(process, 'platform', platform);
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    const refuseLockFile = (times) => {
        const { openSync } = fs;
        let refusals = times;
        vi.spyOn(fs, 'openSync').mockImplementation((file, ...rest) => {
            if (file === lockPath && refusals > 0) {
                refusals -= 1;
                throw Object.assign(new Error(`EPERM: operation not permitted, open '${file}'`), { code: 'EPERM' });
            }
            return openSync(file, ...rest);
        });
    };

    test('is taken once Windows has deleted it', () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        refuseLockFile(3);

        expect(withDirLockSync(lockPath, () => 'ran', { pollMs: 1 })).toBe('ran');
    });

    test('fails at once when the directory refuses it elsewhere', () => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
        refuseLockFile(1);

        expect(() => withDirLockSync(lockPath, () => 'ran', { pollMs: 1 })).toThrow('EPERM');
    });
});

describe('lockHolderStatus', () => {
    let tmpDir;
    let lockPath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-lockstatus-'));
        lockPath = path.join(tmpDir, 'z.lock');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('reports the current process as alive', () => {
        fs.writeFileSync(lockPath, String(process.pid));
        expect(lockHolderStatus(lockPath)).toBe('alive');
    });

    test('reports a non-existent holder as dead', () => {
        fs.writeFileSync(lockPath, DEAD_PID);
        expect(lockHolderStatus(lockPath)).toBe('dead');
    });

    test('reports unknown for a missing lock file', () => {
        expect(lockHolderStatus(lockPath)).toBe('unknown');
    });

    test('reports unknown for an unparseable PID', () => {
        fs.writeFileSync(lockPath, 'not-a-pid');
        expect(lockHolderStatus(lockPath)).toBe('unknown');
    });
});
