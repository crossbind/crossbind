import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { deriveLicenseExpression } from '../../../core/crossbind/src/utils/licenseReport.js';
import { componentRows, includeDirsOf, swigPin } from '../scripts/build.mjs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

test('builds SWIG from the revision the web image pins, so the two cannot drift', () => {
    const pin = swigPin(read('../../docker/base.Dockerfile'));
    assert.match(pin.rev, /^[0-9a-f]{40}$/);
    assert.match(pin.sha256, /^[0-9a-f]{64}$/);
    assert.throws(() => swigPin('FROM os AS swig\n'), /pins no SWIG_REV and SWIG_SHA256/);
});

test("keeps em++'s include directories in its order, each where the package carries it", () => {
    const searchList = [
        '/emsdk/upstream/emscripten/cache/sysroot/include/fakesdl',
        '/emsdk/upstream/emscripten/cache/sysroot/include/compat',
        '/emsdk/upstream/emscripten/cache/sysroot/include/c++/v1',
        '/emsdk/upstream/lib/clang/24/include',
        '/emsdk/upstream/emscripten/cache/sysroot/include',
    ].join('\n');
    assert.deepEqual(includeDirsOf(`${searchList}\n`), [
        'emscripten/include/fakesdl',
        'emscripten/include/compat',
        'emscripten/include/c++/v1',
        'clang/include',
        'emscripten/include',
    ]);
    assert.throws(() => includeDirsOf('/usr/include'), /em\+\+ searches \/usr\/include, which bridge-tools does not carry/);
});

test("declares in package.json the license its components' rows derive", () => {
    const rows = componentRows({
        swig: { rev: 'a'.repeat(40), sha256: 'b'.repeat(64) },
        pcre2: { version: '10.46', url: 'https://example.com/pcre2.tar.gz', sha256: 'c'.repeat(64) },
        versions: { emscripten: '6.0.13', musl: '1.2.5', clang: '24' },
    });
    assert.equal(deriveLicenseExpression(rows), JSON.parse(read('../package.json')).license);
});
