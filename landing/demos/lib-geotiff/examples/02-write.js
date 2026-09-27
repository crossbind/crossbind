export const title = 'Write a compressed GeoTIFF';
export const summary = 'Georeferencing is two TIFF tags and a few GeoKeys: TIFFTAG_GEOTIEPOINTS and TIFFTAG_GEOPIXELSCALE place the pixels, GTIFKeySet and GTIFWriteKeys name the coordinate system. GTIFPrint then prints the result the way listgeo does.';
export const native = 'geotiff_writer.h';
export const expected = [
    '256 x 128 pixels: 32768 B, 23246 B as a Deflate GeoTIFF',
    'Geotiff_Information:',
    '   Version: 1',
    '   Key_Revision: 1.0',
    '   Tagged_Information:',
    '      ModelTiepointTag (2,3):',
    '         0                 0                 0',
    '         -10               60                0',
    '      ModelPixelScaleTag (1,3):',
    '         0.15625           0.1953125         0',
    '      End_Of_Tags.',
    '   Keyed_Information:',
    '      GTModelTypeGeoKey (Short,1): ModelTypeGeographic',
    '      GTRasterTypeGeoKey (Short,1): RasterPixelIsArea',
    '      GTCitationGeoKey (Ascii,25): "Europe, synthetic relief"',
    '      GeographicTypeGeoKey (Short,1): GCS_WGS_84',
    '      GeogAngularUnitsGeoKey (Short,1): Angular_Degree',
    '      End_Of_Keys.',
    '   End_Of_Geotiff.',
];

export default async function example({ GeoTiffWriter }, console) {
    const [width, height] = [256, 128];
    let seed = 11;
    const noise = () => (seed = (seed * 48271) % 2147483647) % 24;
    const relief = (x, y) => 60 + 2 * Math.abs((x % 64) - 32) + 2 * Math.abs((y % 48) - 24) + noise(); // ridges and noise
    const pixels = Array.from({ length: width * height }, (_, i) => String.fromCharCode(relief(i % width, Math.floor(i / width)))).join('');

    // 10 W to 30 E and 35 N to 60 N, in WGS 84 degrees
    const tiff = await GeoTiffWriter.write(pixels, width, height, -10, 35, 30, 60, 'Europe, synthetic relief');
    console.log(`${width} x ${height} pixels: ${pixels.length} B, ${tiff.length} B as a Deflate GeoTIFF`);
    for (const line of (await GeoTiffWriter.print(tiff)).trimEnd().split('\n')) console.log(line.trimEnd());
}
