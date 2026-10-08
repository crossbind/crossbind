import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import logger from './logger.js';

// A holder refreshes its lock while it works, so a lock nobody refreshed for this long was left by a crash, even when
// another process has taken over its PID since.
const DEFAULT_STALE_MS = 30 * 1000;
// A crossbind from before the refreshing kept its lock as long as its PID ran, and one whose PID cannot be read this long.
const LEGACY_STALE_MS = 60 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_HELD_BY = 'another build is working on this dependency';
// Breaking a lock takes no time, so a break file this old was left by a waiter that died breaking one.
const BREAK_STALE_MS = 10 * 1000;
// Windows keeps the name of a deleted file while another handle has it open.
const DELETE_PENDING_MS = 2 * 1000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The holder's PID, and from this crossbind on the token of its acquisition on the next line.
function readLock(lockPath) {
    try {
        const [pid, token] = fs.readFileSync(lockPath, 'utf8').split('\n').map((line) => line.trim());
        return { pid: Number.parseInt(pid, 10), token: token || undefined, isLegacy: Boolean(pid) && !token };
    } catch {
        return {};
    }
}

function statusOf(pid) {
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

// Reads the PID recorded in the lock file and reports whether that process is
// still running: 'alive' (signal delivered, or owned by another user), 'dead'
// (no such process), or 'unknown' (missing/unparseable PID).
export function lockHolderStatus(lockPath) {
    return statusOf(readLock(lockPath).pid);
}

let refresher;

// Refreshes the held locks from a thread of its own, so a holder blocked in execFileSync still shows it is working.
function lockRefresher() {
    if (!refresher) {
        refresher = new Worker(`
            const fs = require('node:fs');
            const { parentPort } = require('node:worker_threads');
            const timers = new Map();
            parentPort.on('message', ({ hold, release, everyMs }) => {
                clearInterval(timers.get(hold ?? release));
                timers.delete(hold ?? release);
                if (!hold) return;
                timers.set(hold, setInterval(() => {
                    const now = new Date();
                    try {
                        fs.utimesSync(hold, now, now);
                    } catch {
                        // released since the last refresh
                    }
                }, everyMs));
            });
        `, { eval: true, execArgv: [] });
        refresher.on('error', (error) => logger.info(`crossbind: cannot refresh held locks (${error.message}); a waiting process may take one over.`));
        refresher.unref();
    }
    return refresher;
}

// Takes the lock, yielding each wait so the async and the sync lock share one procedure.
function* acquire(lockPath, token, options) {
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    let hasWarned = false;
    let deniedSince;
    let suspect;
    for (;;) {
        try {
            const fd = fs.openSync(lockPath, 'wx');
            fs.writeSync(fd, `${process.pid}\n${token}\n`);
            fs.closeSync(fd);
            lockRefresher().postMessage({ hold: lockPath, everyMs: staleMs / 6 });
            return;
        } catch (e) {
            if (e.code === 'EPERM' && process.platform === 'win32') {
                deniedSince ??= performance.now();
                if (performance.now() - deniedSince < DELETE_PENDING_MS) {
                    yield pollMs;
                    continue;
                }
            }
            if (e.code !== 'EEXIST') throw e;
        }
        // The file is read before its holder, so a lock another waiter took meanwhile never passes for the stale one.
        const lock = fs.statSync(lockPath, { throwIfNoEntry: false });
        const holder = readLock(lockPath);
        const status = statusOf(holder.pid);
        // A provably-dead holder (e.g. a Ctrl-C that skipped the finally cleanup) is broken at once. Any other goes once
        // nobody refreshed it within the stale window for two refreshes in a row, so a holder waking from sleep refreshes
        // it first; an older crossbind's lock only once its holder is gone.
        if (lock && status === 'dead' && breakStaleLock(lockPath, lock, 'its holder is gone')) continue;
        const age = lock ? Date.now() - lock.mtimeMs : 0;
        const isUnrefreshed = holder.isLegacy ? status !== 'alive' && age > LEGACY_STALE_MS : age > staleMs;
        if (lock && isUnrefreshed) {
            if (suspect?.ino !== lock.ino || suspect.mtimeMs !== lock.mtimeMs) {
                suspect = { ino: lock.ino, mtimeMs: lock.mtimeMs, since: performance.now() };
            } else if (performance.now() - suspect.since >= staleMs / 3 && breakStaleLock(lockPath, lock, 'nobody refreshes it')) {
                continue;
            }
        }
        if (!hasWarned) {
            logger.info(`crossbind: waiting for ${lockPath} (${options.heldBy ?? DEFAULT_HELD_BY})…`);
            hasWarned = true;
        }
        yield pollMs;
    }
}

// Waiters that all saw the stale holder break the lock one at a time, and only the file they saw: otherwise one removes
// the lock another has just taken. False while another waiter is breaking it.
function breakStaleLock(lockPath, stale, reason) {
    const breakPath = `${lockPath}.break`;
    try {
        fs.closeSync(fs.openSync(breakPath, 'wx'));
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        const mtimeMs = fs.statSync(breakPath, { throwIfNoEntry: false })?.mtimeMs;
        if (mtimeMs !== undefined && Date.now() - mtimeMs > BREAK_STALE_MS) fs.rmSync(breakPath, { force: true });
        return false;
    }
    try {
        const lock = fs.statSync(lockPath, { throwIfNoEntry: false });
        if (lock?.ino === stale.ino && lock.mtimeMs === stale.mtimeMs) {
            logger.info(`crossbind: breaking stale lock ${lockPath} (${reason}).`);
            fs.rmSync(lockPath, { force: true });
        }
    } finally {
        fs.rmSync(breakPath, { force: true });
    }
    return true;
}

// A holder that stopped refreshing may have lost the lock to another process, whose lock it must leave.
function release(lockPath, token) {
    lockRefresher().postMessage({ release: lockPath });
    if (readLock(lockPath).token === token) fs.rmSync(lockPath, { force: true });
}

export default async function withDirLock(lockPath, fn, options = {}) {
    const token = randomUUID();
    for (const ms of acquire(lockPath, token, options)) await sleep(ms);
    try {
        return await fn();
    } finally {
        release(lockPath, token);
    }
}

// For a caller that holds the lock across execFileSync, where the event loop cannot run anyway.
export function withDirLockSync(lockPath, fn, options = {}) {
    const token = randomUUID();
    for (const ms of acquire(lockPath, token, options)) sleepSync(ms);
    try {
        return fn();
    } finally {
        release(lockPath, token);
    }
}
