export const imports = {
    '@crossbind/port-proj/proj.h': [
        'proj_context_create',
        'proj_context_destroy',
        'proj_context_errno',
        'proj_context_errno_string',
        'proj_create_crs_to_crs',
        'proj_normalize_for_visualization',
        'proj_get_name',
        'proj_destroy',
        'proj_trans_generic',
        'proj_errno',
        'PJ_DIRECTION',
        'allocBuffer',
        'writeNumberAt',
        'readNumberAt',
    ],
};
export const note = '`proj_trans` takes and returns the `PJ_COORD` union by value, and crossbind binds it as a class without members, so JavaScript cannot read the result: the point goes through `proj_trans_generic` instead, as two one-element `double` arrays. PROJ explains a failure only through its log callback, and a JavaScript function cannot cross into the worker, so the error text is `proj_context_errno_string`\'s, such as "Unknown error (code 4096)" for an unknown EPSG code, while PROJ\'s own message ("crs not found: EPSG:99999") goes to the console.';
export const expected = ['UTM zone 35N', '666370.51 4541552.49', '28.978400 41.008200', 'Popular Visualisation Pseudo-Mercator', '3225860.73 5013551.24'];

export default async function example({ proj_context_create, proj_context_destroy, proj_context_errno, proj_context_errno_string, proj_create_crs_to_crs, proj_normalize_for_visualization, proj_get_name, proj_destroy, proj_trans_generic, proj_errno, PJ_DIRECTION, allocBuffer, writeNumberAt, readNumberAt }, console) {
    const context = await proj_context_create();
    // The operation PROJ picks, and its name; the normalized copy takes longitude or easting first.
    const transformer = async (source, target) => {
        const chosen = await proj_create_crs_to_crs(context, source, target, null);
        if (!chosen) throw new Error(await proj_context_errno_string(context, await proj_context_errno(context)));
        const name = await proj_get_name(chosen);
        const normalized = await proj_normalize_for_visualization(context, chosen);
        await proj_destroy(chosen);
        return [normalized, name];
    };
    const x = await allocBuffer(8); // one double each
    const y = await allocBuffer(8);
    const transform = async (operation, direction, first, second) => {
        await writeNumberAt(x, 0, 'float64', first);
        await writeNumberAt(y, 0, 'float64', second);
        await proj_trans_generic(operation, direction, x, 8, 1, y, 8, 1, null, 0, 0, null, 0, 0);
        const point = [await readNumberAt(x, 0, 'float64'), await readNumberAt(y, 0, 'float64')];
        if (point[0] === Infinity) throw new Error(await proj_context_errno_string(context, await proj_errno(operation)));
        return point;
    };
    const forward = await PJ_DIRECTION.PJ_FWD;
    const inverse = await PJ_DIRECTION.PJ_INV;

    const [toUtm, utmName] = await transformer('EPSG:4326', 'EPSG:32635'); // WGS 84 to UTM zone 35N
    console.log(utmName);
    const [easting, northing] = await transform(toUtm, forward, 28.9784, 41.0082); // Istanbul, longitude first
    console.log(easting.toFixed(2), northing.toFixed(2));
    const [longitude, latitude] = await transform(toUtm, inverse, easting, northing);
    console.log(longitude.toFixed(6), latitude.toFixed(6));
    const [toWebMap, webMapName] = await transformer('EPSG:4326', 'EPSG:3857'); // WGS 84 to Web Mercator
    console.log(webMapName);
    const [mapX, mapY] = await transform(toWebMap, forward, 28.9784, 41.0082);
    console.log(mapX.toFixed(2), mapY.toFixed(2));
    await proj_destroy(toUtm);
    await proj_destroy(toWebMap);
    await proj_context_destroy(context);
}
