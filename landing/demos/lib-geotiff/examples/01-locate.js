export const title = 'Find where a GeoTIFF is';
export const summary = 'The question most GeoTIFF code answers: GTIFNew reads the GeoKeys, GTIFGetDefn turns them into a coordinate system, GTIFImageToPCS places pixels on the map and GTIFProj4ToLatLong turns map coordinates into degrees.';
export const native = 'geotiff_locator.h';
export const expected = [
    'libgeotiff 1.7.4, 10262 B: EPSG:32633 WGS 84 / UTM zone 33N, 100 x 100 pixels',
    'upper left 500000, 4650000 = 15.000000 E, 42.002015 N',
    'lower right 503000, 4647000 = 15.036210 E, 41.974990 N',
];

export default async function example({ GeoTiffLocator }, console) {
    // 100 x 100 pixels of 30 m in WGS 84 / UTM zone 33N, the upper-left corner at 500000, 4650000
    const tiff = await GeoTiffLocator.write(32633, 100, 100, 500000, 4650000, 30);
    const where = JSON.parse(await GeoTiffLocator.locate(tiff));
    console.log(`libgeotiff ${await GeoTiffLocator.version()}, ${tiff.length} B: EPSG:${where.epsg} ${where.name}, ${where.width} x ${where.height} pixels`);
    const degrees = ([lon, lat]) => `${lon.toFixed(6)} E, ${lat.toFixed(6)} N`;
    console.log(`upper left ${where.upperLeft.join(', ')} = ${degrees(where.upperLeftLonLat)}`);
    console.log(`lower right ${where.lowerRight.join(', ')} = ${degrees(where.lowerRightLonLat)}`);
}
