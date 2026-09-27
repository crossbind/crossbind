export const title = 'Test points against a prepared polygon';
export const summary = 'Point in polygon is the most common spatial question. GEOSPrepare_r indexes the polygon once; GEOSPreparedContainsXY_r and GEOSPreparedIntersectsXY_r then answer per point and differ only on the boundary, and GEOSPreparedRelate_r gives the full DE-9IM matrix.';
export const native = 'zone.h';
export const expected = [
    '2 2: contains true, intersects true',
    '5 5: contains false, intersects false',
    '10 5: contains false, intersects true',
    '12 5: contains false, intersects false',
    '212101212',
];

export default async function example({ Zone }, console) {
    const zone = await new Zone('POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (4 4, 6 4, 6 6, 4 6, 4 4))');
    const points = [[2, 2], [5, 5], [10, 5], [12, 5]]; // inside, in the hole, on the edge, outside
    for (const [x, y] of points) {
        console.log(`${x} ${y}: contains ${await zone.contains(x, y)}, intersects ${await zone.intersects(x, y)}`);
    }
    console.log(await zone.relate('POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))'));
}
