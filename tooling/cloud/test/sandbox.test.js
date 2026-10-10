import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxArgv, runSandboxed, LIMITS } from '../compiler/sandbox.js';

const spec = {
    workDir: '/srv/playground/work',
    readOnly: ['/usr', '/emsdk'],
    overlays: ['/emsdk/upstream/emscripten/cache'],
    files: { '/tmp/home/.crossbind.json': '/opt/playground/home/.crossbind.json' },
    masks: ['/proc/cmdline'],
    seccompFd: 3,
    env: { PATH: '/usr/bin', HOME: '/tmp/home' },
    command: ['node', 'build.js'],
};

const options = { wallMs: 5000, logBytes: 1024, outputBytes: 1024 * 1024, memoryFloorBytes: 256 * 1024 * 1024 };
const valuesOf = (argv, flag) => argv.flatMap((arg, i) => (arg === flag ? [argv[i + 1]] : []));

test('lowers its own priority with the OOM killer, then sets the process limits, then enters bubblewrap', () => {
    const argv = sandboxArgv(spec);

    assert.deepEqual(argv.slice(0, 4), ['choom', '-n', '1000', '--']);
    assert.deepEqual(argv.slice(4, 11), [
        'prlimit', `--cpu=${LIMITS.cpuSeconds}`, `--data=${LIMITS.dataBytes}`, `--fsize=${LIMITS.fileBytes}`,
        `--nproc=${LIMITS.processes}`, `--nofile=${LIMITS.openFiles}`, '--',
    ]);
    assert.equal(argv[11], 'bwrap');
});

test('leaves the compile no network, no other processes, no further user namespaces and an empty environment', () => {
    const argv = sandboxArgv(spec);

    ['--unshare-all', '--unshare-user', '--disable-userns', '--die-with-parent', '--new-session', '--clearenv'].forEach((flag) => assert.ok(argv.includes(flag), flag));
    assert.ok(!argv.includes('--share-net'));
    assert.deepEqual(valuesOf(argv, '--setenv'), ['PATH', 'HOME']);
});

test('writes only to the workspace and its own size-limited /tmp, and reads only what it is given', () => {
    const argv = sandboxArgv(spec);

    assert.deepEqual(valuesOf(argv, '--bind'), ['/srv/playground/work']);
    assert.deepEqual(valuesOf(argv, '--ro-bind'), ['/usr', '/emsdk', '/dev/null', '/opt/playground/home/.crossbind.json']);
    assert.equal(argv[argv.indexOf('--tmpfs') - 2], '--size');
    assert.ok(argv.indexOf('--tmpfs') < argv.indexOf('/opt/playground/home/.crossbind.json'), 'the config is mounted over the fresh /tmp');
    assert.deepEqual(argv.slice(argv.lastIndexOf('--') + 1), ['node', 'build.js']);
});

test('filters syscalls with the program on the given descriptor and covers kernel files of /proc', () => {
    const argv = sandboxArgv(spec);

    assert.deepEqual(valuesOf(argv, '--seccomp'), ['3']);
    assert.ok(argv.indexOf('/proc/cmdline') > argv.indexOf('--proc'), 'the mask goes over the fresh /proc');
    assert.equal(argv[argv.indexOf('/proc/cmdline') - 1], '/dev/null');
});

test('lays a throwaway overlay over a read-only folder that the toolchain insists on writing to', () => {
    const argv = sandboxArgv(spec);
    const cache = '/emsdk/upstream/emscripten/cache';

    assert.deepEqual(argv.slice(argv.indexOf('--overlay-src'), argv.indexOf('--overlay-src') + 4), ['--overlay-src', cache, '--tmp-overlay', cache]);
    assert.ok(argv.indexOf('--overlay-src') > argv.lastIndexOf('/emsdk'), 'the overlay goes over the read-only toolchain');
});

test('returns the exit code and the output of both streams', async () => {
    const run = await runSandboxed(['sh', '-c', 'echo out; echo err >&2; exit 3'], options);

    assert.equal(run.code, 3);
    assert.equal(run.timedOut, false);
    assert.match(run.output, /out/);
    assert.match(run.output, /err/);
});

test('kills the whole process group once the wall-clock limit passes', async () => {
    const started = Date.now();

    const run = await runSandboxed(['sh', '-c', 'sleep 30 & sleep 30'], { ...options, wallMs: 300 });

    assert.equal(run.timedOut, true);
    assert.ok(Date.now() - started < 5000);
});

test('keeps only the first bytes of a long log and says so', async () => {
    const run = await runSandboxed(['sh', '-c', 'yes compile-error | head -c 100000'], { ...options, logBytes: 64 });

    assert.equal(run.output, `${'compile-error\n'.repeat(5).slice(0, 64)}\n[log truncated]\n`);
});

test('kills a build that floods its output, without holding the flood in memory', async () => {
    const before = process.memoryUsage().rss;

    const run = await runSandboxed(['sh', '-c', 'yes flood'], { ...options, outputBytes: 4 * 1024 * 1024 });

    assert.equal(run.flooded, true);
    assert.ok(process.memoryUsage().rss - before < 64 * 1024 * 1024, 'the server kept the flood');
});

test('kills a build once the machine runs low on memory', async () => {
    let checks = 0;

    const run = await runSandboxed(['sh', '-c', 'sleep 30'], { ...options, memoryAvailable: () => (checks++ < 2 ? 2e9 : 1e8) });

    assert.equal(run.outOfMemory, true);
    assert.ok(run.ms < 5000);
});

test('hands the seccomp program to the sandbox on descriptor 3', async () => {
    const run = await runSandboxed(['sh', '-c', 'wc -c <&3'], { ...options, seccomp: Buffer.alloc(24) });

    assert.equal(run.output.trim(), '24');
});
