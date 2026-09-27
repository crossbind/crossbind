export const title = 'Hillshade, slope and contour lines from an elevation model';
export const summary = 'GDALDEMProcessing is the gdaldem tool: hillshade, slope, aspect, roughness, TRI and TPI by name. GDALContourGenerateEx draws the contour lines gdal_contour draws, into any vector layer; here an in-memory one, measured with OGR_G_Length.';
export const native = 'dem_tools.h';
export const expected = [
    'hillshade: 12.00 to 255.00, mean 156.63, checksum 58516',
    'slope: 0.00 to 42.97, mean 27.46, checksum 54054',
    'contours every 100 m: 11 lines from 200 to 900 m, 46.9 km long',
];

export default async function example({ DemTools }, console) {
    const tools = await new DemTools();
    await tools.createHill('/vsimem/hill.tif', 101, 30); // 101 x 101 pixels of 30 m
    console.log(await tools.derive('/vsimem/hill.tif', 'hillshade', '/vsimem/hillshade.tif'));
    console.log(await tools.derive('/vsimem/hill.tif', 'slope', '/vsimem/slope.tif'));
    console.log(await tools.contours('/vsimem/hill.tif', 100));
}
