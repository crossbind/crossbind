import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    iconv_open, iconv, iconv_close, _LIBICONV_VERSION, AllSymbols,
} from '@crossbind/port-iconv-node/iconv.h';

// The expected values come from elsewhere: the version from package.json, the UTF-16 bytes from Node's own encoder.
const { allocBuffer, allocPointer, writeBuffer, readBuffer, writePointerAt, readNumberAt, writeNumberAt } = AllSymbols;
const TEXT = 'ğüşİçö crossbind';
const input = Buffer.from(TEXT, 'utf8');
const outputCapacity = input.length * 4;

const bufferOf = (bytes) => {
    const buffer = allocBuffer(bytes.length);
    writeBuffer(buffer, bytes);
    return buffer;
};
const pointerTo = (buffer) => {
    const slot = allocPointer(1);
    writePointerAt(slot, 0, buffer);
    return slot;
};
const sizeOf = (value) => {
    const cell = allocBuffer(8);
    writeNumberAt(cell, 0, 'uint64', value);
    return cell;
};

const converter = iconv_open('UTF-16LE', 'UTF-8');
const output = allocBuffer(outputCapacity);
const inputLeft = sizeOf(input.length);
const outputLeft = sizeOf(outputCapacity);
assert.equal(Number(iconv(converter, pointerTo(bufferOf(input)), inputLeft, pointerTo(output), outputLeft)), 0);
assert.equal(Number(readNumberAt(inputLeft, 0, 'uint64')), 0);
const written = outputCapacity - Number(readNumberAt(outputLeft, 0, 'uint64'));
assert.deepEqual(Buffer.from(readBuffer(output, written)), Buffer.from(TEXT, 'utf16le'));
assert.equal(iconv_close(converter), 0);

const version = `${_LIBICONV_VERSION >> 8}.${_LIBICONV_VERSION & 0xff}`;
assert.equal(version, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-iconv-node/iconv.h').iconv_open, iconv_open);
console.log(`ok: libiconv ${version} on ${process.platform}-${process.arch}`);
