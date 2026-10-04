import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import {
    ZSTD_versionString, ZSTD_compressBound, ZSTD_compress, ZSTD_decompress, ZSTD_isError, ZSTD_CLEVEL_DEFAULT, AllSymbols,
} from '@crossbind/port-zstd-node/zstd.h';

// The expected values come from elsewhere: the version from package.json, the frames from Node's own zstd.
const { allocBuffer, writeBuffer, readBuffer } = AllSymbols;
const text = Buffer.from('hello crossbind '.repeat(20));
const bufferOf = (bytes) => {
    const buffer = allocBuffer(bytes.length);
    writeBuffer(buffer, bytes);
    return buffer;
};

const capacity = Number(ZSTD_compressBound(text.length));
const compressed = allocBuffer(capacity);
const compressedSize = ZSTD_compress(compressed, capacity, bufferOf(text), text.length, ZSTD_CLEVEL_DEFAULT);
assert.equal(ZSTD_isError(compressedSize), 0);
assert.deepEqual(zstdDecompressSync(Buffer.from(readBuffer(compressed, Number(compressedSize)))), text);

const frame = zstdCompressSync(text);
const decompressed = allocBuffer(text.length);
const decompressedSize = ZSTD_decompress(decompressed, text.length, bufferOf(frame), frame.length);
assert.deepEqual(Buffer.from(readBuffer(decompressed, Number(decompressedSize))), text);

assert.equal(ZSTD_versionString(), process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-zstd-node/zstd.h').ZSTD_compress, ZSTD_compress);
console.log(`ok: zstd ${ZSTD_versionString()} on ${process.platform}-${process.arch}`);
