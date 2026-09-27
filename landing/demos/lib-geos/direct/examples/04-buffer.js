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
        'GEOSBuffer_r',
        'GEOSBufferWithStyle_r',
        'GEOSOffsetCurve_r',
        'GEOSBufCapStyles',
        'GEOSBufJoinStyles',
        'GEOSNormalize_r',
        'GEOSArea_r',
        'GEOSGeom_destroy_r',
        'GEOSFree_r',
        'allocBuffer',
        'readNumberAt',
        'readCString',
    ],
};
export const note = 'GEOS declares the cap and join styles as `int` parameters and names them in the `GEOSBufCapStyles` and `GEOSBufJoinStyles` enums, so pass the member\'s `.value`: the member itself crosses as 0 without an error, and the flat-capped corridor then comes back as `POLYGON EMPTY`.';
export const expected = ['312.1445', '1000 1078.0361', 'POLYGON ((2 2, 2 18, 18 18, 18 2, 2 2)) 256', 'LINESTRING (0 5, 100 5)'];

export default async function example({ GEOS_init_r, GEOS_finish_r, GEOSWKTReader_create_r, GEOSWKTReader_read_r, GEOSWKTReader_destroy_r, GEOSWKTWriter_create_r, GEOSWKTWriter_write_r, GEOSWKTWriter_destroy_r, GEOSBuffer_r, GEOSBufferWithStyle_r, GEOSOffsetCurve_r, GEOSBufCapStyles, GEOSBufJoinStyles, GEOSNormalize_r, GEOSArea_r, GEOSGeom_destroy_r, GEOSFree_r, allocBuffer, readNumberAt, readCString }, console) {
    const ctx = await GEOS_init_r();
    const reader = await GEOSWKTReader_create_r(ctx);
    const writer = await GEOSWKTWriter_create_r(ctx);
    const point = await GEOSWKTReader_read_r(ctx, reader, 'POINT (0 0)');
    const road = await GEOSWKTReader_read_r(ctx, reader, 'LINESTRING (0 0, 100 0)');
    const lot = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 20 0, 20 20, 0 20, 0 0))');
    if (!point || !road || !lot) throw new Error('not a WKT geometry');
    const out = await allocBuffer(8); // GEOSArea_r writes the area here, as a double
    const area = async (geometry) => {
        if (!(await GEOSArea_r(ctx, geometry, out))) throw new Error('GEOS could not measure the geometry');
        return readNumberAt(out, 0, 'float64');
    };
    const wkt = async (geometry) => {
        await GEOSNormalize_r(ctx, geometry); // the same shape always prints the same WKT
        const text = await GEOSWKTWriter_write_r(ctx, writer, geometry); // a char * GEOS allocated
        const copy = await readCString(text);
        await GEOSFree_r(ctx, text);
        return copy;
    };

    const circle = await GEOSBuffer_r(ctx, point, 10, 8); // 8 segments per quarter circle
    console.log((await area(circle)).toFixed(4));
    const flatCap = (await GEOSBufCapStyles.GEOSBUF_CAP_FLAT).value;
    const roundCap = (await GEOSBufCapStyles.GEOSBUF_CAP_ROUND).value;
    const roundJoin = (await GEOSBufJoinStyles.GEOSBUF_JOIN_ROUND).value;
    const flat = await GEOSBufferWithStyle_r(ctx, road, 5, 8, flatCap, roundJoin, 5);
    const round = await GEOSBufferWithStyle_r(ctx, road, 5, 8, roundCap, roundJoin, 5);
    console.log(await area(flat), (await area(round)).toFixed(4));
    const setback = await GEOSBuffer_r(ctx, lot, -2, 8);
    console.log(await wkt(setback), await area(setback));
    const offset = await GEOSOffsetCurve_r(ctx, road, 5, 8, roundJoin, 5); // positive: to the left
    console.log(await wkt(offset));

    for (const geometry of [point, road, lot, circle, flat, round, setback, offset]) await GEOSGeom_destroy_r(ctx, geometry);
    await GEOSWKTReader_destroy_r(ctx, reader);
    await GEOSWKTWriter_destroy_r(ctx, writer);
    await GEOS_finish_r(ctx);
}
