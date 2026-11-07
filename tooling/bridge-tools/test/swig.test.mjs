import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { swig } from '../index.js';

// Runs against dist/, which scripts/build.mjs makes.
function scratch() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-tools-'));
    const write = (file, text) => {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
        return path.join(root, file);
    };
    write('empty/.keep', '');
    write('include/x.h', 'int fromInclude();\n');
    write('working/x.h', 'int fromWorkingDirectory();\n');
    const interfaceFile = write('x.i', '%module X\n%{\n#include "x.h"\n%}\n%include "x.h"\n');
    const run = (cwd, input = interfaceFile) => {
        const output = path.join(root, 'out', `${path.basename(cwd)}.cpp`);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        return { ...swig(['-c++', '-embind', '-o', output, `-I${path.join(root, 'include')}`, input], { cwd }), bridge: output };
    };
    return { root, write, run };
}

test("looks for a file in the working directory it is given first, as the image's swig does in the build directory", () => {
    const { root, run } = scratch();
    const inWorking = run(path.join(root, 'working'));
    const inEmpty = run(path.join(root, 'empty'));
    assert.equal(inWorking.status, 0);
    assert.match(fs.readFileSync(inWorking.bridge, 'utf8'), /fromWorkingDirectory/);
    assert.match(fs.readFileSync(inEmpty.bridge, 'utf8'), /fromInclude/);
    assert.throws(() => swig([], { cwd: 'build' }), /needs an absolute working directory/);
});

test("returns SWIG's output and exit code, leaving this process's environment and exit code alone", (t) => {
    const saved = { SWIG_LIB: process.env.SWIG_LIB, SWIG_FEATURES: process.env.SWIG_FEATURES };
    t.after(() =>
        Object.entries(saved).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }),
    );
    // SWIG would fail on either, had it read this process's environment.
    process.env.SWIG_LIB = '/nonexistent';
    process.env.SWIG_FEATURES = '-no-such-option';
    const { root, run } = scratch();

    const passing = run(path.join(root, 'empty'));
    const failing = run(path.join(root, 'empty'), path.join(root, 'missing.i'));

    assert.equal(passing.status, 0);
    assert.match(passing.output, /Warning 524: Experimental target language/);
    assert.equal(failing.status, 1);
    assert.match(failing.output, /Unable to find file '.*missing\.i'/);
    assert.equal(process.exitCode, undefined);
    assert.deepEqual([process.env.SWIG_LIB, process.env.SWIG_FEATURES], ['/nonexistent', '-no-such-option']);
});

test('throws when SWIG crashes, printing nothing, and the next call runs a new SWIG', (t) => {
    const consoleError = t.mock.method(console, 'error');
    const { root, write, run } = scratch();
    // SWIG's preprocessor recurses into each parenthesis until the stack overflows.
    const nested = write('nested.i', `%module X\n#if ${'('.repeat(100_000)}1${')'.repeat(100_000)}\n#endif\n`);

    assert.throws(
        () => run(path.join(root, 'empty'), nested),
        (error) => /SWIG crashed/.test(error.message) && error.cause instanceof WebAssembly.RuntimeError && typeof error.output === 'string',
    );
    assert.equal(consoleError.mock.callCount(), 0);
    assert.equal(run(path.join(root, 'empty')).status, 0);
});
