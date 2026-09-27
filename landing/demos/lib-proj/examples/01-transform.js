export const title = 'Transform a coordinate between two CRSs';
export const summary = 'The most used part of PROJ: proj_create_crs_to_crs picks the operation between two coordinate reference systems, proj_normalize_for_visualization puts longitude first, and proj_trans runs it forward or back.';
export const native = 'transformer.h';
export const expected = ['UTM zone 35N', '666370.51 4541552.49', '28.978400 41.008200', 'Popular Visualisation Pseudo-Mercator', '3225860.73 5013551.24'];

export default async function example({ Transformer }, console) {
    const toUtm = await new Transformer('EPSG:4326', 'EPSG:32635'); // WGS 84 to UTM zone 35N
    console.log(await toUtm.operation());
    const [easting, northing] = JSON.parse(await toUtm.forward(28.9784, 41.0082)); // Istanbul, longitude first
    console.log(easting.toFixed(2), northing.toFixed(2));
    const [longitude, latitude] = JSON.parse(await toUtm.inverse(easting, northing));
    console.log(longitude.toFixed(6), latitude.toFixed(6));
    const toWebMap = await new Transformer('EPSG:4326', 'EPSG:3857'); // WGS 84 to Web Mercator
    console.log(await toWebMap.operation());
    const [x, y] = JSON.parse(await toWebMap.forward(28.9784, 41.0082));
    console.log(x.toFixed(2), y.toFixed(2));
}
