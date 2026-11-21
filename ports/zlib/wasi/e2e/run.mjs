import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Compile e2e/main.c against the shipped archives and assert the marker under wasmtime.
const P = 'wasi-wasm32-st-release';
const pkgDir = resolve(import.meta.dirname, '..');

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
const depDist = (...names) => {
    let dir = pkgDir;
    for (const name of names) dir = hop(dir, name);
    return join(dir, 'dist/prebuilt', P);
};

const includes = [
    join(own, 'include'),
];
const archives = [
    join(own, 'lib', 'libz.a'),
];

const work = mkdtempSync(join(tmpdir(), 'crossbind-wasi-e2e-'));
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
    const out = execFileSync('wasmtime', [
        'run', `--dir=${work}::/work`,
        wasm,
    ], { encoding: 'utf8', timeout: 120000 });
    process.stdout.write(out);
    if (!out.includes(': PASS')) {
        console.error('FAIL: PASS marker missing');
        process.exit(1);
    }
} finally {
    rmSync(work, { recursive: true, force: true });
}
