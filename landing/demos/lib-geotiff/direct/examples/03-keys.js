export const imports = {
    '@crossbind/port-geotiff/geotiff.h': [
        'GTIFNewSimpleTags',
        'GTIFImport',
        'GTIFDirectoryInfo',
        'GTIFKeyCode',
        'GTIFKeyInfo',
        'GTIFTypeName',
        'GTIFKeyGetASCII',
        'GTIFKeyGetSHORT',
        'GTIFValueNameEx',
        'GTIFImageToPCS',
        'GTIFFree',
        'allocBuffer',
        'readCString',
        'readNumberAt',
        'writeNumberAt',
        'writeBytes',
        'releaseCallback',
    ],
};
export const note = 'The keys come in as listgeo text, as in the first example, and are read back one at a time the way the C++ reads them. Every key function takes a `geokey_t`, which is bound without its keys, so each key crosses as `{ value: code }` with the code from `GTIFKeyCode`, and a `tagtype_t` the same way. The tiepoint and the pixel scale are TIFF tags that only the variadic `TIFFGetField` reads, so JavaScript asks `GTIFImageToPCS` where pixels (0, 0) and (1, 1) land and takes the difference.';
export const expected = [
    'GeoTIFF 1, key revision 1.0, 5 keys',
    'GTModelTypeGeoKey (Short): 2 = ModelTypeGeographic',
    'GTRasterTypeGeoKey (Short): 1 = RasterPixelIsArea',
    'GTCitationGeoKey (Ascii): "Europe"',
    'GeographicTypeGeoKey (Short): 4326 = GCS_WGS_84',
    'GeogAngularUnitsGeoKey (Short): 9102 = Angular_Degree',
    'tiepoint: pixel 0, 0 is at -10, 60; pixel scale: 0.625 x 0.78125',
];
export const init = { useWorker: false };

export default async function example({ GTIFNewSimpleTags, GTIFImport, GTIFDirectoryInfo, GTIFKeyCode, GTIFKeyInfo, GTIFTypeName, GTIFKeyGetASCII, GTIFKeyGetSHORT, GTIFValueNameEx, GTIFImageToPCS, GTIFFree, allocBuffer, readCString, readNumberAt, writeNumberAt, writeBytes, releaseCallback }, console) {
    // What the previous example's writer gives 64 x 32 pixels from 10 W to 30 E and 35 N to 60 N
    const lines = `Geotiff_Information:
        Version: 1
        Key_Revision: 1.0
        Tagged_Information:
            ModelTiepointTag (2,3):
                0 0 0
                -10 60 0
            ModelPixelScaleTag (1,3):
                0.625 0.78125 0
            End_Of_Tags.
        Keyed_Information:
            GTModelTypeGeoKey (Short,1): ModelTypeGeographic
            GTRasterTypeGeoKey (Short,1): RasterPixelIsArea
            GTCitationGeoKey (Ascii,7): "Europe"
            GeographicTypeGeoKey (Short,1): GCS_WGS_84
            GeogAngularUnitsGeoKey (Short,1): Angular_Degree
            End_Of_Keys.
        End_Of_Geotiff.`.split('\n');
    const readLine = (buffer) => {
        writeBytes(buffer, `${lines.shift().trim()}\0`);
        return 1;
    };
    const tags = await allocBuffer(16); // zeroed memory is an empty ST_TIFF
    const gtif = await GTIFNewSimpleTags(tags);
    if (!(await GTIFImport(gtif, readLine, null))) throw new Error('GTIFImport could not read the text');
    await releaseCallback(readLine);

    const versions = await allocBuffer(12); // directory version, key revision, minor revision
    const count = await allocBuffer(4);
    await GTIFDirectoryInfo(gtif, versions, count);
    const [version, revision, minor] = [await readNumberAt(versions, 0, 'int32'), await readNumberAt(versions, 1, 'int32'), await readNumberAt(versions, 2, 'int32')];
    console.log(`GeoTIFF ${version}, key revision ${revision}.${minor}, ${await readNumberAt(count, 0, 'int32')} keys`);

    const common = ['GTModelTypeGeoKey', 'GTRasterTypeGeoKey', 'GTCitationGeoKey', 'GeographicTypeGeoKey', 'GeogCitationGeoKey', 'GeogAngularUnitsGeoKey',
        'ProjectedCSTypeGeoKey', 'PCSCitationGeoKey', 'ProjLinearUnitsGeoKey', 'VerticalCSTypeGeoKey', 'VerticalUnitsGeoKey'];
    const [size, type, short] = [await allocBuffer(4), await allocBuffer(4), await allocBuffer(2)];
    for (const name of common) {
        const key = { value: await GTIFKeyCode(name) };
        const values = await GTIFKeyInfo(gtif, key, size, type);
        if (values === 0) continue; // the file does not set it
        const typeName = await readCString(await GTIFTypeName({ value: await readNumberAt(type, 0, 'int32') }));
        if (typeName === 'Ascii') {
            const text = await allocBuffer(values + 1);
            await GTIFKeyGetASCII(gtif, key, text, values + 1);
            console.log(`${name} (${typeName}): ${JSON.stringify(await readCString(text))}`);
        } else {
            await GTIFKeyGetSHORT(gtif, key, short, 0, 1);
            const value = await readNumberAt(short, 0, 'uint16');
            console.log(`${name} (${typeName}): ${value} = ${await GTIFValueNameEx(gtif, key, value)}`);
        }
    }

    const [x, y] = [await allocBuffer(8), await allocBuffer(8)];
    const place = async (column, row) => {
        await writeNumberAt(x, 0, 'float64', column);
        await writeNumberAt(y, 0, 'float64', row);
        await GTIFImageToPCS(gtif, x, y);
        return [await readNumberAt(x, 0, 'float64'), await readNumberAt(y, 0, 'float64')];
    };
    const [west, north] = await place(0, 0);
    const [east, south] = await place(1, 1);
    console.log(`tiepoint: pixel 0, 0 is at ${west}, ${north}; pixel scale: ${east - west} x ${north - south}`);
    await GTIFFree(gtif);
}
