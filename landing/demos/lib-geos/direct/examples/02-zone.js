export const imports = {
    '@crossbind/port-geos/geos_c.h': [
        'GEOS_init_r',
        'GEOS_finish_r',
        'GEOSWKTReader_create_r',
        'GEOSWKTReader_read_r',
        'GEOSWKTReader_destroy_r',
        'GEOSPrepare_r',
        'GEOSPreparedContainsXY_r',
        'GEOSPreparedIntersectsXY_r',
        'GEOSPreparedRelate_r',
        'GEOSPreparedGeom_destroy_r',
        'GEOSGeom_destroy_r',
        'GEOSFree_r',
        'readCString',
    ],
};
export const note = 'The prepared geometry and the `XY` predicates work as they are. Each predicate returns a C `char`, which arrives as the number 1, 0 or 2 (GEOS failed), so JavaScript turns it into a boolean itself. The DE-9IM matrix is a `char *` to read with `readCString` and return to `GEOSFree_r`, and the prepared geometry is destroyed before the polygon it indexes.';
export const expected = [
    '2 2: contains true, intersects true',
    '5 5: contains false, intersects false',
    '10 5: contains false, intersects true',
    '12 5: contains false, intersects false',
    '212101212',
];

export default async function example({ GEOS_init_r, GEOS_finish_r, GEOSWKTReader_create_r, GEOSWKTReader_read_r, GEOSWKTReader_destroy_r, GEOSPrepare_r, GEOSPreparedContainsXY_r, GEOSPreparedIntersectsXY_r, GEOSPreparedRelate_r, GEOSPreparedGeom_destroy_r, GEOSGeom_destroy_r, GEOSFree_r, readCString }, console) {
    const ctx = await GEOS_init_r();
    const reader = await GEOSWKTReader_create_r(ctx);
    const zone = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (4 4, 6 4, 6 6, 4 6, 4 4))');
    const other = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))');
    if (!zone || !other) throw new Error('not a WKT geometry');
    const prepared = await GEOSPrepare_r(ctx, zone); // indexes the edges on the first question
    const answer = (result) => {
        if (result === 2) throw new Error('GEOS could not evaluate the predicate');
        return result === 1;
    };

    const points = [[2, 2], [5, 5], [10, 5], [12, 5]]; // inside, in the hole, on the edge, outside
    for (const [x, y] of points) {
        const contains = answer(await GEOSPreparedContainsXY_r(ctx, prepared, x, y));
        const intersects = answer(await GEOSPreparedIntersectsXY_r(ctx, prepared, x, y));
        console.log(`${x} ${y}: contains ${contains}, intersects ${intersects}`);
    }
    const matrix = await GEOSPreparedRelate_r(ctx, prepared, other); // a char * GEOS allocated
    console.log(await readCString(matrix));
    await GEOSFree_r(ctx, matrix);

    await GEOSPreparedGeom_destroy_r(ctx, prepared);
    await GEOSGeom_destroy_r(ctx, zone);
    await GEOSGeom_destroy_r(ctx, other);
    await GEOSWKTReader_destroy_r(ctx, reader);
    await GEOS_finish_r(ctx);
}
