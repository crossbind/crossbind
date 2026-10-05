import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const P = 'wasi-wasm32-st-release';
const pkgDir = resolve(import.meta.dirname, '..');
const own = join(pkgDir, 'dist/prebuilt', P);
const binJson = join(own, 'crossbind-bin.json');

try {
    execFileSync('wasmtime', ['--version'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: wasmtime not installed (brew install wasmtime).');
    process.exit(0);
}
if (!existsSync(binJson)) {
    console.log('SKIP: prebuilt missing - run \`pnpm build\` first.');
    process.exit(0);
}
const { tools } = JSON.parse(readFileSync(binJson, 'utf8'));
const hostTool = Object.keys(tools).find((name) => tools[name].kind === 'binary');

const work = mkdtempSync(join(tmpdir(), 'crossbind-bin-e2e-'));
const runWasm = (name, args, { input } = {}) => {
    const entry = tools[name];
    const file = join(own, 'bin', entry?.kind === 'multicall-entry' ? hostTool : name);
    const prefix = entry?.kind === 'multicall-entry' ? [name] : [];
    return execFileSync('wasmtime', [
        'run',
        `--dir=${work}::/work`,
        ...(existsSync(join(own, 'share/proj')) ? [`--dir=${join(own, 'share/proj')}::/proj`, '--env', 'PROJ_DATA=/proj'] : []),
        file, ...prefix, ...args,
    ], { encoding: 'utf8', timeout: 120000, input });
};
const tool = (name, args) => runWasm(name, args);
const toolIn = (name, args, input) => runWasm(name, args, { input });
const toolFail = (name, args) => {
    try {
        runWasm(name, args);
        console.error('FAIL: expected non-zero exit for', name, args.join(' '));
        process.exit(1);
    } catch (e) {
        return `${e.stdout || ''}${e.stderr || ''}`;
    }
};
const toolAny = (name, args) => {
    try { return runWasm(name, args); } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
};
const expect = (cond, label, detail) => {
    if (!cond) {
        console.error('FAIL:', label, '\n', String(detail).slice(0, 400));
        process.exit(1);
    }
};
const ppm = (w, h) => {
    const header = Buffer.from(`P6\n${w} ${h}\n255\n`);
    const pixels = Buffer.alloc(w * h * 3);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37) % 256;
    return Buffer.concat([header, pixels]);
};

try {
    const merc = toolIn('proj', ['+proj=merc', '+lat_ts=56.5'], '2 49\n');
    expect(merc.includes('123169'), 'proj merc x', merc);
    const inv = toolIn('cs2cs', ['+proj=latlong', '+to', '+proj=merc', '+lat_ts=56.5'], '2 49\n');
    expect(inv.includes('123169'), 'cs2cs via multicall dispatch', inv);
    const stub = execFileSync('node', [join(pkgDir, 'bin/cs2cs-wasi.mjs'), '+proj=latlong', '+to', '+proj=merc', '+lat_ts=56.5'], {
        cwd: work, encoding: 'utf8', input: '2 49\n', timeout: 120000,
    });
    expect(stub.includes('123169'), 'cs2cs-wasi command stub', stub);
    console.log('proj-standalone-wasi: PASS (proj merc + cs2cs multicall dispatch + command stub)');
    } finally {
    rmSync(work, { recursive: true, force: true });
}
