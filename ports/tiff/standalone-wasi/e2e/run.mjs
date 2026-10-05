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
        file, ...prefix, ...args,
    ], { encoding: 'utf8', timeout: 120000, input });
};
const tool = (name, args) => runWasm(name, args);
const toolFail = (name, args, input) => {
    try {
        runWasm(name, args, { input });
        console.error('FAIL: expected non-zero exit for', name, args.join(' '));
        process.exit(1);
    } catch (e) {
        return `${e.stdout || ''}${e.stderr || ''}`;
    }
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
    writeFileSync(join(work, 'in.ppm'), ppm(16, 16));
    tool('ppm2tiff', ['/work/in.ppm', '/work/a.tif']);
    const info = tool('tiffinfo', ['/work/a.tif']);
    expect(info.includes('Image Width: 16'), 'tiffinfo width', info);
    tool('tiffcp', ['/work/a.tif', '/work/b.tif']);
    tool('tiffcmp', ['/work/a.tif', '/work/b.tif']);
    const dump = tool('tiffdump', ['/work/b.tif']);
    expect(dump.includes('ImageWidth'), 'tiffdump tags', dump);
    // stdin mode needs tmpfile(), which the core stub declines on WASI; file arguments work.
    const faxErr = toolFail('fax2ps', [], '');
    expect(faxErr.includes('Could not obtain temporary file'), 'fax2ps stdin degrades cleanly', faxErr);
    const stub = execFileSync('node', [join(pkgDir, 'bin/tiffinfo-wasi.mjs'), 'a.tif'], { cwd: work, encoding: 'utf8', timeout: 120000 });
    expect(stub.includes('Image Width: 16'), 'tiffinfo-wasi command stub', stub);
    console.log('tiff-standalone-wasi: PASS (ppm -> tiff, tiffinfo/tiffcp/tiffcmp/tiffdump; fax2ps stdin contract; command stub)');
} finally {
    rmSync(work, { recursive: true, force: true });
}
