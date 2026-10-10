import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { compile, OUTPUT_NAME } from '../compiler/compile.js';

let root;
let paths;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'playground-compile-'));
    paths = { template: `${root}/template`, work: `${root}/work`, cli: `${root}/cli`, home: `${root}/home` };
    fs.mkdirSync(`${paths.template}/src/native`, { recursive: true });
    fs.mkdirSync(`${paths.template}/.crossbind/build`, { recursive: true });
    fs.writeFileSync(`${paths.template}/src/native/native.h`, '// sample');
    fs.writeFileSync(`${paths.template}/src/native/native.cpp`, '// sample');
    fs.writeFileSync(`${root}/secret.txt`, 'server secret');
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const files = { 'native.h': 'int answer();', 'native.cpp': 'int answer() { return 42; }' };
const output = (ext) => `${paths.work}/.crossbind/build/${OUTPUT_NAME}.${ext}`;

// Stands in for the sandboxed crossbind build: runs `step` in the workspace, then reports like runSandboxed.
const fakeRun = (step, result = {}) => async (argv) => {
    step(argv);
    return { code: 0, signal: null, timedOut: false, output: '', ms: 5, ...result };
};

const writeOutputs = () => {
    fs.writeFileSync(output('js'), 'var Module = {};');
    fs.writeFileSync(output('wasm'), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
};

test('builds the sources in a fresh copy of the template and returns the loader and the wasm', async () => {
    let seen;

    const result = await compile(files, {
        paths,
        run: fakeRun((argv) => {
            seen = { argv, header: fs.readFileSync(`${paths.work}/src/native/native.h`, 'utf8') };
            writeOutputs();
        }),
    });

    assert.equal(seen.header, 'int answer();');
    assert.ok(seen.argv.includes('bwrap') && seen.argv.includes(paths.work));
    assert.deepEqual({ ...result, log: undefined }, {
        ok: true, js: 'var Module = {};', wasm: Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).toString('base64'), log: undefined, ms: 5,
    });
});

test('removes the workspace afterwards, so no one\'s sources outlive their compile', async () => {
    await compile(files, { paths, run: fakeRun(writeOutputs) });

    assert.equal(fs.existsSync(paths.work), false);
    assert.equal(fs.readFileSync(`${paths.template}/src/native/native.h`, 'utf8'), '// sample');
});

test('reports a failed build with its log, workspace paths shortened to the file names', async () => {
    const result = await compile(files, {
        paths,
        run: fakeRun(() => {}, { code: 1, output: `${paths.work}/src/native/native.cpp:1:5: error: expected ';'\n` }),
    });

    assert.deepEqual(result, { ok: false, reason: 'compile', log: "native.cpp:1:5: error: expected ';'" });
});

test('reports a build that ran out of time', async () => {
    const result = await compile(files, { paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', timedOut: true }) });

    assert.equal(result.reason, 'timeout');
});

test('never reads through a link the build left at an output path', async () => {
    const result = await compile(files, {
        paths,
        run: fakeRun(() => {
            writeOutputs();
            fs.rmSync(output('js'));
            fs.symlinkSync(`${root}/secret.txt`, output('js'));
        }),
    });

    assert.equal(result.reason, 'output');
    assert.doesNotMatch(JSON.stringify(result), /server secret/);
});

test('never reads through a build folder swapped for a link out of the workspace', async () => {
    const elsewhere = `${root}/elsewhere`;

    const result = await compile(files, {
        paths,
        run: fakeRun(() => {
            fs.mkdirSync(elsewhere);
            fs.writeFileSync(`${elsewhere}/${OUTPUT_NAME}.js`, 'server secret');
            fs.writeFileSync(`${elsewhere}/${OUTPUT_NAME}.wasm`, 'server secret');
            fs.rmSync(`${paths.work}/.crossbind/build`, { recursive: true });
            fs.symlinkSync(elsewhere, `${paths.work}/.crossbind/build`);
        }),
    });

    assert.equal(result.reason, 'output');
    assert.doesNotMatch(JSON.stringify(result), /server secret/);
});

test('does not hang on a FIFO at an output path, and refuses outputs over their size limit', async () => {
    const fifo = await compile(files, {
        paths,
        run: fakeRun(() => {
            writeOutputs();
            fs.rmSync(output('wasm'));
            execFileSync('mkfifo', [output('wasm')]);
        }),
    });
    const large = await compile(files, { paths, run: fakeRun(writeOutputs), outputLimits: { js: 4, wasm: 1024 } });

    assert.equal(fifo.reason, 'output');
    assert.equal(large.reason, 'output');
});

test('clears a tree deeper than a path can name, with a folder it may not enter at the bottom', async () => {
    await compile(files, {
        paths,
        run: fakeRun(() => {
            writeOutputs();
            execFileSync('sh', ['-c', 'i=0; while [ $i -lt 600 ]; do mkdir d && cd d || exit 1; i=$((i+1)); done; mkdir locked && chmod 000 locked .'], { cwd: paths.work });
        }),
    });

    assert.equal(fs.existsSync(paths.work), false);
});

test('reports a build stopped for flooding its output or for the machine running low on memory', async () => {
    const flooded = await compile(files, { paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', flooded: true }) });
    const outOfMemory = await compile(files, { paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', outOfMemory: true }) });

    assert.deepEqual([flooded.reason, outOfMemory.reason], ['output', 'memory']);
});

test('clears a workspace the build left with folders it may not enter', async () => {
    await compile(files, {
        paths,
        run: fakeRun(() => {
            writeOutputs();
            fs.mkdirSync(`${paths.work}/locked/inner`, { recursive: true });
            fs.writeFileSync(`${paths.work}/locked/inner/file`, 'x');
            fs.chmodSync(`${paths.work}/locked/inner`, 0);
            fs.chmodSync(`${paths.work}/locked`, 0);
        }),
    });

    assert.equal(fs.existsSync(paths.work), false);
});
