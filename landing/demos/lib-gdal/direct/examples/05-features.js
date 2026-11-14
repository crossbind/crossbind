export const imports = {
    '@crossbind/port-gdal/gdal.h': [
        'GDALOpenEx',
        'GDAL_OF_VECTOR',
        'GDALDatasetGetLayer',
        'GDALClose',
        'allocBuffer',
        'allocPointer',
        'writeBytes',
        'writePointerAt',
        'readPointerAt',
        'cstring',
        'readCString',
    ],
    '@crossbind/port-gdal/ogrsf_frmts.h': ['RegisterOGRCSV'],
    '@crossbind/port-gdal/ogr_api.h': [
        'OGR_L_GetLayerDefn',
        'OGR_L_GetName',
        'OGR_L_GetFeatureCount',
        'OGR_L_GetGeomType',
        'OGR_FD_GetFieldCount',
        'OGR_FD_GetFieldDefn',
        'OGR_Fld_GetNameRef',
        'OGR_Fld_GetType',
        'OGR_GetFieldTypeName',
        'OGR_L_SetAttributeFilter',
        'OGR_L_SetSpatialFilterRect',
        'OGR_L_ResetReading',
        'OGR_L_GetNextFeature',
        'OGR_F_GetFieldCount',
        'OGR_F_GetFieldAsString',
        'OGR_F_GetGeometryRef',
        'OGR_G_ExportToWkt',
        'OGR_F_Destroy',
    ],
    '@crossbind/port-gdal/ogr_core.h': ['OGRGeometryTypeToName', 'OGRERR_NONE'],
    '@crossbind/port-gdal/cpl_vsi.h': ['VSIFileFromMemBuffer', 'VSIFCloseL', 'VSIUnlink', 'VSIFree'],
    '@crossbind/port-gdal/cpl_error.h': ['CPLGetLastErrorMsg'],
};
export const note = 'The same OGR calls the C++ makes. The CSV goes into `/vsimem` with `VSIFileFromMemBuffer` over an `allocBuffer` block that JavaScript keeps until the file is unlinked, `OGR_L_GetFeatureCount` returns a `GIntBig` that arrives as a BigInt, and `OGR_G_ExportToWkt` writes its `char *` into an `allocPointer` slot, read with `readCString` and freed with `VSIFree`, which `CPLFree` names. The spatial filter builds a GEOS prepared geometry, so this module links GEOS (see the configuration above).';
export const expected = [
    'sensors: 6 features of Point, fields id Integer, kind String, reading Real',
    '1 air 31.5 POINT (28.9784 41.0082)',
    '3 water 22.7 POINT (27.1428 38.4237)',
    '6 air 27.3 POINT (29.061 40.1885)',
];

export default async function example({ RegisterOGRCSV, GDALOpenEx, GDAL_OF_VECTOR, GDALDatasetGetLayer, GDALClose, allocBuffer, allocPointer, writeBytes, writePointerAt, readPointerAt, cstring, readCString, OGR_L_GetLayerDefn, OGR_L_GetName, OGR_L_GetFeatureCount, OGR_L_GetGeomType, OGR_FD_GetFieldCount, OGR_FD_GetFieldDefn, OGR_Fld_GetNameRef, OGR_Fld_GetType, OGR_GetFieldTypeName, OGR_L_SetAttributeFilter, OGR_L_SetSpatialFilterRect, OGR_L_ResetReading, OGR_L_GetNextFeature, OGR_F_GetFieldCount, OGR_F_GetFieldAsString, OGR_F_GetGeometryRef, OGR_G_ExportToWkt, OGR_F_Destroy, OGRGeometryTypeToName, OGRERR_NONE, VSIFileFromMemBuffer, VSIFCloseL, VSIUnlink, VSIFree, CPLGetLastErrorMsg }, console) {
    await RegisterOGRCSV();
    const csv = [
        'id,kind,reading,lon,lat',
        '1,air,31.5,28.9784,41.0082',
        '2,air,18.2,32.8597,39.9334',
        '3,water,22.7,27.1428,38.4237',
        '4,air,12.9,39.7168,41.0027',
        '5,water,19.4,30.7133,36.8969',
        '6,air,27.3,29.0610,40.1885',
    ].join('\n');
    // The file reads this block in place, so it stays allocated until the file is unlinked.
    const path = '/vsimem/sensors.csv';
    const bytes = await allocBuffer(csv.length);
    await writeBytes(bytes, csv);
    await VSIFCloseL(await VSIFileFromMemBuffer(path, bytes, csv.length, 0));
    // A NULL-terminated list of strings, as GDAL's option parameters take them.
    const list = async (items) => {
        const argv = await allocPointer(items.length + 1);
        for (const [i, item] of items.entries()) await writePointerAt(argv, i, await cstring(item));
        return argv;
    };
    // The CSV driver turns the lon and lat columns into points.
    const openOptions = await list(['X_POSSIBLE_NAMES=lon', 'Y_POSSIBLE_NAMES=lat', 'KEEP_GEOM_COLUMNS=NO', 'AUTODETECT_TYPE=YES']);
    const dataset = await GDALOpenEx(path, await GDAL_OF_VECTOR, null, openOptions, null);
    if (!dataset) throw new Error(await CPLGetLastErrorMsg());
    const layer = await GDALDatasetGetLayer(dataset, 0);
    const schema = await OGR_L_GetLayerDefn(layer);
    const fields = [];
    for (let i = 0; i < (await OGR_FD_GetFieldCount(schema)); i++) {
        const field = await OGR_FD_GetFieldDefn(schema, i);
        fields.push(`${await OGR_Fld_GetNameRef(field)} ${await OGR_GetFieldTypeName(await OGR_Fld_GetType(field))}`);
    }
    const type = await OGRGeometryTypeToName(await OGR_L_GetGeomType(layer));
    console.log(`${await OGR_L_GetName(layer)}: ${await OGR_L_GetFeatureCount(layer, 1)} features of ${type}, fields ${fields.join(', ')}`);

    // readings above 20 between 26 and 31 degrees east, 36 and 42 degrees north
    if ((await OGR_L_SetAttributeFilter(layer, 'reading > 20')) !== (await OGRERR_NONE)) throw new Error(await CPLGetLastErrorMsg());
    await OGR_L_SetSpatialFilterRect(layer, 26, 36, 31, 42);
    await OGR_L_ResetReading(layer);
    const wkt = await allocPointer(1); // OGR_G_ExportToWkt writes the address of the text it allocates here
    for (let feature; (feature = await OGR_L_GetNextFeature(layer)); await OGR_F_Destroy(feature)) {
        const values = [];
        for (let i = 0; i < (await OGR_F_GetFieldCount(feature)); i++) values.push(await OGR_F_GetFieldAsString(feature, i));
        await OGR_G_ExportToWkt(await OGR_F_GetGeometryRef(feature), wkt);
        const text = await readPointerAt(wkt, 0);
        console.log(`${values.join(' ')} ${await readCString(text)}`);
        await VSIFree(text);
    }
    await GDALClose(dataset);
    await VSIUnlink(path);
}
