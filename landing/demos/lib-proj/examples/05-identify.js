export const title = 'Find the EPSG code of a .prj, and the UTM zone of a point';
export const summary = "A shapefile's .prj names no EPSG code. proj_identify matches it against the registry, with a confidence that drops when names are missing, as in a PROJ string. proj_get_crs_info_list_from_database lists the CRSs whose area of use contains a point.";
export const native = 'crs_lookup.h';
export const expected = [
    'EPSG:32635 WGS 84 / UTM zone 35N, confidence 100',
    'EPSG:32635 WGS 84 / UTM zone 35N, confidence 70',
    'Istanbul: EPSG:32635 WGS 84 / UTM zone 35N',
    'Sydney: EPSG:32756 WGS 84 / UTM zone 56S',
];

export default async function example({ CrsLookup }, console) {
    const prj =
        'PROJCS["WGS_1984_UTM_Zone_35N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
    for (const definition of [prj, '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs +type=crs']) {
        const [[code, name, confidence]] = JSON.parse(await CrsLookup.identify(definition)); // the best match
        console.log(`${code} ${name}, confidence ${confidence}`);
    }
    for (const [place, lat, lon] of [['Istanbul', 41.0082, 28.9784], ['Sydney', -33.8688, 151.2093]]) {
        const [[code, name]] = JSON.parse(await CrsLookup.projectedAt(lat, lon, 'WGS 84 / UTM zone'));
        console.log(`${place}: ${code} ${name}`);
    }
}
