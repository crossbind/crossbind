import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import upath from 'upath';
import calculateDependencyParameters from '../src/state/calculateDependencyParameters.js';
import refreshBuiltDependencies from '../src/state/refreshBuiltDependencies.js';
import { getCliCMakeListsFile } from '../src/utils/getCMakeListsFilePath.js';

const CLI_CMAKE = getCliCMakeListsFile();
const target = { path: 'android-arm64-v8a-mt-debug', releasePath: 'android-arm64-v8a-mt-release', platform: 'android' };

let work;
let zlib;
let app;

beforeEach(() => {
    work = upath.normalize(fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-built-deps-')));
    // A port whose package had no build when the config loaded: its CMakeLists resolved to the CLI's own.
    zlib = {
        general: { name: 'zlib' },
        export: { type: 'cmake' },
        paths: { project: work, output: `${work}/dist`, cmake: CLI_CMAKE, cmakeDir: upath.dirname(CLI_CMAKE), header: `${work}/include`, native: `${work}/src` },
        dependencies: [],
        functions: { isEnabled: (t) => fs.existsSync(`${zlib.paths.cmakeDir}/${t.path}`) },
    };
    app = {
        export: { type: 'source' },
        ext: { header: ['h'], source: ['cpp'] },
        paths: { cmake: '/app/CMakeLists.txt', cmakeDir: '/app', cliCMakeListsTxt: CLI_CMAKE, header: '/app/src', native: '/app/src' },
        dependencies: [zlib],
        allDependencies: [zlib],
    };
    app.dependencyParameters = calculateDependencyParameters(app);
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('refreshBuiltDependencies', () => {
    test('takes in a dependency built after the config loaded', () => {
        fs.mkdirSync(`${work}/dist/prebuilt/${target.path}`, { recursive: true });
        fs.writeFileSync(`${work}/dist/prebuilt/CMakeLists.txt`, '');

        expect(refreshBuiltDependencies(app)).toBe(true);

        expect(app.dependencyParameters.getCmakeDependsPathAndName(target).pathsOfCmakeDepends).toEqual([`${work}/dist/prebuilt`]);
    });

    test('leaves a dependency that has no build yet', () => {
        const parameters = app.dependencyParameters;

        expect(refreshBuiltDependencies(app)).toBe(false);

        expect(app.dependencyParameters).toBe(parameters);
        expect(zlib.paths.cmake).toBe(CLI_CMAKE);
    });
});
