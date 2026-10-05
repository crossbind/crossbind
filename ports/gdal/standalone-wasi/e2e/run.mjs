import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

// Run the shipped upstream-built gdal under wasmtime; proj.db mounts straight from the dep package.
const P = 'wasi-wasm32-st-release';
const pkgDir = resolve(import.meta.dirname, '..');
const own = join(pkgDir, 'dist/prebuilt', P);
const WASM = join(own, 'bin/gdal');

// Dep data resolves through the dependency chain, so strict installs work.
const hop = (fromDir, name) => dirname(createRequire(join(fromDir, 'package.json')).resolve(`${name}/package.json`));
const projShare = join(hop(pkgDir, '@crossbind/port-proj-wasi'), 'dist/prebuilt', P, 'share/proj');

// Derived, not hardcoded: a nativeVersion bump must not need an edit here.
const expectedVersion = `GDAL ${JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).nativeVersion}`;

try {
    execFileSync('wasmtime', ['--version'], { stdio: 'ignore' });
} catch {
    console.log('SKIP: wasmtime not installed (brew install wasmtime).');
    process.exit(0);
}
if (!existsSync(WASM)) {
    console.log('SKIP: prebuilt gdal missing - run `pnpm build` first.');
    process.exit(0);
}

const gdalArgs = (work, ...args) => [
    'run',
    `--dir=${work}::/work`,
    `--dir=${join(own, 'share/gdal')}::/gdal`,
    `--dir=${projShare}::/proj`,
    '--env', 'GDAL_DATA=/gdal', '--env', 'PROJ_DATA=/proj',
    '--env', 'GDAL_CACHEMAX=64',
    WASM, ...args,
];

const work = mkdtempSync(join(tmpdir(), 'gdal-standalone-wasi-e2e-'));
try {
    const version = execFileSync(
        'wasmtime', gdalArgs(work, '--version'),
        { encoding: 'utf8', timeout: 60000 },
    );
    process.stdout.write(version);
    if (!version.includes(expectedVersion)) {
        console.error('FAIL: unexpected --version output');
        process.exit(1);
    }

    // Multicall: the same binary answers as any mapped tool via argv[1] dispatch.
    const viaDispatch = execFileSync(
        'wasmtime', gdalArgs(work, 'gdalinfo', '--version'),
        { encoding: 'utf8', timeout: 60000 },
    );
    if (!viaDispatch.includes(expectedVersion)) {
        console.error('FAIL: multicall gdalinfo --version mismatch');
        process.exit(1);
    }
    console.log('multicall: gdalinfo dispatch ok');

    const geojson = {
        type: 'FeatureCollection',
        features: [{
            type: 'Feature',
            properties: { name: 'ankara' },
            geometry: { type: 'Point', coordinates: [32.85, 39.93] },
        }],
    };
    writeFileSync(join(work, 'in.geojson'), JSON.stringify(geojson));

    execFileSync(
        'wasmtime', gdalArgs(work, 'vector', 'convert', '/work/in.geojson', '/work/out.gpkg'),
        { encoding: 'utf8', timeout: 120000 },
    );
    const gpkg = readFileSync(join(work, 'out.gpkg'));
    if (!gpkg.subarray(0, 15).equals(Buffer.from('SQLite format 3'))) {
        console.error('FAIL: out.gpkg is not a SQLite database');
        process.exit(1);
    }

    // Command stub: the generated shim resolves target, mounts and env from the config graph.
    const stub = execFileSync('node', [join(pkgDir, 'bin/gdalinfo-wasi.mjs'), '--version'], {
        cwd: work, encoding: 'utf8', timeout: 60000,
    });
    if (!stub.includes(expectedVersion)) {
        console.error('FAIL: gdalinfo-wasi command stub mismatch');
        process.exit(1);
    }
    console.log(`gdal-standalone-wasi: PASS (upstream-built CLI, GeoJSON -> GPKG, ${gpkg.length} B sqlite db; command stub)`);
} finally {
    rmSync(work, { recursive: true, force: true });
}
