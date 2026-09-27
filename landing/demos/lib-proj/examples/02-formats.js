export const title = 'Write a CRS as WKT, a .prj, PROJJSON or a PROJ string';
export const summary = "proj_create reads a CRS from an EPSG code or any definition; proj_as_wkt writes WKT2 or the ESRI WKT a shapefile's .prj holds, proj_as_projjson writes PROJJSON, and proj_as_proj_string the short PROJ string, which drops names and the area of use.";
export const native = 'crs_formats.h';
export const expected = [
    'EPSG:32635 WGS 84 / UTM zone 35N',
    '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs +type=crs',
    'PROJCRS["WGS 84 / UTM zone 35N",',
    'PROJCS["WGS_1984_UTM_Zone_35N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",27.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]',
    'ProjectedCRS Transverse Mercator 0 27 0.9996 500000 0',
];

export default async function example({ CrsFormats }, console) {
    const utm = await new CrsFormats('EPSG:32635');
    console.log(await utm.label());
    console.log(await utm.projString());
    console.log((await utm.wkt()).split('\n')[0]); // the first line of WKT2
    console.log(await utm.esriWkt()); // the text of a shapefile's .prj
    const json = JSON.parse(await utm.projJson());
    console.log(json.type, json.conversion.method.name, json.conversion.parameters.map((parameter) => parameter.value).join(' '));
}
