export const title = 'Read where a CRS applies and the order of its axes';
export const summary = "proj_get_area_of_use gives the region EPSG defines a CRS for, as a bounding box in degrees and a description. proj_crs_get_coordinate_system and proj_cs_get_axis_info give the axis order, which is latitude first for EPSG:4326 and northing first for Poland's grid.";
export const native = 'crs_usage.h';
export const expected = [
    'EPSG:4326: Lat north (degree), Lon east (degree) | World. -180 -90 180 90',
    'EPSG:2180: x north (metre), y east (metre) | Poland - onshore and offshore. 14.14 49 24.15 55.93',
    'EPSG:2056: E east (metre), N north (metre) | Liechtenstein; Switzerland. 5.95 45.81 10.5 47.81',
];

export default async function example({ CrsUsage }, console) {
    for (const code of ['EPSG:4326', 'EPSG:2180', 'EPSG:2056']) {
        const crs = await new CrsUsage(code);
        const axes = JSON.parse(await crs.axes()).map(([, abbreviation, direction, unit]) => `${abbreviation} ${direction} (${unit})`);
        const [west, south, east, north, description] = JSON.parse(await crs.areaOfUse());
        console.log(`${code}: ${axes.join(', ')} | ${description} ${west} ${south} ${east} ${north}`);
    }
}
