export const title = 'Read the GeoKeys, the tiepoint and the pixel scale';
export const summary = 'GTIFDirectoryInfo counts the keys, GTIFKeyInfo and GTIFKeyGet read each one with its type, and GTIFValueNameEx names its value. The tiepoint and the pixel scale are TIFF tags, read with TIFFGetField.';
export const native = 'geokey_reader.h';
export const expected = [
    'GeoTIFF 1, key revision 1.0, 5 keys',
    'GTModelTypeGeoKey (Short): 2 = ModelTypeGeographic',
    'GTRasterTypeGeoKey (Short): 1 = RasterPixelIsArea',
    'GTCitationGeoKey (Ascii): "Europe"',
    'GeographicTypeGeoKey (Short): 4326 = GCS_WGS_84',
    'GeogAngularUnitsGeoKey (Short): 9102 = Angular_Degree',
    'tiepoint: pixel 0, 0 is at -10, 60; pixel scale: 0.625 x 0.78125',
];

export default async function example({ GeoKeyReader, GeoTiffWriter }, console) {
    const pixels = String.fromCharCode(...Array.from({ length: 64 * 32 }, (_, i) => (i * 7) % 256));
    const tiff = await GeoTiffWriter.write(pixels, 64, 32, -10, 35, 30, 60, 'Europe'); // the writer from the previous example

    const read = JSON.parse(await GeoKeyReader.read(tiff));
    console.log(`GeoTIFF ${read.version}, key revision ${read.revision}, ${read.count} keys`);
    for (const key of read.keys) console.log(`${key.key} (${key.type}): ${JSON.stringify(key.value)}${key.name ? ` = ${key.name}` : ''}`);
    const [column, row, , x, y] = read.tiepoint;
    console.log(`tiepoint: pixel ${column}, ${row} is at ${x}, ${y}; pixel scale: ${read.pixelScale[0]} x ${read.pixelScale[1]}`);
}
