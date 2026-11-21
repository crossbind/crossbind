import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

// Hermetic: fetch from a local HTTP server via the shipped archives; needs the wasi:sockets grants below.
const P = 'wasi-wasm32-st-release';
const pkgDir = resolve(import.meta.dirname, '..');
const execFileP = promisify(execFile);

let sdk = process.env.CROSSBIND_WASI_SDK_PATH;
if (!sdk) {
    try { sdk = JSON.parse(readFileSync(join(homedir(), '.crossbind', 'config.json'), 'utf8')).WASI_SDK_PATH; } catch { /* unset */ }
}
if (!sdk || !existsSync(sdk)) {
    console.log('SKIP: wasi-sdk not configured (CROSSBIND_WASI_SDK_PATH or ~/.crossbind/config.json WASI_SDK_PATH).');
    process.exit(0);
}
if (!existsSync(join(sdk, 'share/wasi-sysroot/lib/wasm32-wasip3'))) {
    console.log('SKIP: configured wasi-sdk has no wasm32-wasip3 sysroot (need wasi-sdk >= 34).');
    process.exit(0);
}
try {
    execFileSync('wasmtime', ['--version'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: wasmtime not installed (brew install wasmtime).');
    process.exit(0);
}
const own = join(pkgDir, 'dist/prebuilt', P);
if (!existsSync(own)) {
    console.log('SKIP: wasi prebuilt missing - run `pnpm build` first.');
    process.exit(0);
}

// Dep archives resolve through the dependency chain, so strict installs work.
const hop = (fromDir, name) => dirname(createRequire(join(fromDir, 'package.json')).resolve(`${name}/package.json`));
const opensslDist = join(hop(pkgDir, '@crossbind/port-openssl-wasi'), 'dist/prebuilt', P);

const includes = [
    join(own, 'include'),
    join(opensslDist, 'include'),
];
const archives = [
    join(own, 'lib', 'libcurl.a'),
    join(opensslDist, 'lib', 'libssl.a'),
    join(opensslDist, 'lib', 'libcrypto.a'),
];

const work = mkdtempSync(join(tmpdir(), 'crossbind-wasi-e2e-'));
const server = createServer((req, res) => res.end('crossbind-curl-wasi-e2e-ok'));
try {
    const obj = join(work, 'main.o');
    const wasm = join(work, 'main.wasm');
    execFileSync(join(sdk, 'bin/clang'), [
        '--target=wasm32-wasip3', '-c', join(pkgDir, 'e2e/main.c'), '-o', obj, '-O2',
        '-D_WASI_EMULATED_SIGNAL', '-D_WASI_EMULATED_PROCESS_CLOCKS',
        '-D_WASI_EMULATED_MMAN', '-D_WASI_EMULATED_GETPID',
        ...includes.map((i) => `-I${i}`),
    ], { stdio: 'inherit' });
    execFileSync(join(sdk, 'bin/clang++'), [
        '--target=wasm32-wasip3',
        obj, ...archives,
        '-fwasm-exceptions', '-mexception-handling',
        '-mllvm', '-wasm-enable-sjlj', '-mllvm', '-wasm-use-legacy-eh=false',
        '-lunwind', '-lsetjmp', '-lwasi-emulated-signal', '-lwasi-emulated-process-clocks',
        '-lwasi-emulated-mman', '-lwasi-emulated-getpid',
        '-o', wasm,
    ], { stdio: 'inherit' });

    await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
    const url = `http://127.0.0.1:${server.address().port}/`;
    try {
        const { stdout } = await execFileP('wasmtime', [
            'run',
            '-S', 'inherit-network=y', '-S', 'allow-ip-name-lookup=y', '-S', 'tcp=y',
            '--env', `CURL_E2E_URL=${url}`,
            wasm,
        ], { timeout: 120000 });
        process.stdout.write(stdout);
        if (!stdout.includes(': PASS')) {
            console.error('FAIL: PASS marker missing');
            process.exitCode = 1;
        }
    } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        process.exitCode = 1;
    }
} finally {
    server.close();
    rmSync(work, { recursive: true, force: true });
}
