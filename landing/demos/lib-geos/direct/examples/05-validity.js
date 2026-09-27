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
        'GEOSisValid_r',
        'GEOSisValidReason_r',
        'GEOSMakeValidParams_create_r',
        'GEOSMakeValidParams_setMethod_r',
        'GEOSMakeValidParams_destroy_r',
        'GEOSMakeValidWithParams_r',
        'GEOSMakeValidMethods',
        'GEOSNormalize_r',
        'GEOSArea_r',
        'GEOSGeom_destroy_r',
        'GEOSFree_r',
        'allocBuffer',
        'readNumberAt',
        'readCString',
    ],
};
export const note = '`GEOSMakeValidParams_setMethod_r` takes an `enum GEOSMakeValidMethods`, so pass the member itself: a plain number crosses as 0, `GEOS_MAKE_VALID_LINEWORK`, and the call still returns 1. `GEOSisValid_r` returns a C `char` (1, 0, or 2 when GEOS failed), and the reason is a `char *` to read with `readCString` and return to `GEOSFree_r`.';
export const expected = [
    'false Self-intersection[5 5]',
    'MULTIPOLYGON (((5 5, 10 10, 10 0, 5 5)), ((0 0, 0 10, 5 5, 0 0))) true 50',
    'Self-intersection[5 10]',
    'linework 150',
    'structure 75',
];

export default async function example({ GEOS_init_r, GEOS_finish_r, GEOSWKTReader_create_r, GEOSWKTReader_read_r, GEOSWKTReader_destroy_r, GEOSWKTWriter_create_r, GEOSWKTWriter_write_r, GEOSWKTWriter_destroy_r, GEOSisValid_r, GEOSisValidReason_r, GEOSMakeValidParams_create_r, GEOSMakeValidParams_setMethod_r, GEOSMakeValidParams_destroy_r, GEOSMakeValidWithParams_r, GEOSMakeValidMethods, GEOSNormalize_r, GEOSArea_r, GEOSGeom_destroy_r, GEOSFree_r, allocBuffer, readNumberAt, readCString }, console) {
    const ctx = await GEOS_init_r();
    const reader = await GEOSWKTReader_create_r(ctx);
    const writer = await GEOSWKTWriter_create_r(ctx);
    const bowtie = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))');
    const leaky = await GEOSWKTReader_read_r(ctx, reader, 'POLYGON ((0 0, 10 0, 10 10, 0 10, 0 0), (5 5, 15 5, 15 15, 5 15, 5 5))');
    if (!bowtie || !leaky) throw new Error('not a WKT geometry');
    const out = await allocBuffer(8); // GEOSArea_r writes the area here, as a double
    const area = async (geometry) => {
        if (!(await GEOSArea_r(ctx, geometry, out))) throw new Error('GEOS could not measure the geometry');
        return readNumberAt(out, 0, 'float64');
    };
    const isValid = async (geometry) => {
        const valid = await GEOSisValid_r(ctx, geometry);
        if (valid === 2) throw new Error('GEOS could not check the geometry');
        return valid === 1;
    };
    const reason = async (geometry) => {
        const text = await GEOSisValidReason_r(ctx, geometry); // a char * GEOS allocated
        const copy = await readCString(text);
        await GEOSFree_r(ctx, text);
        return copy;
    };
    const makeValid = async (geometry, method) => {
        const params = await GEOSMakeValidParams_create_r(ctx);
        await GEOSMakeValidParams_setMethod_r(ctx, params, method);
        const repaired = await GEOSMakeValidWithParams_r(ctx, geometry, params);
        await GEOSMakeValidParams_destroy_r(ctx, params);
        await GEOSNormalize_r(ctx, repaired); // the same shape always prints the same WKT
        return repaired;
    };
    const linework = await GEOSMakeValidMethods.GEOS_MAKE_VALID_LINEWORK;
    const structure = await GEOSMakeValidMethods.GEOS_MAKE_VALID_STRUCTURE;

    console.log(await isValid(bowtie), await reason(bowtie));
    const repaired = await makeValid(bowtie, linework);
    const wkt = await GEOSWKTWriter_write_r(ctx, writer, repaired);
    console.log(await readCString(wkt), await isValid(repaired), await area(repaired));
    await GEOSFree_r(ctx, wkt);
    console.log(await reason(leaky));
    for (const [name, method] of [['linework', linework], ['structure', structure]]) {
        const fixed = await makeValid(leaky, method);
        console.log(name, await area(fixed));
        await GEOSGeom_destroy_r(ctx, fixed);
    }

    for (const geometry of [bowtie, leaky, repaired]) await GEOSGeom_destroy_r(ctx, geometry);
    await GEOSWKTReader_destroy_r(ctx, reader);
    await GEOSWKTWriter_destroy_r(ctx, writer);
    await GEOS_finish_r(ctx);
}
