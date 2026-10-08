import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import upath from 'upath';
import { writeNativeSourceStamp } from '../src/utils/nativeSourceStamp.js';

const TARGET = {
    path: 'wasm-wasm32-st-release', releasePath: 'wasm-wasm32-st-release', platform: 'wasm', buildType: 'release',
};
const holder = { config: null };
vi.mock('../src/state/index.js', () => ({ default: { get config() { return holder.config; } } }));
vi.mock('../src/actions/createLib.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/createXCFramework.js', () => ({ default: vi.fn() }));
vi.mock('../src/actions/target.js', () => ({ getBuildTargets: () => [TARGET], getFilteredTargetSpec: () => [] }));
vi.mock('../src/utils/logger.js', () => ({ default: { info: vi.fn(), cachedStep: vi.fn() } }));

const { default: createLib } = await import('../src/actions/createLib.js');
const { default: buildLib } = await import('../src/actions/buildLib.js');
const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');

let work;
const lib = () => `${work}/dist/prebuilt/${TARGET.path}/lib/libdemo.a`;
const header = () => `${work}/src/native/demo.h`;
const age = (file, seconds) => {
    const time = new Date(Date.now() - seconds * 1000);
    fs.utimesSync(file, time, time);
};

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-buildlib-native-')));
    fs.mkdirSync(path.dirname(lib()), { recursive: true });
    fs.mkdirSync(path.dirname(header()), { recursive: true });
    fs.writeFileSync(lib(), 'archive');
    fs.writeFileSync(header(), 'inline int answer() { return 42; }');
    holder.config = {
        general: { name: 'demo' },
        export: { type: 'cmake', libName: ['demo'] },
        paths: {
            base: work, project: work, output: `${work}/dist`, build: `${work}/build`, module: [], native: [`${work}/src/native`], cli,
        },
        dependencies: [],
        targetSpecs: [],
    };
    createLib.mockClear();
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('buildLib and the project\'s own native sources', () => {
    test('rebuilds the library when a native source changed after it was built', () => {
        age(lib(), 60);

        buildLib({}, { skipXcframework: true });

        expect(createLib).toHaveBeenCalledWith(TARGET, 'Source', expect.objectContaining({ force: true }));
    });

    test('serves the built library while every native source is older', () => {
        age(header(), 60);
        writeNativeSourceStamp(path.dirname(lib()), holder.config.paths.native);

        buildLib({}, { skipXcframework: true });

        expect(createLib).not.toHaveBeenCalled();
    });

    test('rebuilds after removing a native source, and caches the new inventory', () => {
        writeNativeSourceStamp(path.dirname(lib()), holder.config.paths.native);
        fs.unlinkSync(header());

        buildLib({}, { skipXcframework: true });
        expect(createLib).toHaveBeenCalledWith(TARGET, 'Source', expect.objectContaining({ force: true }));
        createLib.mockClear();
        buildLib({}, { skipXcframework: true });
        expect(createLib).not.toHaveBeenCalled();
    });
});
