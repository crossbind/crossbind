import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest, InvalidRequest, MAX_SOURCE_BYTES } from '../compiler/validate.js';

test('returns the header and the source, the source empty when it was left out', () => {
    assert.deepEqual(validateRequest({ files: { 'native.h': 'int f();' } }), { 'native.h': 'int f();', 'native.cpp': '' });
    assert.deepEqual(
        validateRequest({ files: { 'native.cpp': 'int f() { return 1; }', 'native.h': 'int f();' } }),
        { 'native.h': 'int f();', 'native.cpp': 'int f() { return 1; }' },
    );
});

test('refuses every other file name, so nothing but the two sources reaches the workspace', () => {
    ['../native.h', 'CMakeLists.txt', 'crossbind.config.js', 'native.H', 'native.hpp', '__proto__'].forEach((name) => {
        assert.throws(() => validateRequest({ files: { 'native.h': '', [name]: '' } }), InvalidRequest, name);
    });
});

test('needs the header, since crossbind binds what the header declares', () => {
    assert.throws(() => validateRequest({ files: { 'native.cpp': '' } }), /native\.h is missing/);
});

test('refuses anything but an object that holds files alone', () => {
    [null, [], 'files', { files: [] }, { files: null }, { files: { 'native.h': '' }, flags: ['-O3'] }].forEach((body) => {
        assert.throws(() => validateRequest(body), InvalidRequest, JSON.stringify(body));
    });
});

test('refuses a file that is not text', () => {
    assert.throws(() => validateRequest({ files: { 'native.h': 1 } }), /must be text/);
    assert.throws(() => validateRequest({ files: { 'native.h': 'int\0f();' } }), /must be text/);
});

test('counts the size limit in UTF-8 bytes over both files', () => {
    const half = 'ğ'.repeat(MAX_SOURCE_BYTES / 4);

    assert.doesNotThrow(() => validateRequest({ files: { 'native.h': half, 'native.cpp': half } }));
    assert.throws(() => validateRequest({ files: { 'native.h': half, 'native.cpp': `${half}x` } }), /limit is 32768/);
});
