import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the built command under wasmtime (47+: Wasm 3.0 exceptions are on by default).
const WASM = resolve(import.meta.dirname, '../dist/crossbind-e2e-cli-wasi-wasi-wasm32-st-release.wasm');

try {
    execFileSync('wasmtime', ['--version'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: wasmtime not installed (brew install wasmtime) - wasi e2e not run.');
    process.exit(0);
}

const cwd = mkdtempSync(join(tmpdir(), 'crossbind-wasi-'));
try {
    const out = execFileSync(
        'wasmtime',
        ['run', '--dir=.', WASM, 'merhaba'],
        { cwd, encoding: 'utf8', timeout: 60000 },
    );
    process.stdout.write(out);
    const expectations = ['argv[1]=merhaba', 'fs roundtrip: PASS', 'seek roundtrip: PASS', 'exceptions: PASS'];
    for (const marker of expectations) {
        if (!out.includes(marker)) {
            console.error(`FAIL: missing "${marker}"`);
            process.exit(1);
        }
    }
    console.log('ok: wasi command ran under wasmtime');
} finally {
    rmSync(cwd, { recursive: true, force: true });
}
