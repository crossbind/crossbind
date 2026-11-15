import {
    describe, test, expect, vi, beforeEach, afterEach,
} from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({ config: null }));
vi.mock('../src/state/index.js', () => ({ default: { get config() { return h.config; } } }));

const TARGET = { path: 'wasm-wasm32-st-release', platform: 'wasm' };

function packageConfig(root, name, { type, ownCMakeLists = false }) {
    const project = path.join(root, name);
    const output = path.join(project, 'dist');
    const cmake = ownCMakeLists ? path.join(project, 'CMakeLists.txt') : path.join(output, 'prebuilt', 'CMakeLists.txt');
    fs.mkdirSync(path.dirname(cmake), { recursive: true });
    fs.writeFileSync(cmake, '');
    return {
        package: { name },
        general: { name },
        export: { type },
        paths: {
            project, output, cmake, cmakeDir: path.dirname(cmake), cliCMakeListsTxt: path.join(root, 'cli', 'CMakeLists.txt'),
        },
    };
}

describe('getDependFilePath for a header of an npm dependency', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-depend-file-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    async function resolver(dependencies) {
        h.config = { allDependencies: dependencies, ext: { header: ['h'], module: ['i'] } };
        const { default: getDependFilePath } = await import('../src/integration/getDependFilePath.js');
        return (source) => getDependFilePath(source, TARGET);
    }

    test('a prebuilt package resolves the header its target ships', async () => {
        const lib = packageConfig(root, 'my-prebuilt-lib', { type: 'cmake' });
        const header = path.join(lib.paths.output, 'prebuilt', TARGET.path, 'include', 'Matrix.h');
        fs.mkdirSync(path.dirname(header), { recursive: true });
        fs.writeFileSync(header, '');
        const resolve = await resolver([lib]);
        expect(resolve('my-prebuilt-lib/Matrix.h')).toBe(header);
    });

    test('a prebuilt package without this target names the folder it looked for', async () => {
        const lib = packageConfig(root, 'my-unbuilt-lib', { type: 'cmake' });
        const resolve = await resolver([lib]);
        expect(() => resolve('my-unbuilt-lib/Matrix.h')).toThrow(`${lib.paths.output}/prebuilt/${TARGET.path}`);
    });

    test('a source package says its headers are for the app\'s C++', async () => {
        const lib = packageConfig(root, 'my-source-lib', { type: 'source' });
        const resolve = await resolver([lib]);
        expect(() => resolve('my-source-lib/sample/sample.h')).toThrow(/my-source-lib ships its sources.*include it in the app's native code/);
    });

    test('a cmake package built from its own CMakeLists says the same', async () => {
        const lib = packageConfig(root, 'my-cmake-lib', { type: 'cmake', ownCMakeLists: true });
        const resolve = await resolver([lib]);
        expect(() => resolve('my-cmake-lib/sample/sample.h')).toThrow(/my-cmake-lib ships its sources.*include it in the app's native code/);
    });
});
