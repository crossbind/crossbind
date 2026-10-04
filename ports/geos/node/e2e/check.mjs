import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    GEOSversion, GEOS_init_r, GEOS_finish_r, GEOSGeomFromWKT_r, GEOSGeomToWKT_r, GEOSArea_r, GEOSBuffer_r,
    GEOSGeom_destroy_r, GEOSFree_r, AllSymbols,
} from '@crossbind/port-geos-node/geos_c.h';

// The expected values come from elsewhere: the version from package.json, the areas from geometry.
const QUADRANT_SEGMENTS = 8;
const { allocBuffer, readNumberAt, readCString } = AllSymbols;

const context = GEOS_init_r();
const areaOf = (geometry) => {
    const area = allocBuffer(8);
    assert.equal(GEOSArea_r(context, geometry, area), 1);
    return readNumberAt(area, 0, 'float64');
};

const rectangle = GEOSGeomFromWKT_r(context, 'POLYGON ((0 0, 4 0, 4 3, 0 3, 0 0))');
const circle = GEOSBuffer_r(context, GEOSGeomFromWKT_r(context, 'POINT (0 0)'), 1, QUADRANT_SEGMENTS);
const sides = 4 * QUADRANT_SEGMENTS;
const wkt = GEOSGeomToWKT_r(context, rectangle);

assert.ok(GEOSversion().startsWith(`${process.env.NATIVE_VERSION}-CAPI-`));
assert.equal(areaOf(rectangle), 12);
assert.ok(Math.abs(areaOf(circle) - (sides / 2) * Math.sin((2 * Math.PI) / sides)) < 1e-12);
assert.match(readCString(wkt), /^POLYGON \(\(0(\.0+)? 0(\.0+)?, 4/);
assert.equal(createRequire(import.meta.url)('@crossbind/port-geos-node/geos_c.h').GEOSversion, GEOSversion);

GEOSFree_r(context, wkt);
GEOSGeom_destroy_r(context, rectangle);
GEOSGeom_destroy_r(context, circle);
GEOS_finish_r(context);
console.log(`ok: geos ${GEOSversion()} on ${process.platform}-${process.arch}`);
