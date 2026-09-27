export const title = 'Reproject a raster and write a Cloud-Optimized GeoTIFF';
export const summary = 'GDALWarp reprojects as the gdalwarp tool does, here into a virtual raster that is computed while it is read; GDALTranslate with -of COG then writes it tiled, compressed and with overviews, the layout web maps read with HTTP range requests.';
export const native = 'cog_writer.h';
export const expected = [
    '1093 x 672 pixels of 0.000322 x 0.000322 degrees',
    'LAYOUT=COG, COMPRESSION=DEFLATE, 256 x 256 blocks',
    'overviews 546 x 336, 273 x 168, 136 x 84',
];

export default async function example({ RasterInfo, CogWriter }, console) {
    const raster = await new RasterInfo();
    await raster.create('/vsimem/utm.tif', 1000, 800, 500000, 4450000, 30, 32635); // 30 x 24 km in UTM zone 35N
    const writer = await new CogWriter();
    const report = await writer.warpToCog('/vsimem/utm.tif', 'EPSG:4326', '/vsimem/cog.tif');
    for (const line of report.split('\n')) console.log(line);
}
