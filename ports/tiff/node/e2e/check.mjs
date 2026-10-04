import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
    TIFFGetVersion, TIFFOpen, TIFFClose, TIFFWriteScanline, TIFFReadScanline, AllSymbols,
} from '@crossbind/port-tiff-node/tiffio.h';
import {
    TIFFTAG_IMAGEWIDTH, TIFFTAG_IMAGELENGTH, TIFFTAG_BITSPERSAMPLE, TIFFTAG_SAMPLESPERPIXEL, TIFFTAG_PHOTOMETRIC,
    TIFFTAG_PLANARCONFIG, TIFFTAG_ROWSPERSTRIP, PHOTOMETRIC_MINISBLACK, PLANARCONFIG_CONTIG,
} from '@crossbind/port-tiff-node/tiff.h';
import { TIFFSetFieldUInt16, TIFFSetFieldUInt32, TIFFGetFieldUInt32 } from '@crossbind/port-tiff-node/tiffio_crossbind.h';

// The expected values come from elsewhere: the version from package.json, the pixels and size from what was written,
// and the byte order mark from the TIFF format.
const WIDTH = 4;
const HEIGHT = 3;
const { allocBuffer, writeBuffer, readBuffer, readNumberAt } = AllSymbols;
const rows = Array.from({ length: HEIGHT }, (_, row) => Buffer.from(Array.from({ length: WIDTH }, (__, column) => row * 10 + column)));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-tiff-'));
const file = path.join(work, 'gray.tif');

try {
    const writer = TIFFOpen(file, 'w');
    [[TIFFTAG_IMAGEWIDTH, WIDTH], [TIFFTAG_IMAGELENGTH, HEIGHT], [TIFFTAG_ROWSPERSTRIP, HEIGHT]]
        .forEach(([tag, value]) => assert.equal(TIFFSetFieldUInt32(writer, tag, value), 1));
    [[TIFFTAG_BITSPERSAMPLE, 8], [TIFFTAG_SAMPLESPERPIXEL, 1], [TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK], [TIFFTAG_PLANARCONFIG, PLANARCONFIG_CONTIG]]
        .forEach(([tag, value]) => assert.equal(TIFFSetFieldUInt16(writer, tag, value), 1));
    rows.forEach((row, index) => {
        const buffer = allocBuffer(WIDTH);
        writeBuffer(buffer, row);
        assert.equal(TIFFWriteScanline(writer, buffer, index, 0), 1);
    });
    TIFFClose(writer);
    assert.ok(['II*\0', 'MM\0*'].includes(fs.readFileSync(file).toString('latin1', 0, 4)));

    const reader = TIFFOpen(file, 'r');
    const width = allocBuffer(4);
    assert.equal(TIFFGetFieldUInt32(reader, TIFFTAG_IMAGEWIDTH, width), 1);
    assert.equal(readNumberAt(width, 0, 'uint32'), WIDTH);
    const row = allocBuffer(WIDTH);
    assert.equal(TIFFReadScanline(reader, row, HEIGHT - 1, 0), 1);
    assert.deepEqual(Buffer.from(readBuffer(row, WIDTH)), rows[HEIGHT - 1]);
    TIFFClose(reader);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}

assert.match(TIFFGetVersion(), new RegExp(`^LIBTIFF, Version ${process.env.NATIVE_VERSION.replaceAll('.', '\\.')}\\b`));
assert.equal(createRequire(import.meta.url)('@crossbind/port-tiff-node/tiffio.h').TIFFOpen, TIFFOpen);
console.log(`ok: libtiff ${process.env.NATIVE_VERSION} on ${process.platform}-${process.arch}`);
