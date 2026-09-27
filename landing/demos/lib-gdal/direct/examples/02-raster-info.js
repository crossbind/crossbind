export const imports = {
    '@crossbind/port-gdal/gdal.h': [
        'GDALAllRegister',
        'GDALGetDriverByName',
        'GDALCreate',
        'GDALDataType',
        'GDALSetGeoTransform',
        'GDALSetProjection',
        'GDALGetRasterBand',
        'GDALRasterIO',
        'GDALRWFlag',
        'GDALClose',
        'GDALOpenEx',
        'GDALGetDriverShortName',
        'GDALGetDatasetDriver',
        'GDALGetRasterXSize',
        'GDALGetRasterYSize',
        'GDALGetRasterCount',
        'GDALGetDataTypeName',
        'GDALGetRasterDataType',
        'GDALGetGeoTransform',
        'GDALGetProjectionRef',
        'GDALComputeRasterMinMax',
        'allocBuffer',
        'allocPointer',
        'writePointerAt',
        'cstring',
        'writeNumberAt',
        'readNumberAt',
        'writeBytes',
        'readCString',
    ],
    '@crossbind/port-gdal/gdal_utils.h': ['GDALInfo'],
    '@crossbind/port-gdal/cpl_vsi.h': ['VSIFree'],
    '@crossbind/port-gdal/cpl_error.h': ['CPLGetLastErrorMsg'],
};
export const note = 'JavaScript writes the pixels and the six geotransform numbers into `allocBuffer` memory and reads the transform and the value range back the same way. `GDALSetProjection` takes `EPSG:32635` as text, and `GDAL_OF_RASTER` is a macro, so the open flag is written as 2.';
export const expected = [
    'GTiff, 200 x 150 pixels, 1 band of Float32',
    'origin 500000, 4450000; pixel size 30 x -30',
    'WGS 84 / UTM zone 35N, EPSG:32635',
    'values 100 to 597',
    'Upper Left  (  500000.000, 4450000.000) ( 27d 0\' 0.00"E, 40d12\' 1.44"N)',
    'Lower Right (  506000.000, 4445500.000) ( 27d 4\'13.64"E, 40d 9\'35.41"N)',
];

export default async function example({ GDALAllRegister, GDALGetDriverByName, GDALCreate, GDALDataType, GDALSetGeoTransform, GDALSetProjection, GDALGetRasterBand, GDALRasterIO, GDALRWFlag, GDALClose, GDALOpenEx, GDALGetDriverShortName, GDALGetDatasetDriver, GDALGetRasterXSize, GDALGetRasterYSize, GDALGetRasterCount, GDALGetDataTypeName, GDALGetRasterDataType, GDALGetGeoTransform, GDALGetProjectionRef, GDALComputeRasterMinMax, allocBuffer, allocPointer, writePointerAt, cstring, writeNumberAt, readNumberAt, writeBytes, readCString, GDALInfo, VSIFree, CPLGetLastErrorMsg }, console) {
    await GDALAllRegister();
    // 200 x 150 pixels of 30 m, the top left corner at 500000 E 4450000 N in UTM zone 35N
    const [width, height] = [200, 150];
    const options = await allocPointer(2); // a NULL-terminated list: COMPRESS=DEFLATE
    await writePointerAt(options, 0, await cstring('COMPRESS=DEFLATE'));
    const float32 = await GDALDataType.GDT_Float32;
    const created = await GDALCreate(await GDALGetDriverByName('GTiff'), '/vsimem/dem.tif', width, height, 1, float32, options);
    if (!created) throw new Error(await CPLGetLastErrorMsg());
    const transform = await allocBuffer(6 * 8);
    for (const [i, value] of [500000, 30, 0, 4450000, 0, -30].entries()) await writeNumberAt(transform, i, 'float64', value);
    await GDALSetGeoTransform(created, transform);
    await GDALSetProjection(created, 'EPSG:32635');
    // Elevations in metres that rise by 1 m a pixel to the east and 2 m a pixel to the south, as bytes.
    const heights = Float32Array.from({ length: width * height }, (_, i) => 100 + (i % width) + 2 * Math.floor(i / width));
    const pixels = await allocBuffer(heights.byteLength);
    await writeBytes(pixels, Array.from(new Uint8Array(heights.buffer), (byte) => String.fromCharCode(byte)).join(''));
    await GDALRasterIO(await GDALGetRasterBand(created, 1), await GDALRWFlag.GF_Write, 0, 0, width, height, pixels, width, height, float32, 0, 0);
    await GDALClose(created);

    const dataset = await GDALOpenEx('/vsimem/dem.tif', 2, null, null, null); // 2 is GDAL_OF_RASTER
    const band = await GDALGetRasterBand(dataset, 1);
    const driver = await GDALGetDriverShortName(await GDALGetDatasetDriver(dataset));
    const type = await GDALGetDataTypeName(await GDALGetRasterDataType(band));
    console.log(`${driver}, ${await GDALGetRasterXSize(dataset)} x ${await GDALGetRasterYSize(dataset)} pixels, ${await GDALGetRasterCount(dataset)} band of ${type}`);
    await GDALGetGeoTransform(dataset, transform);
    const t = [];
    for (let i = 0; i < 6; i++) t.push(await readNumberAt(transform, i, 'float64'));
    console.log(`origin ${t[0]}, ${t[3]}; pixel size ${t[1]} x ${t[5]}`);
    // The CRS as WKT: its name comes first and its own AUTHORITY last.
    const wkt = await GDALGetProjectionRef(dataset);
    const [, name] = wkt.match(/^PROJCS\["([^"]+)"/);
    const [, authority, code] = wkt.match(/AUTHORITY\["(\w+)","(\w+)"\]\]$/);
    console.log(`${name}, ${authority}:${code}`);
    const range = await allocBuffer(2 * 8);
    await GDALComputeRasterMinMax(band, 0, range);
    console.log(`values ${await readNumberAt(range, 0, 'float64')} to ${await readNumberAt(range, 1, 'float64')}`);

    // GDALInfo returns the report the gdalinfo tool prints; keep its corner coordinates.
    const report = await GDALInfo(dataset, null);
    const text = await readCString(report);
    await VSIFree(report);
    await GDALClose(dataset);
    for (const line of text.split('\n')) {
        if (line.startsWith('Upper Left') || line.startsWith('Lower Right')) console.log(line);
    }
}
