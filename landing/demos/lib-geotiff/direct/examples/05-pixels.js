export const imports = {
    '@crossbind/port-geotiff/geotiff.h': ['GTIFNewSimpleTags', 'GTIFImport', 'GTIFImageToPCS', 'GTIFPCSToImage', 'GTIFFree', 'allocBuffer', 'readNumberAt', 'writeNumberAt', 'writeBytes', 'releaseCallback'],
    '@crossbind/port-geotiff/geo_normalize.h': ['GTIFAllocDefn', 'GTIFGetDefn', 'GTIFProj4FromLatLong', 'GTIFProj4ToLatLong', 'GTIFFreeDefn'],
};
export const note = 'The same four conversions the C++ makes, on a definition `GTIFGetDefn` fills in C and JavaScript only passes on. The file itself cannot be written from JavaScript (`TIFFSetField` and `GTIFKeySet` are variadic and have no binding), so its tags and keys go in as the text listgeo prints, read by `GTIFImport` through a JavaScript callback, which is why the module runs on the page\'s thread.';
export const expected = ['Galata Tower: 665970.23, 4543502.03 m, pixel 159.702, 164.980', 'centre of pixel 159, 164: 665950, 4543550 m, 28.973939, 41.026269'];
export const init = { useWorker: false };

export default async function example({ GTIFNewSimpleTags, GTIFImport, GTIFImageToPCS, GTIFPCSToImage, GTIFFree, allocBuffer, readNumberAt, writeNumberAt, writeBytes, releaseCallback, GTIFAllocDefn, GTIFGetDefn, GTIFProj4FromLatLong, GTIFProj4ToLatLong, GTIFFreeDefn }, console) {
    // 300 x 300 pixels of 100 m over Istanbul in WGS 84 / UTM zone 35N, as listgeo prints its tags and keys
    const lines = `Geotiff_Information:
        Version: 1
        Key_Revision: 1.0
        Tagged_Information:
            ModelTiepointTag (2,3):
                0 0 0
                650000 4560000 0
            ModelPixelScaleTag (1,3):
                100 100 0
            End_Of_Tags.
        Keyed_Information:
            GTModelTypeGeoKey (Short,1): ModelTypeProjected
            GTRasterTypeGeoKey (Short,1): RasterPixelIsArea
            ProjectedCSTypeGeoKey (Short,1): PCS_WGS84_UTM_zone_35N
            End_Of_Keys.
        End_Of_Geotiff.`.split('\n');
    const readLine = (buffer) => {
        writeBytes(buffer, `${lines.shift().trim()}\0`); // one line per call, as C text
        return 1;
    };
    const gtif = await GTIFNewSimpleTags(await allocBuffer(16)); // zeroed memory is an empty tag list
    if (!(await GTIFImport(gtif, readLine, null))) throw new Error('GTIFImport could not read the text');
    await releaseCallback(readLine);
    const defn = await GTIFAllocDefn();
    if (!(await GTIFGetDefn(gtif, defn))) throw new Error('no coordinate system in the GeoKeys');

    const [x, y] = [await allocBuffer(8), await allocBuffer(8)]; // each function converts x and y in place
    const put = async (a, b) => {
        await writeNumberAt(x, 0, 'float64', a);
        await writeNumberAt(y, 0, 'float64', b);
    };
    const take = async () => [await readNumberAt(x, 0, 'float64'), await readNumberAt(y, 0, 'float64')];

    await put(28.974167, 41.025833); // Galata Tower, longitude and latitude
    await GTIFProj4FromLatLong(defn, 1, x, y);
    const map = await take();
    await GTIFPCSToImage(gtif, x, y);
    const pixel = await take();
    console.log(`Galata Tower: ${map.map((v) => v.toFixed(2)).join(', ')} m, pixel ${pixel.map((v) => v.toFixed(3)).join(', ')}`);

    const [column, row] = pixel.map(Math.floor);
    await put(column + 0.5, row + 0.5);
    await GTIFImageToPCS(gtif, x, y);
    const centre = await take();
    await GTIFProj4ToLatLong(defn, 1, x, y);
    const lonLat = await take();
    console.log(`centre of pixel ${column}, ${row}: ${centre.join(', ')} m, ${lonLat.map((v) => v.toFixed(6)).join(', ')}`);
    await GTIFFreeDefn(defn);
    await GTIFFree(gtif);
}
