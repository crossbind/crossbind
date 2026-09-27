export const imports = {
    '@crossbind/port-proj/proj.h': [
        'proj_context_create',
        'proj_context_destroy',
        'proj_context_errno',
        'proj_context_errno_string',
        'proj_create',
        'proj_destroy',
        'proj_identify',
        'proj_create_from_name',
        'proj_list_get_count',
        'proj_list_get',
        'proj_list_destroy',
        'proj_int_list_destroy',
        'proj_get_id_auth_name',
        'proj_get_id_code',
        'proj_get_name',
        'proj_is_deprecated',
        'proj_get_area_of_use',
        'PJ_TYPE',
        'allocBuffer',
        'allocPointer',
        'readPointerAt',
        'readNumberAt',
        'writeNumberAt',
    ],
};
export const note = '`proj_identify` hands its confidences back through an `int **`: JavaScript passes an `allocPointer` slot, reads the array PROJ put there with `readNumberAt` and frees it with `proj_int_list_destroy`. The point search cannot use `proj_get_crs_info_list_from_database` as the C++ does: its filter is a `PROJ_CRS_LIST_PARAMETERS` struct whose fields crossbind does not bind, so values set from JavaScript never reach PROJ, and a handle in its place is refused ("Expected null or instance of PROJ_CRS_LIST_PARAMETERS"). The candidates come from `proj_create_from_name` instead, and JavaScript checks each area of use itself.';
export const expected = [
    'EPSG:32635 WGS 84 / UTM zone 35N, confidence 100',
    'EPSG:32635 WGS 84 / UTM zone 35N, confidence 70',
    'Istanbul: EPSG:32635 WGS 84 / UTM zone 35N',
    'Sydney: EPSG:32756 WGS 84 / UTM zone 56S',
];

export default async function example({ proj_context_create, proj_context_destroy, proj_context_errno, proj_context_errno_string, proj_create, proj_destroy, proj_identify, proj_create_from_name, proj_list_get_count, proj_list_get, proj_list_destroy, proj_int_list_destroy, proj_get_id_auth_name, proj_get_id_code, proj_get_name, proj_is_deprecated, proj_get_area_of_use, PJ_TYPE, allocBuffer, allocPointer, readPointerAt, readNumberAt, writeNumberAt }, console) {
    const context = await proj_context_create();
    const label = async (crs) => `${await proj_get_id_auth_name(crs, 0)}:${await proj_get_id_code(crs, 0)} ${await proj_get_name(crs)}`;
    const prj =
        'PROJCS["WGS_1984_UTM_Zone_35N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
    const confidences = await allocPointer(1); // int **
    for (const definition of [prj, '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs +type=crs']) {
        const crs = await proj_create(context, definition);
        if (!crs) throw new Error(await proj_context_errno_string(context, await proj_context_errno(context)));
        const matches = await proj_identify(context, crs, 'EPSG', null, confidences);
        const confidence = await readPointerAt(confidences, 0); // an int array PROJ allocated
        const best = await proj_list_get(context, matches, 0); // the best match comes first
        console.log(`${await label(best)}, confidence ${await readNumberAt(confidence, 0, 'int32')}`);
        await proj_destroy(best);
        await proj_int_list_destroy(confidence);
        await proj_list_destroy(matches);
        await proj_destroy(crs);
    }

    // Projected CRSs named like 'WGS 84 / UTM zone'. The search is approximate, so the names are checked again.
    const types = await allocBuffer(4); // a PJ_TYPE array of one
    await writeNumberAt(types, 0, 'int32', (await PJ_TYPE.PJ_TYPE_PROJECTED_CRS).value);
    const found = await proj_create_from_name(context, 'EPSG', 'WGS 84 / UTM zone', types, 1, 1, 0, null);
    const zones = [];
    const count = await proj_list_get_count(found);
    for (let index = 0; index < count; index += 1) {
        const crs = await proj_list_get(context, found, index);
        if ((await proj_get_name(crs)).includes('WGS 84 / UTM zone') && !(await proj_is_deprecated(crs))) zones.push(crs);
        else await proj_destroy(crs);
    }
    await proj_list_destroy(found);
    const west = await allocBuffer(8); // double *
    const south = await allocBuffer(8);
    const east = await allocBuffer(8);
    const north = await allocBuffer(8);
    const degrees = async (slot) => readNumberAt(slot, 0, 'float64');
    const contains = async (crs, lat, lon) => {
        if (!(await proj_get_area_of_use(context, crs, west, south, east, north, null))) return false;
        const [w, s, e, n] = [await degrees(west), await degrees(south), await degrees(east), await degrees(north)];
        return w <= lon && lon <= e && s <= lat && lat <= n;
    };
    for (const [place, lat, lon] of [['Istanbul', 41.0082, 28.9784], ['Sydney', -33.8688, 151.2093]]) {
        for (const crs of zones) {
            if (await contains(crs, lat, lon)) {
                console.log(`${place}: ${await label(crs)}`);
                break;
            }
        }
    }
    for (const crs of zones) await proj_destroy(crs);
    await proj_context_destroy(context);
}
