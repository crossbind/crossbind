import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    initNative, GDALAllRegister, GDALVersionInfo, GDALGetDriverByName, GDALCreate, GDALOpen, GDALClose,
    GDALGetRasterXSize, GDALGetRasterYSize, GDALGetRasterBand, GDALDataType, GDALAccess, AllSymbols, GDALChecksumImage,
    OGR_G_CreateGeometryFromJson, OGR_G_Area, OGR_G_Buffer, OGR_G_DestroyGeometry, OSRNewSpatialReference,
    OSRImportFromEPSG, OSRSetAxisMappingStrategy, OSRAxisMappingStrategy, OSRDestroySpatialReference,
    OCTNewCoordinateTransformation, OCTTransform, OCTDestroyCoordinateTransformation, CPLFindFile, VSIUnlink,
} from '@crossbind/port-gdal-standalone-napi';

await initNative();

// The expected values come from elsewhere: the version from package.json, the coordinates and areas from their formulas.
// EPSG codes resolve through proj.db and gdalvrt.xsd through GDAL_DATA, so both data directories must reach the addon.
const WGS84_RADIUS = 6378137;
const LATITUDE = 45;
const QUADRANT_SEGMENTS = 8;
const RASTER = '/vsimem/check.tif';
const { allocBuffer, readNumberAt, writeNumberAt } = AllSymbols;

GDALAllRegister();
assert.equal(GDALVersionInfo('RELEASE_NAME'), process.env.NATIVE_VERSION);
assert.ok(GDALGetDriverByName('GTiff') && GDALGetDriverByName('GPKG'));
assert.match(CPLFindFile('gdal', 'gdalvrt.xsd'), /gdalvrt\.xsd$/);

const wgs84 = OSRNewSpatialReference(null);
const webMercator = OSRNewSpatialReference(null);
assert.equal(OSRImportFromEPSG(wgs84, 4326), 0);
assert.equal(OSRImportFromEPSG(webMercator, 3857), 0);
[wgs84, webMercator].forEach((srs) => OSRSetAxisMappingStrategy(srs, OSRAxisMappingStrategy.OAMS_TRADITIONAL_GIS_ORDER));
const transform = OCTNewCoordinateTransformation(wgs84, webMercator);
const [x, y, z] = [0, LATITUDE, 0].map((value) => {
    const cell = allocBuffer(8);
    writeNumberAt(cell, 0, 'float64', value);
    return cell;
});
assert.equal(OCTTransform(transform, 1, x, y, z), 1);
const expectedY = WGS84_RADIUS * Math.log(Math.tan(Math.PI / 4 + (LATITUDE * Math.PI) / 360));
assert.ok(Math.abs(readNumberAt(y, 0, 'float64') - expectedY) < 1e-6);

const rectangle = OGR_G_CreateGeometryFromJson('{"type":"Polygon","coordinates":[[[0,0],[4,0],[4,3],[0,3],[0,0]]]}');
const circle = OGR_G_Buffer(OGR_G_CreateGeometryFromJson('{"type":"Point","coordinates":[0,0]}'), 1, QUADRANT_SEGMENTS);
const sides = 4 * QUADRANT_SEGMENTS;
assert.equal(OGR_G_Area(rectangle), 12);
assert.ok(Math.abs(OGR_G_Area(circle) - (sides / 2) * Math.sin((2 * Math.PI) / sides)) < 1e-12);

GDALClose(GDALCreate(GDALGetDriverByName('GTiff'), RASTER, 4, 3, 1, GDALDataType.GDT_UInt8, null));
const raster = GDALOpen(RASTER, GDALAccess.GA_ReadOnly);
assert.deepEqual([GDALGetRasterXSize(raster), GDALGetRasterYSize(raster)], [4, 3]);
assert.equal(GDALChecksumImage(GDALGetRasterBand(raster, 1), 0, 0, 4, 3), 0);
assert.equal(createRequire(import.meta.url)('@crossbind/port-gdal-standalone-napi').GDALOpen, GDALOpen);

GDALClose(raster);
VSIUnlink(RASTER);
[rectangle, circle].forEach((geometry) => OGR_G_DestroyGeometry(geometry));
OCTDestroyCoordinateTransformation(transform);
[wgs84, webMercator].forEach((srs) => OSRDestroySpatialReference(srs));
console.log(`ok: gdal ${GDALVersionInfo('RELEASE_NAME')} on ${process.platform}-${process.arch}`);
