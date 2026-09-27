export const title = 'Read features and filter them by attribute and area';
export const summary = 'OGR reads every vector format through one API: the schema from OGR_L_GetLayerDefn, then OGR_L_GetNextFeature over the features that pass OGR_L_SetAttributeFilter, a SQL WHERE clause, and OGR_L_SetSpatialFilterRect. Open options turn the lon and lat columns of a CSV into points.';
export const native = 'feature_query.h';
export const expected = [
    'sensors: 6 features of Point, fields id Integer, kind String, reading Real',
    '1 air 31.5 POINT (28.9784 41.0082)',
    '3 water 22.7 POINT (27.1428 38.4237)',
    '6 air 27.3 POINT (29.061 40.1885)',
];

export default async function example({ FeatureQuery }, console) {
    const csv = [
        'id,kind,reading,lon,lat',
        '1,air,31.5,28.9784,41.0082',
        '2,air,18.2,32.8597,39.9334',
        '3,water,22.7,27.1428,38.4237',
        '4,air,12.9,39.7168,41.0027',
        '5,water,19.4,30.7133,36.8969',
        '6,air,27.3,29.0610,40.1885',
    ].join('\n');
    const query = await new FeatureQuery();
    // readings above 20 between 26 and 31 degrees east, 36 and 42 degrees north
    const found = await query.select(csv, 'reading > 20', 26, 36, 31, 42);
    for (const line of found.split('\n')) console.log(line);
}
