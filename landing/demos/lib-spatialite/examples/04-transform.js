export const title = 'Reproject coordinates between EPSG codes';
export const summary =
    '`ST_Transform` moves a geometry to another reference system through PROJ, which reads the `proj.db` the build preloads. `InitSpatialMetaData(1)` registers the 6,559 EPSG codes SpatiaLite knows in `spatial_ref_sys`, where their names are too.';
export const native = 'reproject.h';
export const expected = [
    'WGS 84 / Pseudo-Mercator: POINT(3225860.732004 5013551.237223)',
    'WGS 84 / UTM zone 35N: POINT(666370.505017 4541552.487191)',
    'back to WGS 84: POINT(28.9784 41.0082)',
];

export default async function example({ Reprojector }, console) {
    const reprojector = await new Reprojector();
    const istanbul = 'POINT(28.9784 41.0082)';
    for (const srid of [3857, 32635]) console.log(`${await reprojector.srsName(srid)}: ${await reprojector.transform(istanbul, 4326, srid)}`);
    const utm = await reprojector.transform(istanbul, 4326, 32635);
    console.log(`back to ${await reprojector.srsName(4326)}: ${await reprojector.transform(utm, 32635, 4326)}`);
}
