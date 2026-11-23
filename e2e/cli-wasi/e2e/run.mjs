import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the built command under wasmtime (47+: Wasm 3.0 exceptions are on by default), then packs the package, installs
// the tarball and runs the npm command its config's bin map makes of the command.
const ROOT = resolve(import.meta.dirname, '..');
const WASM = join(ROOT, 'dist/crossbind-e2e-cli-wasi-wasi-wasm32-st-release.wasm');
const EXPECTATIONS = ['argv[1]=merhaba', 'fs roundtrip: PASS', 'seek roundtrip: PASS', 'exceptions: PASS'];
// Of dist/, the package carries the command and its map, none of what the build leaves beside them.
const PACKED_DIST = [
    'dist/prebuilt/wasi-wasm32-st-release/bin/e2e-cli',
    'dist/prebuilt/wasi-wasm32-st-release/crossbind-bin.json',
];

try {
    execFileSync('wasmtime', ['--version'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: wasmtime not installed (brew install wasmtime) - wasi e2e not run.');
    process.exit(0);
}

// Runs a command from a working directory of its own and checks what it prints.
function expectRun(what, file, args) {
    const cwd = mkdtempSync(join(tmpdir(), 'crossbind-wasi-'));
    try {
        const out = execFileSync(file, args, { cwd, encoding: 'utf8', timeout: 60000 });
        process.stdout.write(out);
        const missing = EXPECTATIONS.filter((marker) => !out.includes(marker));
        if (missing.length > 0) throw new Error(`FAIL: ${what}: missing ${missing.map((marker) => `"${marker}"`).join(', ')}`);
        console.log(`ok: ${what}`);
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
}

expectRun('wasi command ran under wasmtime', 'wasmtime', ['run', '--dir=.', WASM, 'merhaba']);

const prefix = mkdtempSync(join(tmpdir(), 'crossbind-wasi-npm-'));
try {
    const npm = (args, cwd) => execFileSync('npm', args, { cwd, encoding: 'utf8' });
    const [pack] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', prefix], ROOT));
    const dist = pack.files.map((file) => file.path).filter((file) => file.startsWith('dist/')).sort();
    if (dist.join() !== PACKED_DIST.join()) {
        throw new Error(`FAIL: the package carries [${dist.join(', ')}] of dist/, not [${PACKED_DIST.join(', ')}]`);
    }
    console.log('ok: the package carries the command and its map, and nothing else of dist/');
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, join(prefix, pack.filename)], prefix);
    // An app's package takes crossbind from npm as a dependency; this one takes the workspace's.
    symlinkSync(resolve(ROOT, '../../core/crossbind'), join(prefix, 'node_modules/crossbind'), 'dir');
    expectRun('the installed e2e-cli-wasi ran it through crossbind/wasi-run', join(prefix, 'node_modules/.bin/e2e-cli-wasi'), ['merhaba']);
} finally {
    rmSync(prefix, { recursive: true, force: true });
}
