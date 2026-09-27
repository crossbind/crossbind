export const imports = {
    '@crossbind/port-gdal/gdal.h': [
        'GDALAllRegister',
        'GDALGetDriverByName',
        'GDALCreate',
        'GDALDataType',
        'GDALSetGeoTransform',
        'GDALSetProjection',
        'GDALGetSpatialRef',
        'GDALGetRasterBand',
        'GDALRasterIO',
        'GDALRWFlag',
        'GDALClose',
        'GDALOpenEx',
        'GDALGetRasterXSize',
        'GDALGetRasterYSize',
        'GDALComputeRasterStatistics',
        'GDALDatasetCreateLayer',
        'allocBuffer',
        'allocPointer',
        'writePointerAt',
        'cstring',
        'writeNumberAt',
        'readNumberAt',
        'writeBytes',
    ],
    '@crossbind/port-gdal/gdal_utils.h': ['GDALDEMProcessingOptionsNew', 'GDALDEMProcessingOptionsFree', 'GDALDEMProcessing'],
    '@crossbind/port-gdal/gdal_alg.h': ['GDALChecksumImage', 'GDALContourGenerateEx'],
    '@crossbind/port-gdal/ogr_api.h': [
        'OGR_Fld_Create',
        'OGR_Fld_Destroy',
        'OGR_L_CreateField',
        'OGR_L_ResetReading',
        'OGR_L_GetNextFeature',
        'OGR_F_GetFieldAsDouble',
        'OGR_F_GetGeometryRef',
        'OGR_F_Destroy',
        'OGR_G_Length',
    ],
    '@crossbind/port-gdal/ogr_core.h': ['OGRwkbGeometryType', 'OGRFieldType'],
    '@crossbind/port-gdal/cpl_error.h': ['CPLGetLastErrorMsg'],
};
export const note = '`GDALDEMProcessing` and `GDALContourGenerateEx` are called as in C++. The options are string lists built with `allocPointer` and `cstring`, the statistics come back through four 8-byte out-parameters, and `GDALContourGenerateEx` returns a `CPLErr` enum member, so its `.value` is what is compared with 0.';
export const expected = [
    'hillshade: 12.00 to 255.00, mean 156.63, checksum 58516',
    'slope: 0.00 to 42.97, mean 27.46, checksum 54054',
    'contours every 100 m: 11 lines from 200 to 900 m, 46.9 km long',
];

export default async function example({ GDALAllRegister, GDALGetDriverByName, GDALCreate, GDALDataType, GDALSetGeoTransform, GDALSetProjection, GDALGetSpatialRef, GDALGetRasterBand, GDALRasterIO, GDALRWFlag, GDALClose, GDALOpenEx, GDALGetRasterXSize, GDALGetRasterYSize, GDALComputeRasterStatistics, GDALDatasetCreateLayer, allocBuffer, allocPointer, writePointerAt, cstring, writeNumberAt, readNumberAt, writeBytes, GDALDEMProcessingOptionsNew, GDALDEMProcessingOptionsFree, GDALDEMProcessing, GDALChecksumImage, GDALContourGenerateEx, OGR_Fld_Create, OGR_Fld_Destroy, OGR_L_CreateField, OGR_L_ResetReading, OGR_L_GetNextFeature, OGR_F_GetFieldAsDouble, OGR_F_GetGeometryRef, OGR_F_Destroy, OGR_G_Length, OGRwkbGeometryType, OGRFieldType, CPLGetLastErrorMsg }, console) {
    await GDALAllRegister();
    // A NULL-terminated list of strings, as GDAL's option and argv parameters take them.
    const list = async (items) => {
        const argv = await allocPointer(items.length + 1);
        for (const [i, item] of items.entries()) await writePointerAt(argv, i, await cstring(item));
        return argv;
    };
    // A round hill, 900 m at the centre of a 100 m plain, in whole metres: 101 x 101 pixels of 30 m.
    const size = 101;
    const float32 = await GDALDataType.GDT_Float32;
    const created = await GDALCreate(await GDALGetDriverByName('GTiff'), '/vsimem/hill.tif', size, size, 1, float32, null);
    if (!created) throw new Error(await CPLGetLastErrorMsg());
    const transform = await allocBuffer(6 * 8);
    for (const [i, value] of [500000, 30, 0, 4450000, 0, -30].entries()) await writeNumberAt(transform, i, 'float64', value);
    await GDALSetGeoTransform(created, transform);
    await GDALSetProjection(created, 'EPSG:32635');
    const centre = Math.floor(size / 2);
    const heights = Float32Array.from({ length: size * size }, (_, i) => {
        const dx = (i % size) - centre;
        const dy = Math.floor(i / size) - centre;
        return Math.max(100, 900 - Math.floor((dx * dx + dy * dy) / 4));
    });
    const pixels = await allocBuffer(heights.byteLength);
    await writeBytes(pixels, Array.from(new Uint8Array(heights.buffer), (byte) => String.fromCharCode(byte)).join(''));
    await GDALRasterIO(await GDALGetRasterBand(created, 1), await GDALRWFlag.GF_Write, 0, 0, size, size, pixels, size, size, float32, 0, 0);
    await GDALClose(created);

    // gdaldem hillshade and slope; with -compute_edges the border pixels get values too.
    const hill = await GDALOpenEx('/vsimem/hill.tif', 2, null, null, null); // 2 is GDAL_OF_RASTER
    for (const processing of ['hillshade', 'slope']) {
        const options = await GDALDEMProcessingOptionsNew(await list(['-compute_edges']), null);
        const result = await GDALDEMProcessing(`/vsimem/${processing}.tif`, hill, processing, null, options, null);
        await GDALDEMProcessingOptionsFree(options);
        if (!result) throw new Error(await CPLGetLastErrorMsg());
        const band = await GDALGetRasterBand(result, 1);
        const [min, max, mean, deviation] = [await allocBuffer(8), await allocBuffer(8), await allocBuffer(8), await allocBuffer(8)];
        await GDALComputeRasterStatistics(band, 0, min, max, mean, deviation, null, null);
        const checksum = await GDALChecksumImage(band, 0, 0, await GDALGetRasterXSize(result), await GDALGetRasterYSize(result));
        await GDALClose(result);
        const value = async (handle) => (await readNumberAt(handle, 0, 'float64')).toFixed(2);
        console.log(`${processing}: ${await value(min)} to ${await value(max)}, mean ${await value(mean)}, checksum ${checksum}`);
    }

    // gdal_contour -i 100: the lines go to an in-memory layer, one feature per line.
    const store = await GDALCreate(await GDALGetDriverByName('MEM'), '', 0, 0, 0, await GDALDataType.GDT_Unknown, null);
    const layer = await GDALDatasetCreateLayer(store, 'contours', await GDALGetSpatialRef(hill), await OGRwkbGeometryType.wkbLineString, null);
    const field = await OGR_Fld_Create('elevation', await OGRFieldType.OFTReal);
    await OGR_L_CreateField(layer, field, 1);
    await OGR_Fld_Destroy(field);
    const error = await GDALContourGenerateEx(await GDALGetRasterBand(hill, 1), layer, await list(['LEVEL_INTERVAL=100', 'ELEV_FIELD=0']), null, null);
    await GDALClose(hill);
    if (error.value !== 0) throw new Error(await CPLGetLastErrorMsg());
    let lines = 0;
    let lowest = 0;
    let highest = 0;
    let length = 0;
    await OGR_L_ResetReading(layer);
    for (let feature; (feature = await OGR_L_GetNextFeature(layer)); await OGR_F_Destroy(feature)) {
        const elevation = await OGR_F_GetFieldAsDouble(feature, 0);
        lowest = lines ? Math.min(lowest, elevation) : elevation;
        highest = lines ? Math.max(highest, elevation) : elevation;
        length += await OGR_G_Length(await OGR_F_GetGeometryRef(feature));
        lines++;
    }
    await GDALClose(store);
    console.log(`contours every 100 m: ${lines} lines from ${lowest} to ${highest} m, ${(length / 1000).toFixed(1)} km long`);
}
