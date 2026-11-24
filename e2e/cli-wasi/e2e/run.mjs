import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs the built command under wasmtime (47+: Wasm 3.0 exceptions are on by default), then packs the package, installs
// the tarball and runs the npm command its config's bin map makes of the command, with the licenses of what it links.
const ROOT = resolve(import.meta.dirname, '..');
const WASM = join(ROOT, 'dist/crossbind-e2e-cli-wasi-wasi-wasm32-st-release.wasm');
const EXPECTATIONS = ['argv[1]=merhaba', 'fs roundtrip: PASS', 'seek roundtrip: PASS', 'exceptions: PASS'];
// Of dist/, the package carries the command, its map and its licenses, none of what the build leaves beside them.
const PACKED_DIST = [
    'dist/prebuilt/wasi-wasm32-st-release/bin/e2e-cli',
    'dist/prebuilt/wasi-wasm32-st-release/crossbind-bin.json',
    'dist/prebuilt/wasi-wasm32-st-release/sbom.cdx.json',
    'dist/prebuilt/wasi-wasm32-st-release/THIRD-PARTY-LICENSES.md',
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
    if (dist.join() !== PACKED_DIST.toSorted().join()) {
        throw new Error(`FAIL: the package carries [${dist.join(', ')}] of dist/, not [${PACKED_DIST.join(', ')}]`);
    }
    console.log('ok: the package carries the command, its map and its licenses, and nothing else of dist/');
    npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, join(prefix, pack.filename)], prefix);
    // The fixture links no port, so the licenses it carries are the wasi-sdk runtime's.
    const installed = join(prefix, 'node_modules/@crossbind/e2e-cli-wasi');
    const licenses = readFileSync(join(installed, 'dist/prebuilt/wasi-wasm32-st-release/THIRD-PARTY-LICENSES.md'), 'utf8');
    if (!licenses.includes('## wasi-libc')) throw new Error('FAIL: the installed THIRD-PARTY-LICENSES.md names no wasi-libc, which the command links');
    console.log('ok: the installed package carries the licenses of the wasi-sdk runtime it links');
    // An app's package takes crossbind from npm as a dependency; this one takes the workspace's.
    symlinkSync(resolve(ROOT, '../../core/crossbind'), join(prefix, 'node_modules/crossbind'), 'dir');
    expectRun('the installed e2e-cli-wasi ran it through crossbind/wasi-run', join(prefix, 'node_modules/.bin/e2e-cli-wasi'), ['merhaba']);
} finally {
    rmSync(prefix, { recursive: true, force: true });
}
