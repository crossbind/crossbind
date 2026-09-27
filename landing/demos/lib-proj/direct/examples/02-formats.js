export const imports = {
    '@crossbind/port-proj/proj.h': [
        'proj_context_create',
        'proj_context_destroy',
        'proj_context_errno',
        'proj_context_errno_string',
        'proj_create',
        'proj_destroy',
        'proj_get_id_auth_name',
        'proj_get_id_code',
        'proj_get_name',
        'proj_as_proj_string',
        'proj_as_wkt',
        'proj_as_projjson',
        'PJ_PROJ_STRING_TYPE',
        'PJ_WKT_TYPE',
    ],
};
export const note = 'The same calls as the C++: every exporter returns a `const char *`, which arrives as a JavaScript string, and enum values cross one member at a time (`await PJ_WKT_TYPE.PJ_WKT1_ESRI`). The options are a `const char *const *` list, `null` for the defaults; to pass some, write `cstring`s into an `allocPointer` array and leave its last slot empty. The context and the CRS are destroyed by hand.';
export const expected = [
    'EPSG:32635 WGS 84 / UTM zone 35N',
    '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs +type=crs',
    'PROJCRS["WGS 84 / UTM zone 35N",',
    'PROJCS["WGS_1984_UTM_Zone_35N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
    'ProjectedCRS Transverse Mercator 0 27 0.9996 500000 0',
];

export default async function example({ proj_context_create, proj_context_destroy, proj_context_errno, proj_context_errno_string, proj_create, proj_destroy, proj_get_id_auth_name, proj_get_id_code, proj_get_name, proj_as_proj_string, proj_as_wkt, proj_as_projjson, PJ_PROJ_STRING_TYPE, PJ_WKT_TYPE }, console) {
    const context = await proj_context_create();
    const utm = await proj_create(context, 'EPSG:32635');
    if (!utm) throw new Error(await proj_context_errno_string(context, await proj_context_errno(context)));
    console.log(`${await proj_get_id_auth_name(utm, 0)}:${await proj_get_id_code(utm, 0)} ${await proj_get_name(utm)}`);
    console.log(await proj_as_proj_string(context, utm, await PJ_PROJ_STRING_TYPE.PJ_PROJ_5, null));
    console.log((await proj_as_wkt(context, utm, await PJ_WKT_TYPE.PJ_WKT2_2019, null)).split('\n')[0]); // the first line of WKT2
    console.log(await proj_as_wkt(context, utm, await PJ_WKT_TYPE.PJ_WKT1_ESRI, null)); // the text of a shapefile's .prj
    const json = JSON.parse(await proj_as_projjson(context, utm, null));
    console.log(json.type, json.conversion.method.name, json.conversion.parameters.map((parameter) => parameter.value).join(' '));
    await proj_destroy(utm);
    await proj_context_destroy(context);
}
