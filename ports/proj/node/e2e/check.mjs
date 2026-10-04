import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
    proj_info, proj_context_create, proj_context_destroy, proj_context_errno, proj_create_crs_to_crs,
    proj_normalize_for_visualization, proj_trans_generic, proj_destroy, PJ_DIRECTION, AllSymbols,
} from '@crossbind/port-proj-node/proj.h';

// The expected values come from elsewhere: the version from package.json, the coordinate from the Mercator formula.
// EPSG codes resolve through proj.db, so the package's data directory must reach the addon.
const WGS84_RADIUS = 6378137;
const LATITUDE = 45;
const DOUBLE_BYTES = 8;
const { allocBuffer, readNumberAt, writeNumberAt } = AllSymbols;

const cellOf = (value) => {
    const cell = allocBuffer(DOUBLE_BYTES);
    writeNumberAt(cell, 0, 'float64', value);
    return cell;
};

const context = proj_context_create();
const crsToCrs = proj_create_crs_to_crs(context, 'EPSG:4326', 'EPSG:3857', null);
assert.ok(crsToCrs, `proj_create_crs_to_crs failed with errno ${proj_context_errno(context)}`);
const lonLat = proj_normalize_for_visualization(context, crsToCrs);
const [x, y] = [cellOf(0), cellOf(LATITUDE)];
assert.equal(Number(proj_trans_generic(lonLat, PJ_DIRECTION.PJ_FWD, x, DOUBLE_BYTES, 1, y, DOUBLE_BYTES, 1, null, 0, 0, null, 0, 0)), 1);
const expectedY = WGS84_RADIUS * Math.log(Math.tan(Math.PI / 4 + (LATITUDE * Math.PI) / 360));
assert.ok(Math.abs(readNumberAt(y, 0, 'float64') - expectedY) < 1e-6);
assert.equal(readNumberAt(x, 0, 'float64'), 0);

[lonLat, crsToCrs].forEach((transformation) => proj_destroy(transformation));
proj_context_destroy(context);

const { major, minor, patch } = proj_info();
assert.equal(`${major}.${minor}.${patch}`, process.env.NATIVE_VERSION);
assert.equal(createRequire(import.meta.url)('@crossbind/port-proj-node/proj.h').proj_info, proj_info);
console.log(`ok: proj ${major}.${minor}.${patch} on ${process.platform}-${process.arch}`);
