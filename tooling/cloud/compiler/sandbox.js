import { spawn } from 'node:child_process';
import fs from 'node:fs';

const MiB = 1024 * 1024;
const SECCOMP_FD = 3;
const WATCHDOG_MS = 200;
// The sandbox's pid namespace is torn down after its init exits; give it a moment before the workspace is read.
const SETTLE_MS = 50;

export const LIMITS = Object.freeze({
    cpuSeconds: 60,
    // Counts mappings, not use: the CLI's own node maps about 1.8 GiB it barely touches (a V8 code range per
    // isolate, a lock-refreshing worker's included, and rollup's allocator arena).
    dataBytes: 2048 * MiB,
    fileBytes: 128 * MiB,
    processes: 64,
    openFiles: 1024,
    tmpBytes: 256 * MiB,
    wallMs: 45_000,
    logBytes: 64 * 1024,
    outputBytes: 8 * MiB,
    memoryFloorBytes: 256 * MiB,
});

const MERGED_USR = ['--symlink', 'usr/bin', '/bin', '--symlink', 'usr/sbin', '/sbin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64'];

// A compile sees the toolchain read-only, its workspace, a private /tmp, /proc and /dev, and nothing else: no
// network, not even loopback to this server, no other process and no way to make another user namespace. The
// seccomp program on `seccompFd` filters its syscalls, `masks` cover kernel files of /proc, and an overlay folder
// takes writes that vanish with the sandbox. Memory is the watchdog's job (runSandboxed): a sandbox can reset its
// own OOM score and fill tmpfs mounts that no size limit covers.
export function sandboxArgv({ workDir, readOnly, overlays = [], files, masks = [], seccompFd, env, command }, limits = LIMITS) {
    return [
        'choom', '-n', '1000', '--',
        'prlimit', `--cpu=${limits.cpuSeconds}`, `--data=${limits.dataBytes}`, `--fsize=${limits.fileBytes}`,
        `--nproc=${limits.processes}`, `--nofile=${limits.openFiles}`, '--',
        'bwrap', '--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent', '--new-session', '--hostname', 'playground', '--clearenv',
        ...(seccompFd === undefined ? [] : ['--seccomp', String(seccompFd)]),
        ...Object.entries(env).flatMap(([name, value]) => ['--setenv', name, value]),
        ...readOnly.flatMap((dir) => ['--ro-bind', dir, dir]),
        ...overlays.flatMap((dir) => ['--overlay-src', dir, '--tmp-overlay', dir]),
        ...MERGED_USR,
        '--proc', '/proc', '--dev', '/dev',
        ...masks.flatMap((file) => ['--ro-bind', '/dev/null', file]),
        '--size', String(limits.tmpBytes), '--tmpfs', '/tmp',
        ...Object.entries(files).flatMap(([to, from]) => ['--ro-bind', from, to]),
        '--bind', workDir, workDir, '--chdir', workDir,
        '--', ...command,
    ];
}

export const SANDBOX_SECCOMP_FD = SECCOMP_FD;

const readNumber = (file) => {
    try {
        return Number(fs.readFileSync(file, 'utf8').trim());
    } catch {
        return NaN;
    }
};

// Bytes of memory a compile may still take: the machine's MemAvailable, or less where the container's cgroup sets
// a lower limit. Infinity where neither is readable (the server runs on Linux only).
export function memoryAvailable() {
    let machine = Infinity;
    try {
        const line = fs.readFileSync('/proc/meminfo', 'utf8').split('\n').find((entry) => entry.startsWith('MemAvailable:'));
        machine = Number(line.split(/\s+/)[1]) * 1024;
    } catch {
        // No /proc/meminfo.
    }
    const limit = readNumber('/sys/fs/cgroup/memory.max');
    const used = readNumber('/sys/fs/cgroup/memory.current');
    return Number.isFinite(limit) && Number.isFinite(used) ? Math.min(machine, limit - used) : machine;
}

function killGroup(pid) {
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        // The group already exited.
    }
}

// Runs argv as its own process group; bubblewrap's --die-with-parent takes the sandbox down with it. Keeps the
// first `logBytes` of output and only counts the rest; the group is killed at the wall-clock limit, past
// `outputBytes` of output, or once the machine has less than `memoryFloorBytes` available.
export function runSandboxed(argv, {
    wallMs, logBytes, outputBytes, memoryFloorBytes, seccomp, memoryAvailable: available = memoryAvailable,
}) {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const stdio = seccomp ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'];
        const child = spawn(argv[0], argv.slice(1), { env: { PATH: '/usr/bin:/bin' }, detached: true, stdio });
        const kept = [];
        let keptBytes = 0;
        let seenBytes = 0;
        const outcome = { timedOut: false, flooded: false, outOfMemory: false };
        const stop = (reason) => {
            outcome[reason] = true;
            killGroup(child.pid);
        };
        const collect = (chunk) => {
            seenBytes += chunk.length;
            if (keptBytes < logBytes) {
                const part = Buffer.from(chunk.subarray(0, logBytes - keptBytes));
                kept.push(part);
                keptBytes += part.length;
            }
            if (seenBytes > outputBytes && !outcome.flooded) stop('flooded');
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        if (seccomp) child.stdio[SECCOMP_FD].end(seccomp);
        const timer = setTimeout(() => stop('timedOut'), wallMs);
        const watchdog = setInterval(() => {
            if (available() < memoryFloorBytes) stop('outOfMemory');
        }, WATCHDOG_MS);
        const finish = () => {
            clearTimeout(timer);
            clearInterval(watchdog);
        };
        child.on('error', (error) => {
            finish();
            reject(error);
        });
        child.on('close', (code, signal) => {
            finish();
            const output = `${Buffer.concat(kept).toString('utf8')}${seenBytes > keptBytes ? '\n[log truncated]\n' : ''}`;
            setTimeout(() => resolve({ code, signal, ...outcome, output, ms: Date.now() - started }), SETTLE_MS);
        });
    });
}
