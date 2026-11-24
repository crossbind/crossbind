import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { state, collectLicenseRows } = vi.hoisted(() => ({
    state: { config: {} },
    // A command that links expat, beside the wasi-sdk runtime every wasi command links.
    collectLicenseRows: vi.fn(async () => [
        { name: 'wasi-libc', license: 'Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT', licenseText: 'wasi-libc licenses' },
        { name: 'expat', license: 'MIT', nativeVersion: '2.7.3', licenseText: 'Permission is hereby granted, free of charge, to any person' },
    ]),
}));
vi.mock('../src/state/index.js', () => ({ default: state }));
vi.mock('../src/actions/licenses.js', () => ({ default: collectLicenseRows }));

const { publishWasiBin } = await import('../src/actions/publishBinary.js');

const target = {
    path: 'wasi-wasm32-st-release', platform: 'wasi', runtimeEnv: 'wasi', wasmName: 'wordfreq-wasi-wasm32-st-release.wasm',
};
const BIN = { tools: { wordfreq: { kind: 'binary', publish: true } } };
const COMMANDS = { 'wordfreq-wasi': 'bin/wordfreq-wasi.mjs' };

describe("publishing an app's own WASI command for npm", () => {
    let project;
    let build;
    let output;

    const writeManifest = (fields) => {
        fs.writeFileSync(upath.join(project, 'package.json'), `${JSON.stringify({ name: 'wordfreq', ...fields })}\n`);
    };
    const useConfig = (config) => {
        state.config = { paths: { project, build, output }, ...config };
    };

    beforeEach(() => {
        collectLicenseRows.mockClear();
        project = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-wasi-bin-')));
        build = upath.join(project, '.crossbind', 'build');
        output = upath.join(project, 'dist');
        fs.mkdirSync(build, { recursive: true });
        fs.writeFileSync(upath.join(build, target.wasmName), 'wasm');
    });

    afterEach(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('does nothing without a bin map, or for an http component', async () => {
        writeManifest({});
        useConfig({});
        await publishWasiBin(target);
        useConfig({ bin: BIN });
        await publishWasiBin({ ...target, runtimeEnv: 'http' });

        expect(fs.existsSync(upath.join(output, 'prebuilt'))).toBe(false);
        expect(fs.existsSync(upath.join(project, 'bin'))).toBe(false);
    });

    test("lays the command out as a port's tool is, with its map and a stub over crossbind's runner", async () => {
        writeManifest({ bin: COMMANDS });
        useConfig({ bin: BIN });

        await publishWasiBin(target);

        const own = upath.join(output, 'prebuilt', target.path);
        expect(fs.readFileSync(upath.join(own, 'bin', 'wordfreq'), 'utf8')).toBe('wasm');
        expect(JSON.parse(fs.readFileSync(upath.join(own, 'crossbind-bin.json'), 'utf8'))).toEqual({ tools: BIN.tools });
        const stub = fs.readFileSync(upath.join(project, 'bin', 'wordfreq-wasi.mjs'), 'utf8');
        expect(stub).toContain("import { run } from 'crossbind/wasi-run';");
        expect(stub).toContain("await run(import.meta.url, 'wordfreq');");
    });

    test("carries the licenses of what the command links beside it, as a port's tools do", async () => {
        writeManifest({ version: '1.2.3', bin: COMMANDS });
        useConfig({ bin: BIN });

        await publishWasiBin(target);

        const own = upath.join(output, 'prebuilt', target.path);
        expect(collectLicenseRows).toHaveBeenCalledWith('wasi');
        const notices = fs.readFileSync(upath.join(own, 'THIRD-PARTY-LICENSES.md'), 'utf8');
        expect(notices).toContain('## expat — MIT');
        expect(notices).toContain('Permission is hereby granted');
        const sbom = JSON.parse(fs.readFileSync(upath.join(own, 'sbom.cdx.json'), 'utf8'));
        expect(sbom.metadata.component).toMatchObject({ name: 'wordfreq', version: '1.2.3' });
        expect(sbom.components.map((component) => component.name)).toEqual(['expat', 'wasi-libc']);
    });

    test('stops before it writes anything, naming the line to add, when package.json lacks the command', async () => {
        writeManifest({});
        useConfig({ bin: BIN });

        await expect(publishWasiBin(target)).rejects.toThrow('"bin": { "wordfreq-wasi": "bin/wordfreq-wasi.mjs" }');
        expect(fs.existsSync(upath.join(project, 'bin'))).toBe(false);
        expect(fs.existsSync(upath.join(output, 'prebuilt'))).toBe(false);
    });

    test('stops, naming paths.output, when the package keeps its files in the build directory', async () => {
        writeManifest({ bin: COMMANDS });
        useConfig({ bin: BIN, paths: { project, build, output: build } });

        await expect(publishWasiBin(target)).rejects.toThrow("paths: { output: 'dist' }");
    });
});
