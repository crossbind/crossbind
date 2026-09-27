export const imports = {
    '@crossbind/port-geos/geos_c.h': [
        'GEOS_init_r',
        'GEOS_finish_r',
        'GEOSWKTReader_create_r',
        'GEOSWKTReader_read_r',
        'GEOSWKTReader_destroy_r',
        'GEOSWKTWriter_create_r',
        'GEOSWKTWriter_write_r',
        'GEOSWKTWriter_destroy_r',
        'GEOSArea_r',
        'GEOSLength_r',
        'GEOSDistance_r',
        'GEOSNearestPoints_r',
        'GEOSGeom_createLineString_r',
        'GEOSGetCentroid_r',
        'GEOSGeom_destroy_r',
        'GEOSFree_r',
        'allocBuffer',
        'readNumberAt',
        'readCString',
    ],
};
export const note = 'Area, length and distance come back through a `double *`: one 8-byte `allocBuffer` serves every call and `readNumberAt(out, 0, \'float64\')` reads it after each. `GEOSNearestPoints_r` returns a coordinate sequence handle and `GEOSGeom_createLineString_r` takes ownership of it, so only the line is destroyed.';
export const expected = ['1200 140 60', '15 LINESTRING (40 30, 52 39)', 'POINT (20 15)'];

export default async function example({ GEOS_init_r, GEOS_finish_r, GEOSWKTReader_create_r, GEOSWKTReader_read_r, GEOSWKTReader_destroy_r, GEOSWKTWriter_create_r, GEOSWKTWriter_write_r, GEOSWKTWriter_destroy_r, GEOSArea_r, GEOSLength_r, GEOSDistance_r, GEOSNearestPoints_r, GEOSGeom_createLineString_r, GEOSGetCentroid_r, GEOSGeom_destroy_r, GEOSFree_r, allocBuffer, readNumberAt, readCString }, console) {
    const ctx = await GEOS_init_r();
    const reader = await GEOSWKTReader_create_r(ctx);
    const writer = await GEOSWKTWriter_create_r(ctx);
    const field = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 40 0, 40 30, 0 30, 0 0))');
    const well = await GEOSWKTReader_read_r(ctx, reader, 'POINT (52 39)');
    const track = await GEOSWKTReader_read_r(ctx, reader, 'LINESTRING (0 0, 30 40, 30 50)');
    if (!field || !well || !track) throw new Error('not a WKT geometry');
    const out = await allocBuffer(8); // each measurement writes its result here, as a double
    const measured = async (status) => {
        if (!status) throw new Error('GEOS could not measure the geometry');
        return readNumberAt(out, 0, 'float64');
    };
    const wkt = async (geometry) => {
        const text = await GEOSWKTWriter_write_r(ctx, writer, geometry); // a char * GEOS allocated
        const copy = await readCString(text);
        await GEOSFree_r(ctx, text);
        return copy;
    };

    const area = await measured(await GEOSArea_r(ctx, field, out));
    const perimeter = await measured(await GEOSLength_r(ctx, field, out));
    const length = await measured(await GEOSLength_r(ctx, track, out));
    console.log(area, perimeter, length);
    const distance = await measured(await GEOSDistance_r(ctx, field, well, out));
    const ends = await GEOSNearestPoints_r(ctx, field, well); // from the field to the well
    const shortest = await GEOSGeom_createLineString_r(ctx, ends);
    console.log(distance, await wkt(shortest));
    const centroid = await GEOSGetCentroid_r(ctx, field);
    console.log(await wkt(centroid));

    for (const geometry of [field, well, track, shortest, centroid]) await GEOSGeom_destroy_r(ctx, geometry);
    await GEOSWKTReader_destroy_r(ctx, reader);
    await GEOSWKTWriter_destroy_r(ctx, writer);
    await GEOS_finish_r(ctx);
}
