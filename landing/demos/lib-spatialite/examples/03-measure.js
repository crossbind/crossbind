export const title = 'Measure areas and distances in metres';
export const summary =
    'SpatiaLite measures in the units of the coordinates, so `ST_Area` of a longitude/latitude polygon comes out in square degrees. `ST_Transform` to a projected CRS, here UTM zone 35N (EPSG:32635), gives square metres and metres, stretched the further a shape lies from the zone; `ST_Distance(a, b, 1)` measures on the ellipsoid with no projection at all.';
export const native = 'measure.h';
export const expected = ['0.000200 square degrees, 1868349 m²', '350462 m in UTM zone 35N, 350082 m on the ellipsoid'];

export default async function example({ Measure }, console) {
    const measure = await new Measure();
    const block = 'POLYGON((28.97 41.00, 28.99 41.00, 28.99 41.01, 28.97 41.01, 28.97 41.00))';
    console.log(`${(await measure.area(block, 4326)).toFixed(6)} square degrees, ${Math.round(await measure.area(block, 32635))} m²`);
    const istanbul = 'POINT(28.9784 41.0082)';
    const ankara = 'POINT(32.8597 39.9334)';
    const projected = await measure.distance(istanbul, ankara, 32635);
    const geodesic = await measure.geodesicDistance(istanbul, ankara);
    console.log(`${Math.round(projected)} m in UTM zone 35N, ${Math.round(geodesic)} m on the ellipsoid`);
}
