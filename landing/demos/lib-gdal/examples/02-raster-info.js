export const title = 'Write a GeoTIFF and read its georeferencing back';
export const summary = 'GDALCreate writes a raster with GDALSetGeoTransform and a CRS from OSRImportFromEPSG; GDALOpenEx opens it again as it opens any of the formats GDAL reads, and the size, band type, geotransform and CRS come back from the dataset. GDALInfo returns the report the gdalinfo tool prints.';
export const native = 'raster_info.h';
export const expected = [
    'GTiff, 200 x 150 pixels, 1 band of Float32',
    'origin 500000, 4450000; pixel size 30 x -30',
    'WGS 84 / UTM zone 35N, EPSG:32635',
    'values 100 to 597',
    'Upper Left  (  500000.000, 4450000.000) ( 27d 0\' 0.00"E, 40d12\' 1.44"N)',
    'Lower Right (  506000.000, 4445500.000) ( 27d 4\'13.64"E, 40d 9\'35.41"N)',
];

export default async function example({ RasterInfo }, console) {
    const raster = await new RasterInfo();
    // 200 x 150 pixels of 30 m, the top left corner at 500000 E 4450000 N in UTM zone 35N
    await raster.create('/vsimem/dem.tif', 200, 150, 500000, 4450000, 30, 32635);
    for (const line of (await raster.describe('/vsimem/dem.tif')).split('\n')) console.log(line);
}
