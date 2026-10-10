// Runs the compiler image on this machine, throws hostile compiles at it, then probes its sandbox from inside.
// Docker needs its seccomp filter and /proc masking lifted for bubblewrap; a Cloudflare microVM allows it as is.
// usage: node scripts/attack.mjs [--tag <image>]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../compiler/template/src/native');
const CONTAINER = 'crossbind-playground-attack';
const PORT = 18080;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WALL_LIMIT_MS = 45_000;
const tagAt = process.argv.indexOf('--tag');
const TAG = tagAt === -1 ? 'crossbind-playground-compiler:dev' : process.argv[tagAt + 1];

const sample = Object.fromEntries(['native.h', 'native.cpp'].map((name) => [name, fs.readFileSync(path.join(TEMPLATE, name), 'utf8')]));
const inHeader = (body) => ({ 'native.h': `#pragma once\n${body}\nint answer();\n`, 'native.cpp': '#include "native.h"\nint answer() { return 42; }\n' });
const inSource = (body) => ({ 'native.h': '#pragma once\nint answer();\n', 'native.cpp': `#include "native.h"\n${body}\nint answer() { return 42; }\n` });

const MACRO_BOMB = [
    '#define L0(x) x x x x x x x x x x',
    '#define L1(x) L0(L0(x))',
    '#define L2(x) L1(L1(x))',
    '#define L3(x) L2(L2(x))',
    '#define L4(x) L3(L3(x))',
    'int bomb = 0 L4(+1);',
].join('\n');

// The array is read through a bound function, so the linker keeps what #embed put in it.
const embedding = (file) => ({
    'native.h': '#pragma once\nint embedded_byte(int i);\n',
    'native.cpp': `#include "native.h"\nstatic const unsigned char embedded[] = {\n#embed "${file}"\n};\nint embedded_byte(int i) { return embedded[i]; }\n`,
});

const wasmText = (r) => Buffer.from(r.body.wasm ?? '', 'base64').toString('latin1');
const isWasm = (r) => wasmText(r).startsWith('\0asm');
// Failed for the expected reason, and nothing of the hidden file came back.
const failsWith = (reason, secret = null) => (r) => r.status === 200 && r.body.ok === false && reason.test(r.body.log) && !secret?.test(JSON.stringify(r.body));

const COMPILES = [
    { name: 'the sample compiles to a wasm module and its loader', files: sample, check: (r) => r.body.ok === true && isWasm(r) && r.body.js.length > 0 },
    { name: 'a syntax error is a compile error naming the file', files: inSource('int broken('), check: (r) => r.body.reason === 'compile' && /native\.cpp:\d+/.test(r.body.log) },
    { name: '#include "/etc/passwd" finds nothing', files: inHeader('#include "/etc/passwd"'), check: failsWith(/'\/etc\/passwd' file not found/, /root:x:0:0/) },
    {
        name: '#include of the server code finds nothing',
        files: inSource('#include "/opt/playground/compiler/server.js"'),
        check: failsWith(/server\.js' file not found/, /createCompileServer/),
    },
    {
        name: 'SWIG %include of the server code finds nothing',
        files: inHeader('#ifdef SWIG\n%include "/opt/playground/compiler/server.js"\n#endif'),
        check: failsWith(/Unable to find '\/opt\/playground\/compiler\/server\.js'/, /createCompileServer/),
    },
    {
        name: '.incbin of the server code finds nothing',
        files: inSource('__asm__(".incbin \\"/opt/playground/compiler/server.js\\"");'),
        check: failsWith(/Could not find incbin file/, /createCompileServer/),
    },
    {
        name: '#embed takes in a file the sandbox shows (control)',
        files: embedding('/opt/playground/cli/node_modules/crossbind/package.json'),
        check: (r) => r.body.ok === true && wasmText(r).includes('"name": "crossbind"'),
    },
    {
        // clang's -MD lets #embed of a missing file pass silently, so this compile succeeds with nothing embedded.
        name: '#embed of the template, hidden from the sandbox, takes in nothing',
        files: embedding('/srv/playground/template/src/native/native.cpp'),
        check: (r) => !wasmText(r).includes('Counter::increment'),
    },
    {
        name: 'a never-ending constexpr loop stops at the step limit',
        files: inSource('constexpr long spin() { long i = 0; while (true) ++i; return i; }\nconstexpr long spun = spin();'),
        check: failsWith(/maximum step limit/),
    },
    {
        name: 'a macro explosion stops at the memory limit',
        files: inSource(MACRO_BOMB),
        check: (r) => r.body.ok === false && (['timeout', 'memory'].includes(r.body.reason) || /out of memory/.test(r.body.log)) && r.ms < WALL_LIMIT_MS + 10_000,
    },
    {
        name: 'a 256 MB static array stops at the file size limit',
        files: inSource('char big[256 * 1024 * 1024] = {1};\nint touch() { return big[7]; }'),
        check: failsWith(/File too large/),
    },
    { name: 'the sample still compiles afterwards', files: sample, check: (r) => r.body.ok === true },
];

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

async function request(route, init) {
    const started = Date.now();
    const response = await fetch(`${BASE_URL}${route}`, { ...init, signal: AbortSignal.timeout(120_000) });
    const text = await response.text();
    let body;
    try {
        body = JSON.parse(text);
    } catch {
        body = { text };
    }
    return { status: response.status, body, ms: Date.now() - started };
}

const compileRequest = (files) => request('/compile', { method: 'POST', body: JSON.stringify({ files }) });

const REQUESTS = [
    { name: 'a file other than the two sources is refused', run: () => compileRequest({ 'native.h': '', 'CMakeLists.txt': 'execute_process(COMMAND id)' }), check: (r) => r.status === 400 },
    { name: 'sources over 32 KB are refused', run: () => compileRequest({ 'native.h': 'x'.repeat(33 * 1024) }), check: (r) => r.status === 400 },
    { name: 'a body over the limit is refused', run: () => request('/compile', { method: 'POST', body: 'x'.repeat(70 * 1024) }), check: (r) => r.status === 413 },
    { name: 'the runner protocol is not served', run: () => request('/v1/exec', { method: 'POST', body: '{}' }), check: (r) => r.status === 404 },
    {
        name: 'a third compile at once is turned away',
        run: async () => {
            const statuses = (await Promise.all([compileRequest(sample), compileRequest(sample), compileRequest(sample)])).map((r) => r.status).sort();
            return { status: statuses.join(','), body: {}, ms: 0 };
        },
        check: (r) => r.status === '200,200,503',
    },
];

async function waitForHealth() {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(`${BASE_URL}/health`)).ok) return;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => { setTimeout(resolve, 500); });
    }
    throw new Error(`the compiler did not answer on ${BASE_URL}/health within 30 s`);
}

function selftest() {
    try {
        return JSON.parse(docker(['exec', CONTAINER, 'node', '/opt/playground/compiler/selftest.js']));
    } catch (error) {
        if (error.stdout) return JSON.parse(error.stdout);
        throw error;
    }
}

const describe = (r) => `${r.status} ${r.body.ok === undefined ? '' : `ok=${r.body.ok} `}${r.body.reason ?? ''} ${r.ms} ms`.trim();

async function main() {
    try {
        docker(['rm', '-f', CONTAINER]);
    } catch {
        // No container left from an earlier run.
    }
    // The memory of the Cloudflare instance (wrangler.jsonc), so the watchdog and the OOM killer act as they would there.
    docker(['run', '-d', '--name', CONTAINER, '--memory', '3g', '--pids-limit', '512', '--security-opt', 'seccomp=unconfined', '--security-opt', 'systempaths=unconfined', '-p', `127.0.0.1:${PORT}:8080`, TAG]);
    const rows = [];
    try {
        await waitForHealth();
        for (const { name, files, check } of COMPILES) {
            const result = await compileRequest(files);
            rows.push({ name, ok: check(result), detail: describe(result) });
        }
        for (const { name, run, check } of REQUESTS) {
            const result = await run();
            rows.push({ name, ok: check(result), detail: describe(result) });
        }
        selftest().forEach((probe) => rows.push({ name: `sandbox: ${probe.name}`, ok: probe.ok, detail: `exit ${probe.code}` }));
    } finally {
        if (rows.some((row) => !row.ok)) process.stdout.write(docker(['logs', '--tail', '40', CONTAINER]));
        docker(['rm', '-f', CONTAINER]);
    }
    rows.forEach((row) => process.stdout.write(`${row.ok ? 'pass' : 'FAIL'}  ${row.name}  (${row.detail})\n`));
    process.exitCode = rows.every((row) => row.ok) ? 0 : 1;
}

await main();
