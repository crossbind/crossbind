export const imports = {
    '@crossbind/port-geos/geos_c.h': [
        'GEOSversion',
        'GEOS_init_r',
        'GEOS_finish_r',
        'GEOSWKTReader_create_r',
        'GEOSWKTReader_read_r',
        'GEOSWKTReader_destroy_r',
        'GEOSWKTWriter_create_r',
        'GEOSWKTWriter_write_r',
        'GEOSWKTWriter_destroy_r',
        'GEOSIntersection_r',
        'GEOSUnion_r',
        'GEOSDifference_r',
        'GEOSNormalize_r',
        'GEOSArea_r',
        'GEOSGeom_destroy_r',
        'GEOSFree_r',
        'allocBuffer',
        'readNumberAt',
        'readCString',
    ],
};
export const note = 'The same reentrant calls the C++ makes, on `geos_c.h` as GEOS ships it. What the wrapper did is now yours: the context, a WKT reader and writer (the shorter `GEOSGeomToWKT_r` pads every number to `5.0000000000000000`), the `double *` of `GEOSArea_r` as an 8-byte `allocBuffer` read with `readNumberAt`, the `char *` WKT read with `readCString` and returned to `GEOSFree_r`, and every geometry destroyed by hand. GEOS hands its error text only to a callback and a JavaScript function cannot cross into the worker, so a failed call gives only its failure value (`null` for bad WKT) and no message.';
export const expected = ['3.15.0-CAPI-1.21.0', 'POLYGON ((5 5, 5 10, 10 10, 10 5, 5 5)) 25', '175 75'];

export default async function example({ GEOSversion, GEOS_init_r, GEOS_finish_r, GEOSWKTReader_create_r, GEOSWKTReader_read_r, GEOSWKTReader_destroy_r, GEOSWKTWriter_create_r, GEOSWKTWriter_write_r, GEOSWKTWriter_destroy_r, GEOSIntersection_r, GEOSUnion_r, GEOSDifference_r, GEOSNormalize_r, GEOSArea_r, GEOSGeom_destroy_r, GEOSFree_r, allocBuffer, readNumberAt, readCString }, console) {
    const ctx = await GEOS_init_r();
    const reader = await GEOSWKTReader_create_r(ctx);
    const writer = await GEOSWKTWriter_create_r(ctx);
    const parcel = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0))');
    const floodZone = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((5 5, 15 5, 15 15, 5 15, 5 5))');
    if (!parcel || !floodZone) throw new Error('not a WKT geometry');
    const out = await allocBuffer(8); // GEOSArea_r writes the area here, as a double
    const area = async (geometry) => {
        if (!(await GEOSArea_r(ctx, geometry, out))) throw new Error('GEOS could not measure the geometry');
        return readNumberAt(out, 0, 'float64');
    };

    const flooded = await GEOSIntersection_r(ctx, parcel, floodZone);
    await GEOSNormalize_r(ctx, flooded); // the same shape always prints the same WKT
    const wkt = await GEOSWKTWriter_write_r(ctx, writer, flooded); // a char * GEOS allocated
    console.log(await GEOSversion());
    console.log(await readCString(wkt), await area(flooded));
    await GEOSFree_r(ctx, wkt);
    const united = await GEOSUnion_r(ctx, parcel, floodZone);
    const dry = await GEOSDifference_r(ctx, parcel, floodZone);
    console.log(await area(united), await area(dry));

    for (const geometry of [parcel, floodZone, flooded, united, dry]) await GEOSGeom_destroy_r(ctx, geometry);
    await GEOSWKTReader_destroy_r(ctx, reader);
    await GEOSWKTWriter_destroy_r(ctx, writer);
    await GEOS_finish_r(ctx);
}
