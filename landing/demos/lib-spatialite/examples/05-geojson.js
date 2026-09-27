export const title = 'Read GeoJSON in and write a FeatureCollection out';
export const summary =
    "`GeomFromGeoJSON` reads a GeoJSON geometry into a SpatiaLite geometry, and `AsGeoJSON` writes one back rounded to the decimals you ask for. SQLite's JSON functions wrap the rows into a FeatureCollection that Leaflet, MapLibre or OpenLayers load as it is.";
export const native = 'geojson_layer.h';
export const expected = [
    '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"name":"Galata Tower"},"geometry":{"type":"Point","coordinates":[28.97413,41.02564]}},{"type":"Feature","properties":{"name":"Galata Bridge"},"geometry":{"type":"LineString","coordinates":[[28.97336,41.01963],[28.97139,41.02402]]}}]}',
];

export default async function example({ GeoJsonLayer }, console) {
    const layer = await new GeoJsonLayer();
    await layer.add('Galata Tower', '{"type":"Point","coordinates":[28.974128,41.025638]}');
    await layer.add('Galata Bridge', '{"type":"LineString","coordinates":[[28.973364,41.019634],[28.971392,41.024021]]}');
    console.log(await layer.featureCollection(5));
}
