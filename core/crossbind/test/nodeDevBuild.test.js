import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import upath from 'upath';
import {
    devFormatOf, ensureDevBuild, nativeInputsFingerprint, projectDirOf,
} from '../src/utils/nodeDevBuild.js';

let work;

function write(file, text = '') {
    const full = upath.join(work, file);
    fs.mkdirSync(upath.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
    return full;
}

// A resolved config the way loadConfig hands it over, for an app with its C++ in src/native.
function configOf() {
    return {
        paths: {
            project: work,
            cache: `${work}/.crossbind`,
            output: `${work}/dist`,
            native: [`${work}/src/native`],
            header: [`${work}/src/native`],
            module: [`${work}/src/native`],
        },
        ext: { header: ['h', 'hpp'], source: ['c', 'cpp'], module: ['i'] },
    };
}

beforeEach(() => {
    work = upath.normalize(fs.realpathSync(fs.mkdtempSync(upath.join(os.tmpdir(), 'crossbind-dev-build-'))));
    write('package.json', '{ "name": "demo", "type": "module" }\n');
    write('crossbind.config.mjs', "export default { general: { name: 'demo' } };\n");
    write('src/native/native.h', 'int answer();\n');
    write('src/native/native.cpp', 'int answer() { return 42; }\n');
    write('src/index.mjs', "import { initNative, answer } from './native/native.h';\nawait initNative();\nconsole.log(answer());\n");
});

afterEach(() => {
    fs.rmSync(work, { recursive: true, force: true });
});

describe('nativeInputsFingerprint', () => {
    test('stays the same while nothing native changes, an edit to plain JavaScript included', () => {
        const before = nativeInputsFingerprint(configOf());
        write('src/index.mjs', "import { initNative, answer } from './native/native.h';\nawait initNative();\nconsole.log('the answer', answer());\n");

        expect(nativeInputsFingerprint(configOf())).toBe(before);
    });

    test('changes with a native source, a new native import or another name taken from a header', () => {
        const fingerprints = [nativeInputsFingerprint(configOf())];
        write('src/native/native.cpp', 'int answer() { return 43; }\n');
        fingerprints.push(nativeInputsFingerprint(configOf()));
        write('src/extra.mjs', "import { Version } from 'cargo:semver';\n");
        fingerprints.push(nativeInputsFingerprint(configOf()));
        write('src/index.mjs', "import { initNative, answer, ANSWER } from './native/native.h';\nawait initNative();\n");
        fingerprints.push(nativeInputsFingerprint(configOf()));

        expect(new Set(fingerprints).size).toBe(4);
    });
});

describe('devFormatOf', () => {
    test('runs the addon where the project installs the Node-API runtime, the wasm build elsewhere', () => {
        expect(devFormatOf(work)).toBe('wasm');
        write('node_modules/@crossbind/core-embind-napi/package.json', '{ "name": "@crossbind/core-embind-napi" }\n');

        expect(devFormatOf(work)).toBe('napi');
    });
});

describe('ensureDevBuild', () => {
    // Stands in for `crossbind build`: writes the entry the build writes, and the hooks when asked to.
    const buildWith = (hooks) => vi.fn(() => {
        write('dist/node/wasm.mjs');
        if (hooks) write('dist/node/wasm.register.mjs');
    });

    test('builds this machine\'s binary on the first start and after a change, and not in between', () => {
        const run = buildWith(true);

        ensureDevBuild(configOf(), { run });
        ensureDevBuild(configOf(), { run });
        write('src/native/native.h', 'int answer();\nint other();\n');
        ensureDevBuild(configOf(), { run });

        expect(run).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledWith(work, ['-p', 'wasm', '-a', 'wasm32', '-r', 'st', '-e', 'node', '-b', 'release']);
    });

    test('builds again when the output is gone, though nothing native changed', () => {
        const run = buildWith(true);
        ensureDevBuild(configOf(), { run });
        fs.rmSync(upath.join(work, 'dist'), { recursive: true });

        ensureDevBuild(configOf(), { run });

        expect(run).toHaveBeenCalledTimes(2);
    });

    test('hands back the hooks the build wrote, or none for an app that imports nothing native', () => {
        expect(ensureDevBuild(configOf(), { run: buildWith(true) })).toBe(`${work}/dist/node/wasm.register.mjs`);
        fs.rmSync(upath.join(work, 'dist'), { recursive: true });

        expect(ensureDevBuild(configOf(), { run: buildWith(false) })).toBeNull();
    });

    test('records no build that failed, so the next start builds again', () => {
        const failing = vi.fn(() => { throw new Error('crossbind: the build failed'); });
        expect(() => ensureDevBuild(configOf(), { run: failing })).toThrow('the build failed');
        const run = buildWith(true);

        ensureDevBuild(configOf(), { run });

        expect(run).toHaveBeenCalledTimes(1);
    });
});

describe('projectDirOf', () => {
    test('finds the config above the app\'s main module, and names what is missing otherwise', () => {
        expect(projectDirOf(upath.join(work, 'src/index.mjs'))).toBe(work);
        fs.rmSync(upath.join(work, 'crossbind.config.mjs'));

        expect(() => projectDirOf(upath.join(work, 'src/index.mjs'))).toThrow(/no crossbind.config/);
    });
});
