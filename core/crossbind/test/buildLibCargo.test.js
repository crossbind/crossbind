import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = { path: 'wasm-wasm32-st-release', releasePath: 'wasm-wasm32-st-release', platform: 'wasm' };
const holder = { config: null };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));
vi.mock('../src/actions/createLib.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => [TARGET], getFilteredTargetSpec: () => [] }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), cachedStep: vi.fn() } }));
vi.mock('../src/utils/embindRsFingerprint.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getEmbindRsFingerprint: () => 'current',
}));

const { default: buildLib } = await import('../src/actions/buildLib.js');
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let work;

beforeEach(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-buildlib-'));
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

function configOf(type) {
    return {
        general: { name: 'demo' },
        export: { type, libName: ['demo'] },
        paths: { project: work, output: `${work}/dist`, build: `${work}/build`, module: [], cli },
        dependencies: [],
        targetSpecs: [],
    };
}

const stamp = () => `${work}/dist/prebuilt/${TARGET.path}/crossbind-embind-rs.fingerprint`;

describe('buildLib', () => {
    // An app links a cargo package's archive only while it comes from the embind-rs the app links.
    test('stamps a cargo package prebuilt with the embind-rs it was built from', () => {
        holder.config = configOf('cargo');

        buildLib({}, { skipXcframework: true });

        expect(fs.readFileSync(stamp(), 'utf8')).toBe('current');
    });

    test('leaves the prebuilt of a cmake package unstamped', () => {
        holder.config = configOf('cmake');

        buildLib({}, { skipXcframework: true });

        expect(fs.existsSync(stamp())).toBe(false);
    });
});
