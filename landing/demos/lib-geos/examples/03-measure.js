export const title = 'Measure area, length and distance';
export const summary = 'GEOSArea_r, GEOSLength_r and GEOSDistance_r in the units of the coordinates, GEOSNearestPoints_r for where two shapes come closest, and GEOSGetCentroid_r. GEOS works in the plane, so project longitude and latitude before measuring.';
export const native = 'measure.h';
export const expected = ['1200 140 60', '15 LINESTRING (40 30, 52 39)', 'POINT (20 15)'];

export default async function example({ Measure }, console) {
    const field = 'POLYGON ((0 0, 40 0, 40 30, 0 30, 0 0))';
    const well = 'POINT (52 39)';
    const track = 'LINESTRING (0 0, 30 40, 30 50)';
    console.log(await Measure.area(field), await Measure.lengthOf(field), await Measure.lengthOf(track));
    console.log(await Measure.distance(field, well), await Measure.nearestPoints(field, well));
    console.log(await Measure.centroid(field));
}
