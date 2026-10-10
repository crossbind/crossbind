// Probes, inside the image, the sandbox every compile runs in. scripts/attack.mjs runs it through docker exec;
// on a deployed container it runs the same way. Each probe is a shell script run exactly as a compile is run.
import fs from 'node:fs';
import {
    PATHS, compileSandboxArgv, resetWorkspace, removeTree, runSandboxedCompile,
} from './compile.js';
import { LIMITS } from './sandbox.js';

const paths = { ...PATHS, work: '/srv/playground/selftest' };
const MiB = 1024 * 1024;
const python = (code) => `python3 -c '${code}'`;
const rssGrowth = { before: 0 };

const PROBES = [
    {
        name: 'no network, not even loopback to the server',
        script: "node -e \"require('net').connect(8080, '127.0.0.1').on('connect', () => process.exit(0)).on('error', () => process.exit(7))\"",
        succeeds: false,
    },
    { name: 'no name resolution', script: "node -e \"require('dns').lookup('example.com', (error) => process.exit(error ? 7 : 0))\"", succeeds: false },
    {
        name: 'no server code, template, passwd or root home',
        script: 'test ! -e /opt/playground/compiler && test ! -e /srv/playground/template && test ! -e /etc/passwd && test ! -e /root',
        succeeds: true,
    },
    {
        name: 'toolchain, CLI and system read-only',
        script: '! touch /emsdk/probe 2>/dev/null && ! touch /opt/playground/cli/probe 2>/dev/null && ! touch /usr/probe 2>/dev/null',
        succeeds: true,
    },
    { name: 'workspace and /tmp writable', script: `touch ${paths.work}/probe && touch /tmp/probe`, succeeds: true },
    // serve[r] keeps the probe from finding its own command line.
    { name: 'no other processes', script: "test \"$(ls /proc | grep -c '^[0-9]')\" -lt 10 && ! grep -qs 'compiler/serve[r]' /proc/[0-9]*/cmdline", succeeds: true },
    {
        name: 'writes to the emscripten cache vanish with the sandbox',
        script: 'touch /emsdk/upstream/emscripten/cache/selftest-probe',
        succeeds: true,
        after: () => !fs.existsSync('/emsdk/upstream/emscripten/cache/selftest-probe'),
    },
    { name: 'no further user namespaces', script: 'unshare --user true 2>/dev/null', succeeds: false },
    { name: '/tmp stops at its size limit', script: 'dd if=/dev/zero of=/tmp/fill bs=1M count=300 2>/dev/null', succeeds: false },
    { name: 'only the toolchain environment', script: 'test -z "$CROSSBIND_RUNNER_TOKEN" && test "$(env | wc -l)" -lt 15', succeeds: true },
    { name: 'process limits in force', script: `grep -q "Max processes *${LIMITS.processes} " /proc/self/limits`, succeeds: true },
    { name: 'the boot command line is covered', script: 'test -e /proc/cmdline && test ! -s /proc/cmdline', succeeds: true },
    {
        name: 'io_uring refused',
        script: python('import ctypes, sys; libc = ctypes.CDLL(None, use_errno=True); result = libc.syscall(425, 1, ctypes.create_string_buffer(128)); sys.exit(0 if result == -1 and ctypes.get_errno() == 1 else 3)'),
        succeeds: true,
    },
    {
        name: 'vsock, netlink and packet sockets refused, unix and internet sockets open',
        script: python([
            'import socket, sys',
            'def opens(family, kind):',
            '    try:',
            '        socket.socket(family, kind).close()',
            '        return True',
            '    except PermissionError:',
            '        return False',
            'refused = [opens(socket.AF_VSOCK, socket.SOCK_STREAM), opens(socket.AF_NETLINK, socket.SOCK_DGRAM), opens(socket.AF_PACKET, socket.SOCK_DGRAM)]',
            'opened = [opens(socket.AF_UNIX, socket.SOCK_STREAM), opens(socket.AF_INET, socket.SOCK_STREAM), opens(socket.AF_INET6, socket.SOCK_STREAM)]',
            'sys.exit(0 if not any(refused) and all(opened) else 3)',
        ].join('\n')),
        succeeds: true,
    },
    {
        name: 'a tree deeper than a path can name, locked at the bottom, is still cleared',
        // Relative steps: a shell cd would name the whole path and stop at PATH_MAX.
        script: python('import os\nfor _ in range(2500):\n    os.mkdir("d")\n    os.chdir("d")\nos.mkdir("locked")\nos.chmod("locked", 0)'),
        succeeds: true,
        after: () => {
            removeTree(paths.work);
            return !fs.existsSync(paths.work);
        },
    },
    {
        name: 'an output flood is cut without the server holding it',
        script: 'yes flood',
        succeeds: false,
        before: () => { rssGrowth.before = process.memoryUsage().rss; },
        after: (run) => run.flooded && process.memoryUsage().rss - rssGrowth.before < 64 * MiB,
    },
];

async function probe({ name, script, succeeds, before = () => {}, after = () => true }) {
    resetWorkspace(paths);
    try {
        before();
        const run = await runSandboxedCompile(compileSandboxArgv(paths, ['sh', '-c', script]), { ...LIMITS, wallMs: 20_000, logBytes: 4096 });
        return { name, ok: !run.timedOut && (run.code === 0) === succeeds && after(run), code: run.code, output: run.output.trim() };
    } finally {
        removeTree(paths.work);
    }
}

const results = [];
for (const entry of PROBES) results.push(await probe(entry));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
