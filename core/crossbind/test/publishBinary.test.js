import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { config: {} } }));
vi.mock('../src/state/index.js', () => ({ default: state }));

const { publishNativeCommand, publishNodeAddon, publishWasiCommand } = await import('../src/actions/publishBinary.js');

const target = {
    wasmName: 'app-wasi-wasm32-st-release.wasm', commandName: 'app.darwin-arm64', addonName: 'app.darwin-arm64.node', jsName: 'app.native.cjs',
};

describe('publishing a built binary', () => {
    let work;
    let build;

    const usePaths = (output) => {
        state.config = { paths: { build, output } };
    };

    beforeEach(() => {
        work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-publish-'));
        build = path.join(work, '.crossbind', 'build');
        fs.mkdirSync(path.join(build, 'data'), { recursive: true });
        fs.writeFileSync(path.join(build, target.wasmName), 'wasm');
        fs.writeFileSync(path.join(build, target.commandName), 'executable');
        fs.writeFileSync(path.join(build, target.addonName), 'addon');
        fs.writeFileSync(path.join(build, target.jsName), 'loader');
        fs.writeFileSync(path.join(build, 'data', 'proj.db'), 'db');
    });

    afterEach(() => {
        fs.rmSync(work, { recursive: true, force: true });
    });

    // paths.output defaults to paths.build.
    test('leaves a WASI command and its data where they are when the output is the build directory', () => {
        usePaths(build);

        publishWasiCommand(target);

        expect(fs.readFileSync(path.join(build, target.wasmName), 'utf8')).toBe('wasm');
        expect(fs.readFileSync(path.join(build, 'data', 'proj.db'), 'utf8')).toBe('db');
    });

    test('copies a WASI command and its data to an output of its own', () => {
        const output = path.join(work, 'dist');
        fs.mkdirSync(output);
        usePaths(output);

        publishWasiCommand(target);

        expect(fs.readFileSync(path.join(output, target.wasmName), 'utf8')).toBe('wasm');
        expect(fs.readFileSync(path.join(output, 'data', 'proj.db'), 'utf8')).toBe('db');
    });

    test('leaves a native command where it is when the output is the build directory', () => {
        usePaths(build);

        publishNativeCommand(target);

        expect(fs.readFileSync(path.join(build, target.commandName), 'utf8')).toBe('executable');
    });

    test('leaves a Node-API addon and its loader where they are when the output is the build directory', () => {
        usePaths(build);

        publishNodeAddon(target);

        expect(fs.readFileSync(path.join(build, target.addonName), 'utf8')).toBe('addon');
        expect(fs.readFileSync(path.join(build, target.jsName), 'utf8')).toBe('loader');
    });

    test('copies a Node-API addon and its loader to an output of its own', () => {
        const output = path.join(work, 'dist');
        usePaths(output);

        publishNodeAddon(target);

        expect(fs.readFileSync(path.join(output, target.addonName), 'utf8')).toBe('addon');
        expect(fs.readFileSync(path.join(output, target.jsName), 'utf8')).toBe('loader');
    });

    test('copies a native command to an output of its own', () => {
        const output = path.join(work, 'dist');
        usePaths(output);

        publishNativeCommand(target);

        expect(fs.readFileSync(path.join(output, target.commandName), 'utf8')).toBe('executable');
    });
});
