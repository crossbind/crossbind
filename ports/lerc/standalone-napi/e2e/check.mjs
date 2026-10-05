import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    initNative, lerc_computeCompressedSize, lerc_encode, lerc_decode, LERC_VERSION_MAJOR, LERC_VERSION_MINOR,
    LERC_VERSION_PATCH, AllSymbols, DataType,
} from '@crossbind/port-lerc-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the raster from the input, since a
// maximum error of 0 makes the round trip lossless.
const COLUMNS = 4;
const ROWS = 3;
const LOSSLESS = 0;
const { allocBuffer, writeBuffer, readBuffer, readNumberAt } = AllSymbols;
const raster = Buffer.from(Float32Array.from({ length: COLUMNS * ROWS }, (_, index) => index * 1.5 - 4).buffer);
const type = DataType.dt_float.value;

const input = allocBuffer(raster.length);
writeBuffer(input, raster);
const sizeCell = allocBuffer(4);
assert.equal(lerc_computeCompressedSize(input, type, 1, COLUMNS, ROWS, 1, 0, null, LOSSLESS, sizeCell), 0);
const capacity = readNumberAt(sizeCell, 0, 'uint32');
const blob = allocBuffer(capacity);
const writtenCell = allocBuffer(4);
assert.equal(lerc_encode(input, type, 1, COLUMNS, ROWS, 1, 0, null, LOSSLESS, blob, capacity, writtenCell), 0);
const output = allocBuffer(raster.length);
assert.equal(lerc_decode(blob, readNumberAt(writtenCell, 0, 'uint32'), 0, null, 1, COLUMNS, ROWS, 1, type, output), 0);
assert.deepEqual(Buffer.from(readBuffer(output, raster.length)), raster);

const version = `${LERC_VERSION_MAJOR}.${LERC_VERSION_MINOR}.${LERC_VERSION_PATCH}`;
assert.equal(version, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-lerc-standalone-napi').lerc_encode, lerc_encode);
console.log(`ok: lerc ${version} on ${process.platform}-${process.arch}`);
