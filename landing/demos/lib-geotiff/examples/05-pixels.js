export const title = 'Convert between pixels and longitude, latitude';
export const summary = 'GTIFProj4FromLatLong and GTIFPCSToImage find the pixel under a longitude and latitude; GTIFImageToPCS and GTIFProj4ToLatLong go back from a pixel. The class keeps the file open between questions.';
export const native = 'pixel_position.h';
export const expected = [
    'Galata Tower: 665970.23, 4543502.03 m, pixel 159.702, 164.980',
    'centre of pixel 159, 164: 665950, 4543550 m, 28.973939, 41.026269',
];

export default async function example({ PixelPosition, GeoTiffLocator }, console) {
    // 300 x 300 pixels of 100 m over Istanbul in WGS 84 / UTM zone 35N, written by the first example's class
    const tiff = await GeoTiffLocator.write(32635, 300, 300, 650000, 4560000, 100);
    const position = await new PixelPosition(tiff);

    const tower = JSON.parse(await position.pixel(28.974167, 41.025833)); // Galata Tower
    console.log(`Galata Tower: ${tower.map.map((v) => v.toFixed(2)).join(', ')} m, pixel ${tower.pixel.map((v) => v.toFixed(3)).join(', ')}`);
    const [column, row] = tower.pixel.map(Math.floor);
    const centre = JSON.parse(await position.lonLat(column + 0.5, row + 0.5));
    console.log(`centre of pixel ${column}, ${row}: ${centre.map.join(', ')} m, ${centre.lonLat.map((v) => v.toFixed(6)).join(', ')}`);
}
