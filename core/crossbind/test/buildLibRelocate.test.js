import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upath from 'upath';

const TARGET = {
    path: 'linux-x64-mt-release', releasePath: 'linux-x64-mt-release', platform: 'linux', buildType: 'release',
};
const holder = { config: null };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));
vi.mock('../src/actions/createLib.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => [TARGET], getFilteredTargetSpec: () => [] }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), cachedStep: vi.fn() } }));

const { default: buildLib } = await import('../src/actions/buildLib.js');
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let work;

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-buildlib-relocate-')));
    holder.config = {
        general: { name: 'demo' },
        export: { type: 'cmake', libName: ['demo'] },
        paths: {
            base: work, project: work, output: `${work}/dist`, build: `${work}/build`, module: [], native: [], cli,
        },
        dependencies: [],
        targetSpecs: [],
    };
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

const pcFile = (prefixDir) => `${prefixDir}/lib/pkgconfig/demo.pc`;

function writePc(prefixDir, prefix) {
    fs.mkdirSync(path.dirname(pcFile(prefixDir)), { recursive: true });
    fs.writeFileSync(pcFile(prefixDir), `prefix=${prefix}\n`);
}

describe('buildLib', () => {
    test('relocates the prebuilt it copies to the output', () => {
        // createLib is mocked, so stage what its install step leaves behind.
        const installPrefix = `${work}/build/Source-Release/prebuilt/${TARGET.path}`;
        writePc(installPrefix, installPrefix);

        buildLib({}, { skipXcframework: true });

        expect(fs.readFileSync(pcFile(`${work}/dist/prebuilt/${TARGET.path}`), 'utf8')).toBe('prefix=${pcfiledir}/../..\n');
    });

    test('relocates a cached prebuilt that a docker build installed', () => {
        const prefixDir = `${work}/dist/prebuilt/${TARGET.path}`;
        writePc(prefixDir, `/tmp/crossbind/live/build/Source-Release/prebuilt/${TARGET.path}`);

        buildLib({}, { skipXcframework: true });

        expect(fs.readFileSync(pcFile(prefixDir), 'utf8')).toBe('prefix=${pcfiledir}/../..\n');
    });
});
