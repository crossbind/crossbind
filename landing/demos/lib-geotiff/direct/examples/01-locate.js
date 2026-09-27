export const imports = {
    '@crossbind/port-geotiff/geotiff.h': [
        'GTIFNewSimpleTags',
        'GTIFImport',
        'GTIFKeyCode',
        'GTIFKeyGetSHORT',
        'GTIFImageToPCS',
        'GTIFFree',
        'allocBuffer',
        'allocPointer',
        'readPointerAt',
        'readCString',
        'readNumberAt',
        'writeNumberAt',
        'writeBytes',
        'releaseCallback',
    ],
    '@crossbind/port-geotiff/geo_normalize.h': ['GTIFAllocDefn', 'GTIFGetDefn', 'GTIFProj4ToLatLong', 'GTIFGetPCSInfo', 'GTIFFreeMemory', 'GTIFFreeDefn'],
};
export const note = 'JavaScript cannot write the file: `TIFFSetField` and `GTIFKeySet` are variadic and have no binding. It gives libgeotiff the same tags and keys as listgeo text instead, which `GTIFImport` reads through a callback (hence `useWorker: false`) into in-memory tags; the `ST_TIFF` that `ST_Create` returns is refused as the `void *` of `GTIFNewSimpleTags`, so a zeroed buffer stands in. `geokey_t` is bound without its keys and `GTIFDefn` without its fields, so a key crosses as `{ value: code }` and the EPSG code is read from the key; no file size, image size (`TIFFGetField` is variadic too) or version (a macro) comes back. On a real file `XTIFFOpen` and `GTIFNew` replace the import and the rest runs unchanged, over the worker as well.';
export const expected = [
    'EPSG:32633 WGS 84 / UTM zone 33N, 100 x 100 pixels',
    'upper left 500000, 4650000 = 15.000000 E, 42.002015 N',
    'lower right 503000, 4647000 = 15.036210 E, 41.974990 N',
];
export const init = { useWorker: false };

export default async function example({ GTIFNewSimpleTags, GTIFImport, GTIFKeyCode, GTIFKeyGetSHORT, GTIFImageToPCS, GTIFFree, allocBuffer, allocPointer, readPointerAt, readCString, readNumberAt, writeNumberAt, writeBytes, releaseCallback, GTIFAllocDefn, GTIFGetDefn, GTIFProj4ToLatLong, GTIFGetPCSInfo, GTIFFreeMemory, GTIFFreeDefn }, console) {
    // 100 x 100 pixels of 30 m in WGS 84 / UTM zone 33N (EPSG:32633), the upper-left corner at
    // 500000, 4650000: the GeoTIFF's tags and keys in the format listgeo prints them
    const [width, height] = [100, 100];
    const lines = `Geotiff_Information:
        Version: 1
        Key_Revision: 1.0
        Tagged_Information:
            ModelTiepointTag (2,3):
                0 0 0
                500000 4650000 0
            ModelPixelScaleTag (1,3):
                30 30 0
            End_Of_Tags.
        Keyed_Information:
            GTModelTypeGeoKey (Short,1): ModelTypeProjected
            GTRasterTypeGeoKey (Short,1): RasterPixelIsArea
            ProjectedCSTypeGeoKey (Short,1): PCS_WGS84_UTM_zone_33N
            End_Of_Keys.
        End_Of_Geotiff.`.split('\n');
    const readLine = (buffer) => {
        writeBytes(buffer, `${lines.shift().trim()}\0`); // one line per call, as C text
        return 1;
    };
    const tags = await allocBuffer(16); // zeroed memory is an empty ST_TIFF
    const gtif = await GTIFNewSimpleTags(tags);
    if (!(await GTIFImport(gtif, readLine, null))) throw new Error('GTIFImport could not read the text');
    await releaseCallback(readLine);

    const code = await allocBuffer(2);
    await GTIFKeyGetSHORT(gtif, { value: await GTIFKeyCode('ProjectedCSTypeGeoKey') }, code, 0, 1);
    const epsg = await readNumberAt(code, 0, 'uint16');
    const name = await allocPointer(1);
    await GTIFGetPCSInfo(epsg, name, null, null, null);
    const text = await readPointerAt(name, 0);
    console.log(`EPSG:${epsg} ${await readCString(text)}, ${width} x ${height} pixels`);
    await GTIFFreeMemory(text);

    const defn = await GTIFAllocDefn();
    await GTIFGetDefn(gtif, defn);
    const [x, y] = [await allocBuffer(8), await allocBuffer(8)];
    for (const [corner, column, row] of [['upper left', 0, 0], ['lower right', width, height]]) {
        await writeNumberAt(x, 0, 'float64', column);
        await writeNumberAt(y, 0, 'float64', row);
        await GTIFImageToPCS(gtif, x, y);
        const map = [await readNumberAt(x, 0, 'float64'), await readNumberAt(y, 0, 'float64')];
        await GTIFProj4ToLatLong(defn, 1, x, y); // in place: x becomes longitude, y latitude
        const [lon, lat] = [await readNumberAt(x, 0, 'float64'), await readNumberAt(y, 0, 'float64')];
        console.log(`${corner} ${map.join(', ')} = ${lon.toFixed(6)} E, ${lat.toFixed(6)} N`);
    }
    await GTIFFreeDefn(defn);
    await GTIFFree(gtif);
}
