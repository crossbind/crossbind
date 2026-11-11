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
    paths = { template: `${root}/template`, work: `${root}/work`, cli: `${root}/cli`, home: `${root}/home`, store: `${root}/store` };
    fs.mkdirSync(`${paths.template}/src/native`, { recursive: true });
    fs.mkdirSync(`${paths.template}/.crossbind/build`, { recursive: true });
    fs.writeFileSync(`${paths.template}/src/native/native.h`, '// sample');
    fs.writeFileSync(`${paths.template}/src/native/native.cpp`, '// sample');
    fs.writeFileSync(`${root}/secret.txt`, 'server secret');
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

const request = { files: { 'native/native.cpp': 'int answer() { return 42; }', 'native/native.h': 'int answer();' }, packages: [] };
const output = (ext) => `${paths.work}/.crossbind/build/${OUTPUT_NAME}.${ext}`;
const importsFile = () => `${paths.work}/.crossbind/build/browser/imports.json`;
const IMPORTS = { natives: [{ file: 'src/native/native.h', specifiers: [], names: ['answer'] }] };

// Stands in for the sandboxed crossbind build: runs `step` in the workspace, then reports like runSandboxed.
const fakeRun = (step, result = {}) => async (argv) => {
    step(argv);
    return { code: 0, signal: null, timedOut: false, output: '', ms: 5, ...result };
};

const writeOutputs = (imports = IMPORTS) => {
    fs.writeFileSync(output('js'), 'var Module = {};');
    fs.writeFileSync(output('wasm'), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    fs.mkdirSync(path.dirname(importsFile()), { recursive: true });
    fs.writeFileSync(importsFile(), typeof imports === 'string' ? imports : JSON.stringify(imports));
};

test('builds the sources in a fresh copy of the template and returns the loader, the wasm and what it binds', async () => {
    let seen;

    const result = await compile(request, {
        paths,
        run: fakeRun((argv) => {
            seen = { argv, header: fs.readFileSync(`${paths.work}/src/native/native.h`, 'utf8') };
            writeOutputs();
        }),
    });

    assert.equal(seen.header, 'int answer();');
    assert.ok(seen.argv.includes('bwrap') && seen.argv.includes(paths.work));
    assert.deepEqual({ ...result, log: undefined }, {
        ok: true, js: 'var Module = {};', wasm: Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]).toString('base64'), imports: IMPORTS, log: undefined, ms: 5,
    });
});

test('writes the project the build reads: its sources, main.js and a config for its packages', async () => {
    fs.writeFileSync(`${paths.template}/src/main.js`, '// the template\'s own');
    let seen;

    await compile({
        files: { 'main.js': "import { greet } from './native/greet.h';", 'native/greet.h': 'int greet();', 'native/math.rs': 'pub fn f() {}' },
        packages: ['crate:uuid', 'port:sqlite3'],
    }, {
        paths,
        run: fakeRun((argv) => {
            const read = (file) => fs.readFileSync(`${paths.work}/${file}`, 'utf8');
            seen = {
                argv,
                native: fs.readdirSync(`${paths.work}/src/native`).sort(),
                main: read('src/main.js'),
                rust: read('src/native/math.rs'),
                config: read('crossbind.config.js'),
            };
            writeOutputs();
        }),
    });

    // The template's sample sources are gone, so only the visitor's are bound.
    assert.deepEqual(seen.native, ['greet.h', 'math.rs']);
    assert.equal(seen.main, "import { greet } from './native/greet.h';");
    assert.equal(seen.rust, 'pub fn f() {}');
    assert.match(seen.config, /@crossbind\/port-sqlite3-wasm\/crossbind\.config\.js/);
    assert.match(seen.config, /^ {4}packages: \{\n {8}cargo: \{\n {12}uuid: '/m);
    assert.ok(seen.argv.includes('--bind-imports'));
});

test('leaves main.js out when the project has none', async () => {
    fs.writeFileSync(`${paths.template}/src/main.js`, '// the template\'s own');
    let hasMain;

    await compile(request, { paths, run: fakeRun(() => { hasMain = fs.existsSync(`${paths.work}/src/main.js`); writeOutputs(); }) });

    assert.equal(hasMain, false);
});

test('lays the package store over the build\'s caches, writable for this compile only', async () => {
    let argv;

    await compile(request, { paths, run: fakeRun((seen) => { argv = seen; writeOutputs(); }) });

    const tmp = argv.indexOf('/tmp');
    const at = (from, to) => argv.findIndex((item, i) => item === '--overlay-src' && argv[i + 1] === from && argv[i + 2] === '--tmp-overlay' && argv[i + 3] === to);
    const cargo = at(`${paths.store}/cargo`, '/tmp/home/.crossbind/cargo');
    const conan = at(`${paths.store}/conan`, '/tmp/home/.crossbind/conan-local');
    // After /tmp's own mount, or that mount would cover them.
    assert.ok(cargo > tmp && conan > tmp, JSON.stringify({ tmp, cargo, conan }));
});

test('refuses a list of imports the build did not write in its own shape', async () => {
    const missing = await compile(request, { paths, run: fakeRun(() => { writeOutputs(); fs.rmSync(importsFile()); }) });
    const broken = await compile(request, { paths, run: fakeRun(() => writeOutputs('{"natives": 1}')) });
    const notJson = await compile(request, { paths, run: fakeRun(() => writeOutputs('<')) });

    assert.deepEqual([missing.reason, broken.reason, notJson.reason], ['output', 'output', 'output']);
});

test('refuses names that are not identifiers, and paths or specifiers a page could not take as they are', async () => {
    const native = (fields) => ({ natives: [{ ...IMPORTS.natives[0], ...fields }] });
    const refused = [
        native({ names: [null] }),
        native({ names: [{}] }),
        native({ names: [{ local: 'answer' }] }),
        native({ names: [{ local: 'answer', wire: 1 }] }),
        native({ names: ['an-swer'] }),
        native({ names: ['__proto__'] }),
        native({ file: "src/native/x.h'</script>" }),
        native({ specifiers: ["x'); alert(1); //"] }),
    ];
    const reasons = [];

    for (const imports of refused) {
        reasons.push((await compile(request, { paths, run: fakeRun(() => writeOutputs(imports)) })).reason);
    }

    assert.deepEqual(reasons, refused.map(() => 'output'));
});

test('passes on only the fields of the list it knows', async () => {
    const imports = '{"natives": [{"file": "src/native/native.h", "specifiers": ["cargo:uuid"], "extra": 1,'
        + ' "names": [{"local": "Uuid", "wire": "uuid_Uuid", "__proto__": {"polluted": true}, "extra": 1}]}], "extra": 1}';

    const result = await compile(request, { paths, run: fakeRun(() => writeOutputs(imports)) });

    assert.deepEqual(result.imports, { natives: [{ file: 'src/native/native.h', specifiers: ['cargo:uuid'], names: [{ local: 'Uuid', wire: 'uuid_Uuid' }] }] });
});

test('removes the workspace afterwards, so no one\'s sources outlive their compile', async () => {
    await compile(request,{ paths, run: fakeRun(writeOutputs) });

    assert.equal(fs.existsSync(paths.work), false);
    assert.equal(fs.readFileSync(`${paths.template}/src/native/native.h`, 'utf8'), '// sample');
});

test('reports a failed build with its log, workspace paths shortened to the file names', async () => {
    const result = await compile(request,{
        paths,
        run: fakeRun(() => {}, { code: 1, output: `${paths.work}/src/native/native.cpp:1:5: error: expected ';'\n` }),
    });

    assert.deepEqual(result, { ok: false, reason: 'compile', log: "native.cpp:1:5: error: expected ';'" });
});

test('keeps the separator where CMake names an object file after its source path', async () => {
    const result = await compile(request,{
        paths,
        run: fakeRun(() => {}, {
            code: 1,
            output: `Building CXX object CMakeFiles/playground.dir${paths.work}/src/native/native.cpp.o\nBuilding CXX object CMakeFiles/playground.dir${paths.cli}/node_modules/crossbind/src/empty.cpp.o\n`,
        }),
    });

    assert.equal(result.log, 'Building CXX object CMakeFiles/playground.dir/native.cpp.o\nBuilding CXX object CMakeFiles/playground.dir/crossbind/src/empty.cpp.o');
});

test('reports a build that ran out of time', async () => {
    const result = await compile(request,{ paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', timedOut: true }) });

    assert.equal(result.reason, 'timeout');
});

test('never reads through a link the build left at an output path', async () => {
    const result = await compile(request,{
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

    const result = await compile(request,{
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
    const fifo = await compile(request,{
        paths,
        run: fakeRun(() => {
            writeOutputs();
            fs.rmSync(output('wasm'));
            execFileSync('mkfifo', [output('wasm')]);
        }),
    });
    const large = await compile(request,{ paths, run: fakeRun(writeOutputs), outputLimits: { js: 4, wasm: 1024 } });

    assert.equal(fifo.reason, 'output');
    assert.equal(large.reason, 'output');
});

test('clears a tree deeper than a path can name, with a folder it may not enter at the bottom', async () => {
    await compile(request,{
        paths,
        run: fakeRun(() => {
            writeOutputs();
            execFileSync('sh', ['-c', 'i=0; while [ $i -lt 600 ]; do mkdir d && cd d || exit 1; i=$((i+1)); done; mkdir locked && chmod 000 locked .'], { cwd: paths.work });
        }),
    });

    assert.equal(fs.existsSync(paths.work), false);
});

test('reports a build stopped for flooding its output or for the machine running low on memory', async () => {
    const flooded = await compile(request,{ paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', flooded: true }) });
    const outOfMemory = await compile(request,{ paths, run: fakeRun(() => {}, { code: null, signal: 'SIGKILL', outOfMemory: true }) });

    assert.deepEqual([flooded.reason, outOfMemory.reason], ['output', 'memory']);
});

test('clears a workspace the build left with folders it may not enter', async () => {
    await compile(request,{
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
