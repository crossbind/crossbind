export const imports = {
    '@crossbind/port-geotiff/geotiff.h': ['GTIFNewSimpleTags', 'GTIFImport', 'GTIFKeyCode', 'GTIFKeyGetSHORT', 'GTIFValueNameEx', 'GTIFFree', 'allocBuffer', 'allocPointer', 'readPointerAt', 'readCString', 'readNumberAt', 'writeBytes', 'releaseCallback'],
    '@crossbind/port-geotiff/geo_normalize.h': ['GTIFGetPCSInfo', 'GTIFGetProjTRFInfo', 'GTIFGetGCSInfo', 'GTIFGetDatumInfo', 'GTIFGetEllipsoidInfo', 'GTIFGetPMInfo', 'GTIFGetUOMLengthInfo', 'GTIFAllocDefn', 'GTIFGetDefn', 'GTIFGetProj4Defn', 'GTIFFreeDefn', 'GTIFFreeMemory'],
};
export const note = '`GTIFGetDefn` fills a `GTIFDefn` that crossbind binds without its fields, so JavaScript walks the same EPSG lookups itself: `GTIFGetPCSInfo`, `GTIFGetProjTRFInfo`, `GTIFGetGCSInfo`, `GTIFGetDatumInfo`, `GTIFGetEllipsoidInfo`, `GTIFGetPMInfo` and `GTIFGetUOMLengthInfo`, each with its answers in out-parameters. Two things stay inside the definition: which GeoKey each projection parameter belongs to, so the parameters are missing, and the method\'s `CT_TransverseMercator` name, so it prints as its EPSG code, 9807. The keys go in as listgeo text through a callback, as in the first example.';
export const expected = [
    'ModelTypeProjected EPSG:27700 OSGB36 / British National Grid',
    'projection 19916 British National Grid, EPSG method 9807',
    'geographic 4277 OSGB36, datum 6277 Ordnance Survey of Great Britain 1936',
    'ellipsoid 7001 Airy 1830: 6377563.396 m, 6356256.909 m',
    'prime meridian 8901 Greenwich, unit 9001 metre (1 m)',
    '+proj=tmerc +lat_0=49.000000000 +lon_0=-2.000000000 +k=0.999601 +x_0=400000.000 +y_0=-100000.000 +a=6377563.396 +b=6356256.909 +units=m',
];
export const init = { useWorker: false };

export default async function example({ GTIFNewSimpleTags, GTIFImport, GTIFKeyCode, GTIFKeyGetSHORT, GTIFValueNameEx, GTIFFree, allocBuffer, allocPointer, readPointerAt, readCString, readNumberAt, writeBytes, releaseCallback, GTIFGetPCSInfo, GTIFGetProjTRFInfo, GTIFGetGCSInfo, GTIFGetDatumInfo, GTIFGetEllipsoidInfo, GTIFGetPMInfo, GTIFGetUOMLengthInfo, GTIFAllocDefn, GTIFGetDefn, GTIFGetProj4Defn, GTIFFreeDefn, GTIFFreeMemory }, console) {
    // A file that only says ProjectedCSTypeGeoKey = 27700, as listgeo prints its keys
    const lines = `Geotiff_Information:
        Version: 1
        Key_Revision: 1.0
        Tagged_Information:
            End_Of_Tags.
        Keyed_Information:
            GTModelTypeGeoKey (Short,1): ModelTypeProjected
            GTRasterTypeGeoKey (Short,1): RasterPixelIsArea
            ProjectedCSTypeGeoKey (Short,1): Code-27700
            End_Of_Keys.
        End_Of_Geotiff.`.split('\n');
    const readLine = (buffer) => {
        writeBytes(buffer, `${lines.shift().trim()}\0`);
        return 1;
    };
    const gtif = await GTIFNewSimpleTags(await allocBuffer(16));
    if (!(await GTIFImport(gtif, readLine, null))) throw new Error('GTIFImport could not read the text');
    await releaseCallback(readLine);

    // Every lookup answers through out-parameters: a C string, shorts and doubles.
    const name = await allocPointer(1);
    const [a, b, c] = [await allocBuffer(2), await allocBuffer(2), await allocBuffer(2)];
    const [first, second] = [await allocBuffer(8), await allocBuffer(8)];
    const text = async () => {
        const pointer = await readPointerAt(name, 0);
        const value = await readCString(pointer);
        await GTIFFreeMemory(pointer);
        return value;
    };
    const short = (buffer) => readNumberAt(buffer, 0, 'int16');
    const double = (buffer) => readNumberAt(buffer, 0, 'float64');
    const key = async (keyName) => ({ value: await GTIFKeyCode(keyName) });

    const model = await key('GTModelTypeGeoKey');
    await GTIFKeyGetSHORT(gtif, model, a, 0, 1);
    const modelName = await GTIFValueNameEx(gtif, model, await short(a));
    await GTIFKeyGetSHORT(gtif, await key('ProjectedCSTypeGeoKey'), a, 0, 1);
    const pcs = await short(a);
    await GTIFGetPCSInfo(pcs, name, a, b, c); // name, projection, length unit, geographic CRS
    console.log(`${modelName} EPSG:${pcs} ${await text()}`);
    const [projection, unit, gcs] = [await short(a), await short(b), await short(c)];
    await GTIFGetProjTRFInfo(projection, name, a, await allocBuffer(7 * 8));
    console.log(`projection ${projection} ${await text()}, EPSG method ${await short(a)}`);

    await GTIFGetGCSInfo(gcs, name, a, b, null); // name, datum, prime meridian
    const gcsName = await text();
    const [datum, pm] = [await short(a), await short(b)];
    await GTIFGetDatumInfo(datum, name, a); // name, ellipsoid
    console.log(`geographic ${gcs} ${gcsName}, datum ${datum} ${await text()}`);
    const ellipsoid = await short(a);
    await GTIFGetEllipsoidInfo(ellipsoid, name, first, second);
    console.log(`ellipsoid ${ellipsoid} ${await text()}: ${(await double(first)).toFixed(3)} m, ${(await double(second)).toFixed(3)} m`);
    await GTIFGetPMInfo(pm, name, null);
    const pmName = await text();
    await GTIFGetUOMLengthInfo(unit, name, first);
    console.log(`prime meridian ${pm} ${pmName}, unit ${unit} ${await text()} (${await double(first)} m)`);

    const defn = await GTIFAllocDefn();
    await GTIFGetDefn(gtif, defn);
    const proj = await GTIFGetProj4Defn(defn); // a C string GTIFFreeMemory releases
    console.log((await readCString(proj)).trim());
    await GTIFFreeMemory(proj);
    await GTIFFreeDefn(defn);
    await GTIFFree(gtif);
}
