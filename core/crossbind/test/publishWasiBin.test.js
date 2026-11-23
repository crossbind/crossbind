import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { config: {} } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { publishWasiBin } = await import('../src/actions/publishBinary.js');

const target = { path: 'wasi-wasm32-st-release', runtimeEnv: 'wasi', wasmName: 'wordfreq-wasi-wasm32-st-release.wasm' };
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
        project = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-wasi-bin-')));
        build = upath.join(project, '.crossbind', 'build');
        output = upath.join(project, 'dist');
        fs.mkdirSync(build, { recursive: true });
        fs.writeFileSync(upath.join(build, target.wasmName), 'wasm');
    });

    afterEach(() => {
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('does nothing without a bin map, or for an http component', () => {
        writeManifest({});
        useConfig({});
        publishWasiBin(target);
        useConfig({ bin: BIN });
        publishWasiBin({ ...target, runtimeEnv: 'http' });

        expect(fs.existsSync(upath.join(output, 'prebuilt'))).toBe(false);
        expect(fs.existsSync(upath.join(project, 'bin'))).toBe(false);
    });

    test("lays the command out as a port's tool is, with its map and a stub over crossbind's runner", () => {
        writeManifest({ bin: COMMANDS });
        useConfig({ bin: BIN });

        publishWasiBin(target);

        const own = upath.join(output, 'prebuilt', target.path);
        expect(fs.readFileSync(upath.join(own, 'bin', 'wordfreq'), 'utf8')).toBe('wasm');
        expect(JSON.parse(fs.readFileSync(upath.join(own, 'crossbind-bin.json'), 'utf8'))).toEqual({ tools: BIN.tools });
        const stub = fs.readFileSync(upath.join(project, 'bin', 'wordfreq-wasi.mjs'), 'utf8');
        expect(stub).toContain("import { run } from 'crossbind/wasi-run';");
        expect(stub).toContain("await run(import.meta.url, 'wordfreq');");
    });

    test('stops before it writes anything, naming the line to add, when package.json lacks the command', () => {
        writeManifest({});
        useConfig({ bin: BIN });

        expect(() => publishWasiBin(target)).toThrow('"bin": { "wordfreq-wasi": "bin/wordfreq-wasi.mjs" }');
        expect(fs.existsSync(upath.join(project, 'bin'))).toBe(false);
        expect(fs.existsSync(upath.join(output, 'prebuilt'))).toBe(false);
    });

    test('stops, naming paths.output, when the package keeps its files in the build directory', () => {
        writeManifest({ bin: COMMANDS });
        useConfig({ bin: BIN, paths: { project, build, output: build } });

        expect(() => publishWasiBin(target)).toThrow("paths: { output: 'dist' }");
    });
});
