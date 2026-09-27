export const title = 'Expand an EPSG code into a full definition';
export const summary = 'GTIFGetDefn normalises the GeoKeys through PROJ\'s EPSG database: from ProjectedCSTypeGeoKey alone it recovers the projection method and parameters, the datum, the ellipsoid and the unit. GTIFGetProj4Defn writes it as a PROJ string, with the scale factor rounded to six decimals.';
export const native = 'crs_definition.h';
export const expected = [
    'ModelTypeProjected EPSG:27700 OSGB36 / British National Grid',
    'projection 19916 British National Grid, CT_TransverseMercator',
    '  ProjNatOriginLatGeoKey 49',
    '  ProjNatOriginLongGeoKey -2',
    '  ProjScaleAtNatOriginGeoKey 0.9996012717',
    '  ProjFalseEastingGeoKey 400000',
    '  ProjFalseNorthingGeoKey -100000',
    'geographic 4277 OSGB36, datum 6277 Ordnance Survey of Great Britain 1936',
    'ellipsoid 7001 Airy 1830: 6377563.396 m, 6356256.909 m',
    'prime meridian 8901 Greenwich, unit 9001 metre (1 m)',
    '+proj=tmerc +lat_0=49.000000000 +lon_0=-2.000000000 +k=0.999601 +x_0=400000.000 +y_0=-100000.000 +a=6377563.396 +b=6356256.909 +units=m',
];

export default async function example({ CrsDefinition, GeoTiffLocator }, console) {
    // A file that only says ProjectedCSTypeGeoKey = 27700, written by the first example's class
    const tiff = await GeoTiffLocator.write(27700, 100, 100, 529000, 181000, 10);
    const crs = JSON.parse(await CrsDefinition.describe(tiff));
    console.log(`${crs.model} EPSG:${crs.pcs[0]} ${crs.pcs[1]}`);
    console.log(`projection ${crs.projection[0]} ${crs.projection[1]}, ${crs.method}`);
    for (const [name, value] of crs.parameters) console.log(`  ${name} ${value}`);
    console.log(`geographic ${crs.gcs.join(' ')}, datum ${crs.datum.join(' ')}`);
    console.log(`ellipsoid ${crs.ellipsoid.join(' ')}: ${crs.axes.map((axis) => axis.toFixed(3)).join(' m, ')} m`);
    console.log(`prime meridian ${crs.primeMeridian.join(' ')}, unit ${crs.unit.join(' ')} (${crs.metres} m)`);
    console.log(crs.proj.trim());
}
