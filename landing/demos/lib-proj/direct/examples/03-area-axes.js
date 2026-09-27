export const imports = {
    '@crossbind/port-proj/proj.h': [
        'proj_context_create',
        'proj_context_destroy',
        'proj_context_errno',
        'proj_context_errno_string',
        'proj_create',
        'proj_destroy',
        'proj_crs_get_coordinate_system',
        'proj_cs_get_axis_count',
        'proj_cs_get_axis_info',
        'proj_get_area_of_use',
        'allocBuffer',
        'allocPointer',
        'readNumberAt',
        'readPointerAt',
        'readCString',
    ],
};
export const note = 'Both calls answer through out-parameters, which JavaScript allocates: an 8-byte `allocBuffer` for each `double *`, read with `readNumberAt`, and an `allocPointer` slot for each `const char **`, read with `readPointerAt` and `readCString`. `null` skips the ones not needed. The strings stay owned by PROJ, and the coordinate system and the CRS are destroyed by hand.';
export const expected = [
    'EPSG:4326: Lat north (degree), Lon east (degree) | World. -180 -90 180 90',
    'EPSG:2180: x north (metre), y east (metre) | Poland - onshore and offshore. 14.14 49 24.15 55.93',
    'EPSG:2056: E east (metre), N north (metre) | Liechtenstein; Switzerland. 5.95 45.81 10.5 47.81',
];

export default async function example({ proj_context_create, proj_context_destroy, proj_context_errno, proj_context_errno_string, proj_create, proj_destroy, proj_crs_get_coordinate_system, proj_cs_get_axis_count, proj_cs_get_axis_info, proj_get_area_of_use, allocBuffer, allocPointer, readNumberAt, readPointerAt, readCString }, console) {
    const context = await proj_context_create();
    const west = await allocBuffer(8); // double *
    const south = await allocBuffer(8);
    const east = await allocBuffer(8);
    const north = await allocBuffer(8);
    const area = await allocPointer(1); // const char **
    const abbreviation = await allocPointer(1);
    const direction = await allocPointer(1);
    const unit = await allocPointer(1);
    const degrees = async (slot) => readNumberAt(slot, 0, 'float64');
    const text = async (slot) => readCString(await readPointerAt(slot, 0));
    for (const code of ['EPSG:4326', 'EPSG:2180', 'EPSG:2056']) {
        const crs = await proj_create(context, code);
        if (!crs) throw new Error(await proj_context_errno_string(context, await proj_context_errno(context)));
        const system = await proj_crs_get_coordinate_system(context, crs);
        const axes = [];
        const count = await proj_cs_get_axis_count(context, system);
        for (let index = 0; index < count; index += 1) {
            await proj_cs_get_axis_info(context, system, index, null, abbreviation, direction, null, unit, null, null);
            axes.push(`${await text(abbreviation)} ${await text(direction)} (${await text(unit)})`);
        }
        if (!(await proj_get_area_of_use(context, crs, west, south, east, north, area))) throw new Error(`${code} has no area of use`);
        const box = [await degrees(west), await degrees(south), await degrees(east), await degrees(north)];
        console.log(`${code}: ${axes.join(', ')} | ${await text(area)} ${box.join(' ')}`);
        await proj_destroy(system);
        await proj_destroy(crs);
    }
    await proj_context_destroy(context);
}
