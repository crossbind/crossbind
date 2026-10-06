import fs from 'node:fs';
import path from 'node:path';
import logger from './logger.js';

// A dependency source build can legitimately run for a long time; anything older
// is assumed to be a crashed process whose lock must be broken.
const DEFAULT_STALE_MS = 60 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_HELD_BY = 'another build is working on this dependency';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Reads the PID recorded in the lock file and reports whether that process is
// still running: 'alive' (signal delivered, or owned by another user), 'dead'
// (no such process), or 'unknown' (missing/unparseable PID).
export function lockHolderStatus(lockPath) {
    let pid;
    try {
        pid = Number.parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
    } catch {
        return 'unknown';
    }
    if (!Number.isInteger(pid) || pid <= 0) return 'unknown';
    try {
        process.kill(pid, 0);
        return 'alive';
    } catch (err) {
        if (err.code === 'ESRCH') return 'dead';
        if (err.code === 'EPERM') return 'alive';
        return 'unknown';
    }
}

// Takes the lock, yielding each wait so the async and the sync lock share one procedure.
function* acquire(lockPath, options) {
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    let hasWarned = false;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            return;
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            const status = lockHolderStatus(lockPath);
            const mtimeMs = fs.statSync(lockPath, { throwIfNoEntry: false })?.mtimeMs;
            const mtimeStale = mtimeMs !== undefined && Date.now() - mtimeMs > staleMs;
            // A provably-dead holder (e.g. a Ctrl-C that skipped the finally cleanup) is broken
            // at once; a live holder is never stolen, even past the stale window; when the holder
            // can't be determined we fall back to the mtime age.
            if (status === 'dead' || (status !== 'alive' && mtimeStale)) {
                logger.info(`crossbind: breaking stale lock ${lockPath} (holder ${status}).`);
                fs.rmSync(lockPath, { force: true });
                continue;
            }
            if (!hasWarned) {
                logger.info(`crossbind: waiting for ${lockPath} (${options.heldBy ?? DEFAULT_HELD_BY})…`);
                hasWarned = true;
            }
            yield pollMs;
        }
    }
}

export default async function withDirLock(lockPath, fn, options = {}) {
    for (const ms of acquire(lockPath, options)) await sleep(ms);
    try {
        return await fn();
    } finally {
        fs.rmSync(lockPath, { force: true });
    }
}

// For a caller that holds the lock across execFileSync, where the event loop cannot run anyway.
export function withDirLockSync(lockPath, fn, options = {}) {
    for (const ms of acquire(lockPath, options)) sleepSync(ms);
    try {
        return fn();
    } finally {
        fs.rmSync(lockPath, { force: true });
    }
}
