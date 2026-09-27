export const title = 'Read one tile of a big image';
export const summary = 'Large TIFFs are cut into tiles so a viewer decodes only what it shows. TIFFWriteTile stores them, TIFFComputeTile finds the one under a pixel and TIFFReadTile decodes it alone.';
export const native = 'tiff_tiles.h';
export const expected = ['512x512 in 16 tiles of 128x128, 239648 B', 'pixel (300, 200) is in tile 6, decoded alone: 49152 B', 'rgb(150, 100, 125)'];

export default async function example({ TiffTiles }, console) {
    const size = 512;
    let rgba = '';
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) rgba += String.fromCharCode(x >> 1, y >> 1, (x + y) >> 2, 255);
    }
    const tiff = await TiffTiles.encode(rgba, size, size, 128);
    console.log(`${await TiffTiles.layout(tiff)}, ${tiff.length} B`);

    const [x, y] = [300, 200];
    const tile = await TiffTiles.tile(tiff, x, y); // RGB, 128 x 128 x 3 bytes
    const at = ((y % 128) * 128 + (x % 128)) * 3;
    console.log(`pixel (${x}, ${y}) is in tile ${await TiffTiles.tileIndex(tiff, x, y)}, decoded alone: ${tile.length} B`);
    console.log(`rgb(${[0, 1, 2].map((channel) => tile.charCodeAt(at + channel)).join(', ')})`);
}
