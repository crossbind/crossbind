export const title = 'Convert GeoJSON to GeoPackage and Shapefile, reprojected';
export const summary = 'Format conversion is what GDAL is used for most, as the ogr2ogr tool: GDALVectorTranslate takes the same arguments, here -f for the format and -t_srs for the coordinate system. The input is text handed over through /vsimem/, and a zipped Shapefile is one file.';
export const native = 'vector_converter.h';
export const expected = [
    'GPKG: 3 features, EPSG:3857, extent 3021523 4639455 3657925 5013551',
    'ESRI Shapefile: 3 features, EPSG:32635, extent 512465 4252837 1000822 4541552',
];

export default async function example({ VectorConverter }, console) {
    const converter = await new VectorConverter();
    const cities = JSON.stringify({
        type: 'FeatureCollection',
        features: [
            ['Istanbul', 28.9784, 41.0082],
            ['Ankara', 32.8597, 39.9334],
            ['Izmir', 27.1428, 38.4237],
        ].map(([name, lon, lat]) => ({ type: 'Feature', properties: { name }, geometry: { type: 'Point', coordinates: [lon, lat] } })),
    });
    console.log(await converter.convert(cities, 'GPKG', 'EPSG:3857', '/vsimem/cities.gpkg'));
    console.log(await converter.convert(cities, 'ESRI Shapefile', 'EPSG:32635', '/vsimem/cities.shp.zip'));
}
