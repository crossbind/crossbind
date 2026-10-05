import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    initNative, WebPGetDecoderVersion, WebPGetInfo, WebPDecodeRGBA, AllSymbols, WebPEncodeLosslessRGBA, WebPFree,
} from '@crossbind/port-webp-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the pixels from the input, since a lossless
// round trip returns them unchanged, and the RIFF/WEBP signature from the container format.
const WIDTH = 2;
const HEIGHT = 2;
const { allocBuffer, allocPointer, writeBuffer, readBuffer, readPointerAt, readNumberAt } = AllSymbols;
const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 128]);

const rgba = allocBuffer(pixels.length);
writeBuffer(rgba, pixels);
const encodedSlot = allocPointer(1);
const size = WebPEncodeLosslessRGBA(rgba, WIDTH, HEIGHT, WIDTH * 4, encodedSlot);
const encoded = readPointerAt(encodedSlot, 0);
const container = Buffer.from(readBuffer(encoded, Number(size)));
assert.equal(container.toString('latin1', 0, 4), 'RIFF');
assert.equal(container.toString('latin1', 8, 12), 'WEBP');

const [width, height] = [allocBuffer(4), allocBuffer(4)];
assert.equal(WebPGetInfo(encoded, size, width, height), 1);
assert.deepEqual([readNumberAt(width, 0, 'int32'), readNumberAt(height, 0, 'int32')], [WIDTH, HEIGHT]);
const decoded = WebPDecodeRGBA(encoded, size, width, height);
assert.deepEqual(Buffer.from(readBuffer(decoded, pixels.length)), pixels);
WebPFree(decoded);
WebPFree(encoded);

const version = WebPGetDecoderVersion();
const versionText = `${version >> 16}.${(version >> 8) & 0xff}.${version & 0xff}`;
assert.equal(versionText, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-webp-standalone-napi').WebPDecodeRGBA, WebPDecodeRGBA);
console.log(`ok: webp ${versionText} on ${process.platform}-${process.arch}`);
