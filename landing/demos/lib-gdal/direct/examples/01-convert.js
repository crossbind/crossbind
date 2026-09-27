export const imports = {
    '@crossbind/port-gdal/gdal.h': ['GDALAllRegister', 'GDALOpenEx', 'GDALClose', 'allocPointer', 'writePointerAt', 'cstring', 'readCString'],
    '@crossbind/port-gdal/gdal_utils.h': [
        'GDALVectorTranslateOptionsNew',
        'GDALVectorTranslateOptionsFree',
        'GDALVectorTranslate',
        'GDALVectorInfoOptionsNew',
        'GDALVectorInfoOptionsFree',
        'GDALVectorInfo',
    ],
    '@crossbind/port-gdal/cpl_vsi.h': ['VSIUnlink', 'VSIFree'],
    '@crossbind/port-gdal/cpl_error.h': ['CPLGetLastErrorMsg'],
};
export const note = 'The same `GDALVectorTranslate` and `GDALVectorInfo` calls the C++ makes. Their arguments are NULL-terminated string lists, which JavaScript builds with `allocPointer` and `cstring`, and flags that are macros, such as `GDAL_OF_VECTOR`, are written as numbers. The module is larger than the C++ one: binding `gdal.h` links `GDALAllRegister` and with it every driver, while the C++ version registers only the drivers it uses.';
export const expected = [
    'GPKG: 3 features, EPSG:3857, extent 3021523 4639455 3657925 5013551',
    'ESRI Shapefile: 3 features, EPSG:32635, extent 512465 4252837 1000822 4541552',
];

export default async function example({ GDALAllRegister, GDALOpenEx, GDALClose, allocPointer, writePointerAt, cstring, readCString, GDALVectorTranslateOptionsNew, GDALVectorTranslateOptionsFree, GDALVectorTranslate, GDALVectorInfoOptionsNew, GDALVectorInfoOptionsFree, GDALVectorInfo, VSIUnlink, VSIFree, CPLGetLastErrorMsg }, console) {
    await GDALAllRegister();
    const cities = JSON.stringify({
        type: 'FeatureCollection',
        features: [
            ['Istanbul', 28.9784, 41.0082],
            ['Ankara', 32.8597, 39.9334],
            ['Izmir', 27.1428, 38.4237],
        ].map(([name, lon, lat]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
    });
    // The GeoJSON driver opens the text itself. 4 is GDAL_OF_VECTOR, a macro, so it has no binding.
    const source = await GDALOpenEx(cities, 4, null, null, null);
    if (!source) throw new Error(await CPLGetLastErrorMsg());
    // A NULL-terminated list of strings, as GDAL's argv parameters take them.
    const list = async (items) => {
        const argv = await allocPointer(items.length + 1);
        for (const [i, item] of items.entries()) await writePointerAt(argv, i, await cstring(item));
        return argv;
    };
    const sources = await allocPointer(1);
    await writePointerAt(sources, 0, source);

    for (const [format, crs, path] of [['GPKG', 'EPSG:3857', '/vsimem/cities.gpkg'], ['ESRI Shapefile', 'EPSG:32635', '/vsimem/cities.shp.zip']]) {
        const options = await GDALVectorTranslateOptionsNew(await list(['-f', format, '-t_srs', crs]), null);
        await VSIUnlink(path); // replace the output of an earlier run
        const written = await GDALVectorTranslate(path, null, 1, sources, options, null);
        await GDALVectorTranslateOptionsFree(options);
        if (!written) throw new Error(await CPLGetLastErrorMsg());

        // ogrinfo's report, as JSON: the layer's feature count, extent and CRS
        const infoOptions = await GDALVectorInfoOptionsNew(await list(['-json', '-so']), null);
        const report = await GDALVectorInfo(written, infoOptions);
        const layer = JSON.parse(await readCString(report)).layers[0];
        await VSIFree(report);
        await GDALVectorInfoOptionsFree(infoOptions);
        await GDALClose(written);
        const { extent, coordinateSystem } = layer.geometryFields[0];
        const { authority, code } = coordinateSystem.projjson.id;
        console.log(`${format}: ${layer.featureCount} features, ${authority}:${code}, extent ${extent.map(Math.round).join(' ')}`);
    }
    await GDALClose(source);
}
