import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { crc32 as nodeCrc32 } from 'node:zlib';
import {
    zlibVersion, ZLIB_VERSION, Z_OK, crc32, AllSymbols,
} from '@crossbind/port-zlib-node/zlib.h';

// The expected values come from elsewhere: the version from package.json, the checksum from Node's own zlib.
const text = 'hello crossbind';
const bytes = Buffer.from(text);
const buffer = AllSymbols.allocBuffer(bytes.length);
AllSymbols.writeBuffer(buffer, bytes);

assert.equal(zlibVersion(), process.env.NATIVE_VERSION);
assert.equal(ZLIB_VERSION, process.env.NATIVE_VERSION);
assert.equal(Z_OK, 0);
assert.equal(Number(crc32(0, buffer, bytes.length)), nodeCrc32(text));
assert.equal(createRequire(import.meta.url)('@crossbind/port-zlib-node/zlib.h').zlibVersion, zlibVersion);
console.log(`ok: zlib ${zlibVersion()} on ${process.platform}-${process.arch}`);
