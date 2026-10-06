import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const holder = { config: null };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));
vi.mock('../src/actions/target.js', () => ({
    getFilteredTargetSpec: (specs) => (specs ?? []).map((spec) => spec.specs),
    getBuildTargets: () => [],
}));

const { default: getData } = await import('../src/actions/getData.js');

const target = {
    path: 'wasm-wasm32-st-release', platform: 'wasm', arch: 'wasm32', runtime: 'st', runtimeEnv: 'browser',
};

let work;

// A PROJ platform package with the data spec of the port; only one built for the target has a prebuilt for it.
function projPackage(name, { servesTarget }) {
    const output = path.join(work, name, 'dist');
    if (servesTarget) fs.mkdirSync(path.join(output, 'prebuilt', target.path, 'share', 'proj'), { recursive: true });
    return {
        paths: { output },
        targetSpecs: [{ specs: { data: { 'share/proj': 'proj' } } }],
        functions: { isEnabled: () => servesTarget },
        dependencies: [],
    };
}

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-getdata-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('getData', () => {
    // The port READMEs have an app import a port's wasm, Android and iOS packages together.
    test('takes data only from the packages that serve the target', () => {
        const wasm = projPackage('proj-wasm', { servesTarget: true });
        holder.config = {
            dependencies: [wasm, projPackage('proj-android', { servesTarget: false }), projPackage('proj-ios', { servesTarget: false })],
        };

        expect(getData('data', target)).toEqual({ [`${wasm.paths.output}/prebuilt/${target.path}/share/proj`]: 'proj' });
    });
});
