import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
    initNative, XTIFFOpen, XTIFFClose, GTIFNew, GTIFFree, GTIFWriteKeys, GTIFKeyGetSHORT, GTIFKeyGetASCII,
    LIBGEOTIFF_VERSION, AllSymbols, GTIFKeySetShort, GTIFKeySetAscii, geokey_t, modeltype_t, geographic_t,
    TIFFWriteScanline, TIFFTAG_IMAGEWIDTH, TIFFTAG_IMAGELENGTH, TIFFTAG_BITSPERSAMPLE, TIFFTAG_SAMPLESPERPIXEL,
    TIFFTAG_ROWSPERSTRIP, TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK, TIFFSetFieldUInt16, TIFFSetFieldUInt32,
} from '@crossbind/port-geotiff-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the key ids, the model type and the EPSG code
// from the GeoTIFF specification, and the values read back from what was written.
const SIZE = 4;
const GT_MODEL_TYPE_GEO_KEY = 1024;
const GEOGRAPHIC_TYPE_GEO_KEY = 2048;
const GEOG_CITATION_GEO_KEY = 2049;
const MODEL_TYPE_GEOGRAPHIC = 2;
const EPSG_WGS84 = 4326;
const CITATION = 'WGS 84';
const { allocBuffer, readNumberAt, readCString } = AllSymbols;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'crossbind-geotiff-'));
const file = path.join(work, 'wgs84.tif');

try {
    const writer = XTIFFOpen(file, 'w');
    [[TIFFTAG_IMAGEWIDTH, SIZE], [TIFFTAG_IMAGELENGTH, SIZE], [TIFFTAG_ROWSPERSTRIP, SIZE]]
        .forEach(([tag, value]) => assert.equal(TIFFSetFieldUInt32(writer, tag, value), 1));
    [[TIFFTAG_BITSPERSAMPLE, 8], [TIFFTAG_SAMPLESPERPIXEL, 1], [TIFFTAG_PHOTOMETRIC, PHOTOMETRIC_MINISBLACK]]
        .forEach(([tag, value]) => assert.equal(TIFFSetFieldUInt16(writer, tag, value), 1));
    const row = allocBuffer(SIZE);
    Array.from({ length: SIZE }, (_, index) => assert.equal(TIFFWriteScanline(writer, row, index, 0), 1));
    const keysOut = GTIFNew(writer);
    assert.equal(GTIFKeySetShort(keysOut, geokey_t.GTModelTypeGeoKey, modeltype_t.ModelTypeGeographic.value), 1);
    assert.equal(GTIFKeySetShort(keysOut, geokey_t.GeographicTypeGeoKey, geographic_t.GCS_WGS_84.value), 1);
    assert.equal(GTIFKeySetAscii(keysOut, geokey_t.GeogCitationGeoKey, CITATION), 1);
    assert.equal(GTIFWriteKeys(keysOut), 1);
    GTIFFree(keysOut);
    XTIFFClose(writer);

    const reader = XTIFFOpen(file, 'r');
    const keysIn = GTIFNew(reader);
    const cell = allocBuffer(2);
    assert.equal(GTIFKeyGetSHORT(keysIn, GT_MODEL_TYPE_GEO_KEY, cell, 0, 1), 1);
    assert.equal(readNumberAt(cell, 0, 'uint16'), MODEL_TYPE_GEOGRAPHIC);
    assert.equal(GTIFKeyGetSHORT(keysIn, GEOGRAPHIC_TYPE_GEO_KEY, cell, 0, 1), 1);
    assert.equal(readNumberAt(cell, 0, 'uint16'), EPSG_WGS84);
    const text = allocBuffer(32);
    assert.equal(GTIFKeyGetASCII(keysIn, GEOG_CITATION_GEO_KEY, text, 32), CITATION.length + 1);
    assert.equal(readCString(text), CITATION);
    GTIFFree(keysIn);
    XTIFFClose(reader);
} finally {
    fs.rmSync(work, { recursive: true, force: true });
}

assert.deepEqual(
    [geokey_t.GTModelTypeGeoKey.value, geokey_t.GeographicTypeGeoKey.value, geokey_t.GeogCitationGeoKey.value],
    [GT_MODEL_TYPE_GEO_KEY, GEOGRAPHIC_TYPE_GEO_KEY, GEOG_CITATION_GEO_KEY],
);
assert.deepEqual([modeltype_t.ModelTypeGeographic.value, geographic_t.GCS_WGS_84.value], [MODEL_TYPE_GEOGRAPHIC, EPSG_WGS84]);
const version = `${Math.floor(LIBGEOTIFF_VERSION / 1000)}.${Math.floor(LIBGEOTIFF_VERSION / 100) % 10}.${Math.floor(LIBGEOTIFF_VERSION / 10) % 10}`;
assert.equal(version, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-geotiff-standalone-napi').GTIFNew, GTIFNew);
console.log(`ok: libgeotiff ${version} on ${process.platform}-${process.arch}`);
