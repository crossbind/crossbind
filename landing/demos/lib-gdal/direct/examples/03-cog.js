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
        'GDALGetRasterXSize',
        'GDALGetRasterYSize',
        'GDALGetGeoTransform',
        'GDALGetBlockSize',
        'GDALGetMetadataItem',
        'GDALGetOverviewCount',
        'GDALGetOverview',
        'GDALGetRasterBandXSize',
        'GDALGetRasterBandYSize',
        'allocBuffer',
        'allocPointer',
        'writePointerAt',
        'cstring',
        'writeNumberAt',
        'readNumberAt',
        'writeBytes',
    ],
    '@crossbind/port-gdal/gdal_utils.h': [
        'GDALWarpAppOptionsNew',
        'GDALWarpAppOptionsFree',
        'GDALWarp',
        'GDALTranslateOptionsNew',
        'GDALTranslateOptionsFree',
        'GDALTranslate',
    ],
    '@crossbind/port-gdal/cpl_vsi.h': ['VSIUnlink'],
    '@crossbind/port-gdal/cpl_error.h': ['CPLGetLastErrorMsg'],
};
export const note = '`GDALWarp` and `GDALTranslate` take their arguments as NULL-terminated string lists that JavaScript builds with `allocPointer` and `cstring`; the block size comes back through two 4-byte out-parameters. The COG driver calls zstd even when it writes Deflate, so zstd has to stay in the link (see the configuration above).';
export const expected = [
    '1093 x 672 pixels of 0.000322 x 0.000322 degrees',
    'LAYOUT=COG, COMPRESSION=DEFLATE, 256 x 256 blocks',
    'overviews 546 x 336, 273 x 168, 136 x 84',
];

export default async function example({ GDALAllRegister, GDALGetDriverByName, GDALCreate, GDALDataType, GDALSetGeoTransform, GDALSetProjection, GDALGetRasterBand, GDALRasterIO, GDALRWFlag, GDALClose, GDALOpenEx, GDALGetRasterXSize, GDALGetRasterYSize, GDALGetGeoTransform, GDALGetBlockSize, GDALGetMetadataItem, GDALGetOverviewCount, GDALGetOverview, GDALGetRasterBandXSize, GDALGetRasterBandYSize, allocBuffer, allocPointer, writePointerAt, cstring, writeNumberAt, readNumberAt, writeBytes, GDALWarpAppOptionsNew, GDALWarpAppOptionsFree, GDALWarp, GDALTranslateOptionsNew, GDALTranslateOptionsFree, GDALTranslate, VSIUnlink, CPLGetLastErrorMsg }, console) {
    await GDALAllRegister();
    // A NULL-terminated list of strings, as GDAL's option and argv parameters take them.
    const list = async (items) => {
        const argv = await allocPointer(items.length + 1);
        for (const [i, item] of items.entries()) await writePointerAt(argv, i, await cstring(item));
        return argv;
    };
    // 1000 x 800 pixels of 30 m in UTM zone 35N, 30 x 24 km, that rise by 1 m a pixel east and 2 m south
    const [width, height] = [1000, 800];
    const float32 = await GDALDataType.GDT_Float32;
    const created = await GDALCreate(await GDALGetDriverByName('GTiff'), '/vsimem/utm.tif', width, height, 1, float32, await list(['COMPRESS=DEFLATE']));
    if (!created) throw new Error(await CPLGetLastErrorMsg());
    const transform = await allocBuffer(6 * 8);
    for (const [i, value] of [500000, 30, 0, 4450000, 0, -30].entries()) await writeNumberAt(transform, i, 'float64', value);
    await GDALSetGeoTransform(created, transform);
    await GDALSetProjection(created, 'EPSG:32635');
    const heights = Float32Array.from({ length: width * height }, (_, i) => 100 + (i % width) + 2 * Math.floor(i / width));
    const pixels = await allocBuffer(heights.byteLength);
    await writeBytes(pixels, Array.from(new Uint8Array(heights.buffer), (byte) => String.fromCharCode(byte)).join(''));
    await GDALRasterIO(await GDALGetRasterBand(created, 1), await GDALRWFlag.GF_Write, 0, 0, width, height, pixels, width, height, float32, 0, 0);
    await GDALClose(created);

    // gdalwarp -of VRT: the reprojected raster stays virtual and is computed while the COG is written.
    const input = await GDALOpenEx('/vsimem/utm.tif', 2, null, null, null); // 2 is GDAL_OF_RASTER
    const sources = await allocPointer(1);
    await writePointerAt(sources, 0, input);
    const warpOptions = await GDALWarpAppOptionsNew(await list(['-of', 'VRT', '-r', 'bilinear', '-t_srs', 'EPSG:4326']), null);
    const warped = await GDALWarp('', null, 1, sources, warpOptions, null);
    await GDALWarpAppOptionsFree(warpOptions);
    if (!warped) throw new Error(await CPLGetLastErrorMsg());
    const cogOptions = await GDALTranslateOptionsNew(await list(['-of', 'COG', '-co', 'COMPRESS=DEFLATE', '-co', 'BLOCKSIZE=256']), null);
    await VSIUnlink('/vsimem/cog.tif'); // replace the output of an earlier run
    const cog = await GDALTranslate('/vsimem/cog.tif', warped, cogOptions, null);
    await GDALTranslateOptionsFree(cogOptions);
    await GDALClose(warped);
    await GDALClose(input);
    if (!cog) throw new Error(await CPLGetLastErrorMsg());
    await GDALClose(cog);

    // What a reader of the file sees.
    const dataset = await GDALOpenEx('/vsimem/cog.tif', 2, null, null, null);
    const band = await GDALGetRasterBand(dataset, 1);
    await GDALGetGeoTransform(dataset, transform);
    const pixelWidth = await readNumberAt(transform, 1, 'float64');
    const pixelHeight = -(await readNumberAt(transform, 5, 'float64'));
    console.log(`${await GDALGetRasterXSize(dataset)} x ${await GDALGetRasterYSize(dataset)} pixels of ${pixelWidth.toFixed(6)} x ${pixelHeight.toFixed(6)} degrees`);
    const blockWidth = await allocBuffer(4);
    const blockHeight = await allocBuffer(4);
    await GDALGetBlockSize(band, blockWidth, blockHeight);
    const layout = await GDALGetMetadataItem(dataset, 'LAYOUT', 'IMAGE_STRUCTURE');
    const compression = await GDALGetMetadataItem(dataset, 'COMPRESSION', 'IMAGE_STRUCTURE');
    console.log(`LAYOUT=${layout}, COMPRESSION=${compression}, ${await readNumberAt(blockWidth, 0, 'int32')} x ${await readNumberAt(blockHeight, 0, 'int32')} blocks`);
    const overviews = [];
    for (let i = 0; i < (await GDALGetOverviewCount(band)); i++) {
        const overview = await GDALGetOverview(band, i);
        overviews.push(`${await GDALGetRasterBandXSize(overview)} x ${await GDALGetRasterBandYSize(overview)}`);
    }
    console.log(`overviews ${overviews.join(', ')}`);
    await GDALClose(dataset);
}
