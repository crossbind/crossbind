import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    initNative, jpeg_compress_struct, jpeg_decompress_struct, jpeg_error_mgr, jpeg_mem_dest, jpeg_mem_src,
    jpeg_set_defaults, jpeg_set_quality, jpeg_start_compress, jpeg_write_scanlines, jpeg_finish_compress,
    jpeg_destroy_compress, jpeg_read_header, jpeg_start_decompress, jpeg_read_scanlines, jpeg_finish_decompress,
    jpeg_destroy_decompress, J_COLOR_SPACE, JPEG_HEADER_OK, AllSymbols, jpeg_throwing_error,
    jpeg_create_compress_struct, jpeg_create_decompress_struct, LIBJPEG_TURBO_VERSION_NUMBER,
} from '@crossbind/port-jpegturbo-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the pixels from the input, since quality 100
// keeps a flat image exact, the start and end markers from the JPEG format, and the error text from the bytes given.
const SIZE = 8;
const GRAY = 100;
const QUALITY = 100;
const TRUE = 1;
const { allocBuffer, allocPointer, writeBuffer, readBuffer, readPointerAt, writePointerAt, readNumberAt } = AllSymbols;

// The err field keeps only the error manager's address, so the record holds its handle beside the struct.
const throwingStruct = (Struct, create) => {
    const errors = new jpeg_error_mgr();
    const info = new Struct();
    info.err = jpeg_throwing_error(errors);
    create(info);
    return { info, errors };
};
const memorySource = (bytes) => {
    const decoder = throwingStruct(jpeg_decompress_struct, jpeg_create_decompress_struct);
    const input = allocBuffer(bytes.length);
    writeBuffer(input, bytes);
    jpeg_mem_src(decoder.info, input, bytes.length);
    return { ...decoder, input };
};

const encoder = throwingStruct(jpeg_compress_struct, jpeg_create_compress_struct);
const outputSlot = allocPointer(1);
// An unsigned long: 8 bytes, or 4 on Windows, whose value starts the cell on these little-endian targets either way.
const outputSize = allocBuffer(8);
jpeg_mem_dest(encoder.info, outputSlot, outputSize);
encoder.info.image_width = SIZE;
encoder.info.image_height = SIZE;
encoder.info.input_components = 1;
encoder.info.in_color_space = J_COLOR_SPACE.JCS_GRAYSCALE;
jpeg_set_defaults(encoder.info);
jpeg_set_quality(encoder.info, QUALITY, TRUE);
jpeg_start_compress(encoder.info, TRUE);
const row = allocBuffer(SIZE);
writeBuffer(row, Buffer.alloc(SIZE, GRAY));
const rows = allocPointer(SIZE);
Array.from({ length: SIZE }, (_, index) => writePointerAt(rows, index, row));
assert.equal(jpeg_write_scanlines(encoder.info, rows, SIZE), SIZE);
jpeg_finish_compress(encoder.info);
const jpeg = Buffer.from(readBuffer(readPointerAt(outputSlot, 0), readNumberAt(outputSize, 0, 'uint32')));
jpeg_destroy_compress(encoder.info);
assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
assert.equal(jpeg.subarray(-2).toString('hex'), 'ffd9');

const decoder = memorySource(jpeg);
assert.equal(jpeg_read_header(decoder.info, TRUE), JPEG_HEADER_OK);
jpeg_start_decompress(decoder.info);
assert.deepEqual([decoder.info.output_width, decoder.info.output_height, decoder.info.output_components], [SIZE, SIZE, 1]);
const line = allocBuffer(SIZE);
const lines = allocPointer(1);
writePointerAt(lines, 0, line);
const decoded = Array.from({ length: SIZE }, () => {
    assert.equal(jpeg_read_scanlines(decoder.info, lines, 1), 1);
    return [...readBuffer(line, SIZE)];
}).flat();
assert.deepEqual(decoded, Array(SIZE * SIZE).fill(GRAY));
jpeg_finish_decompress(decoder.info);
jpeg_destroy_decompress(decoder.info);

const junk = Buffer.from('not a jpeg file!');
const broken = memorySource(junk);
const hex = (byte) => `0x${byte.toString(16).padStart(2, '0')}`;
assert.throws(() => jpeg_read_header(broken.info, TRUE), { message: `Not a JPEG file: starts with ${hex(junk[0])} ${hex(junk[1])}` });
jpeg_destroy_decompress(broken.info);

const versionNumber = LIBJPEG_TURBO_VERSION_NUMBER;
const version = `${Math.floor(versionNumber / 1e6)}.${Math.floor(versionNumber / 1e3) % 1e3}.${versionNumber % 1e3}`;
assert.equal(version, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-jpegturbo-standalone-napi').jpeg_read_header, jpeg_read_header);
console.log(`ok: libjpeg-turbo ${version} on ${process.platform}-${process.arch}`);
