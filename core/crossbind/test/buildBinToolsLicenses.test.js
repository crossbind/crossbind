import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const holder = { config: null };
vi.mock('../src/state/index.js', () => ({
    default: {
        get config() { return holder.config; },
        targets: [],
    },
}));

const TARGET = { path: 'wasi-wasm32-st-release', platform: 'wasi' };
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => [TARGET] }));

// A wasi binary links the toolchain runtime beyond its own package, which only the platform's rows carry.
const ROWS = [
    { name: 'demo', license: 'BSD-3-Clause', nativeVersion: '1.0.0', licenseText: 'demo license' },
    { name: 'wasi-libc', license: 'Apache-2.0 WITH LLVM-exception', licenseText: 'wasi-libc license' },
];
vi.mock('../src/actions/licenses.js', () => ({ default: vi.fn(async (platform) => (platform === 'wasi' ? ROWS : ROWS.slice(0, 1))) }));
vi.mock('../src/utils/provenance.js', () => ({ default: (target) => ({ sbom: `dist/prebuilt/${target.path}/sbom.cdx.json` }) }));

const { default: buildBinTools } = await import('../src/actions/buildBinTools.js');

const NAME = '@crossbind/port-demo-standalone-wasi';
let dir;

beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-bin-licenses-')));
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: NAME, version: '1.0.0' }, null, 4)}\n`);
    fs.mkdirSync(path.join(dir, 'dist', 'prebuilt', TARGET.path), { recursive: true });
    holder.config = {
        package: { name: NAME, version: '1.0.0' },
        build: { bin: { tools: { demo: { kind: 'binary', publish: true } }, commands: false } },
        paths: { project: dir, output: path.join(dir, 'dist') },
    };
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('a wasi bin build derives its license files from one set of rows', () => {
    test('the SBOM and the notices beside the binary list what the platform links in, as the LICENSE does', async () => {
        await buildBinTools({});
        const prebuilt = path.join(dir, 'dist', 'prebuilt', TARGET.path);
        const sbom = JSON.parse(fs.readFileSync(path.join(prebuilt, 'sbom.cdx.json'), 'utf8'));
        expect(sbom.metadata.component).toEqual({ type: 'library', name: NAME, version: '1.0.0' });
        expect(sbom.components.map((component) => component.name)).toEqual(['demo', 'wasi-libc']);
        expect(fs.readFileSync(path.join(prebuilt, 'THIRD-PARTY-LICENSES.md'), 'utf8')).toContain('## wasi-libc');
        expect(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8')).toContain('## wasi-libc');
    });
});
